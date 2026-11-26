begin;

alter table public.lighting_schedules add column mode text not null default 'mock' check (mode in ('mock','simulation'));
alter table public.lighting_schedules drop constraint lighting_schedules_day_key;
alter table public.lighting_schedules add unique (day,mode);

create function public.sua_lighting_schedule_snapshot(p_day date,p_mode text)
returns jsonb language sql stable set search_path = public as $$
  select (to_jsonb(l) - 'mode') || jsonb_build_object('on_outcome',a.outcome,'off_outcome',b.outcome)
  from lighting_schedules l
  left join schedule_executions a on a.lighting_id=l.id and a.action='on'
  left join schedule_executions b on b.lighting_id=l.id and b.action='off'
  where l.day=p_day and l.mode=p_mode;
$$;

revoke execute on function public.sua_lighting_schedule_snapshot(date,text) from public, anon, authenticated;
grant execute on function public.sua_lighting_schedule_snapshot(date,text) to service_role;

create table public.lighting_controller (
  device_key text primary key check (device_key = 'sua-controller-wokwi-01'),
  mode text not null default 'mock' check (mode in ('mock', 'simulation')),
  boot_id uuid,
  state_version integer not null default -1 check (state_version >= -1),
  power boolean not null default false,
  brightness integer not null default 50 check (brightness between 0 and 100),
  last_seen_at timestamptz,
  last_claim_at timestamptz,
  last_state_at timestamptz,
  offline_logged boolean not null default true,
  firmware_version text
);

insert into public.lighting_controller(device_key) values ('sua-controller-wokwi-01');

-- The existing device_commands table models mock feeder cycles with finish_at.
create table public.lighting_commands (
  id uuid primary key default gen_random_uuid(),
  sequence bigint generated always as identity unique,
  device_key text not null references public.lighting_controller(device_key),
  request_id uuid not null unique,
  execution_id uuid unique references public.schedule_executions(id),
  payload jsonb not null check (
    jsonb_typeof(payload) = 'object' and payload <> '{}'::jsonb and payload - 'power' - 'brightness' = '{}'::jsonb
    and (not payload ? 'power' or jsonb_typeof(payload->'power') = 'boolean')
    and (not payload ? 'brightness' or (jsonb_typeof(payload->'brightness') = 'number'
      and (payload->>'brightness') ~ '^(100|[1-9]?[0-9])$'))
  ),
  status text not null default 'pending' check (status in ('pending','claimed','completed','failed','expired','cancelled')),
  created_at timestamptz not null,
  expires_at timestamptz not null check (expires_at > created_at),
  claimed_at timestamptz,
  lease_until timestamptz,
  lease_id uuid,
  completed_at timestamptz,
  error_code text
);

create index lighting_commands_queue on public.lighting_commands(device_key, sequence)
  where status in ('pending', 'claimed');
create unique index lighting_commands_one_claim on public.lighting_commands(device_key) where status = 'claimed';

alter table public.lighting_controller enable row level security;
alter table public.lighting_commands enable row level security;
revoke all on public.lighting_controller, public.lighting_commands from public, anon, authenticated;
grant select, insert, update on public.lighting_controller, public.lighting_commands to service_role;
revoke all on sequence public.lighting_commands_sequence_seq from public, anon, authenticated;
grant usage on sequence public.lighting_commands_sequence_seq to service_role;

create function public.sua_lighting_sim(p_action text, p_data jsonb)
returns jsonb language plpgsql set search_path = public as $$
declare
  controller lighting_controller%rowtype;
  cmd lighting_commands%rowtype;
  ts timestamptz;
  online boolean;
  payload jsonb;
  desired jsonb;
  reported jsonb;
  pending boolean := false;
  outcome_status text;
  version integer;
  boot uuid;
  expiry timestamptz;
  home jsonb;
begin
  -- Same lock ordering as the existing scheduler and admin mutations.
  perform 1 from system_settings where singleton for update;
  select * into strict controller from lighting_controller for update;
  ts := clock_timestamp();
  online := coalesce(controller.last_seen_at > ts - interval '30 seconds', false);
  if not online and not controller.offline_logged then
    update lighting_controller set offline_logged=true;
    insert into activity_logs(event,detail,created_at) values ('device.disconnected',
      jsonb_build_object('deviceId',controller.device_key),controller.last_seen_at + interval '30 seconds');
  end if;

  for cmd in update lighting_commands c set status='expired', completed_at=ts, error_code='COMMAND_EXPIRED'
    where c.status in ('pending','claimed') and c.expires_at <= ts returning c.*
  loop
    update schedule_executions set outcome='missed', updated_at=ts where id=cmd.execution_id;
    insert into activity_logs(event, detail, created_at) values
      ('lighting.command_expired', jsonb_build_object('commandId',cmd.id), ts);
  end loop;

  if p_action = 'snapshot' then
    reported := jsonb_build_object('power',controller.power,'brightness',controller.brightness);
    desired := reported;
    for cmd in select * from lighting_commands c where c.status in ('pending','claimed') order by sequence loop
      desired := desired || cmd.payload;
      pending := true;
    end loop;
    home := sua_snapshot();
    if controller.mode = 'simulation' then
      home := home || jsonb_build_object('lighting',sua_lighting_schedule_snapshot((home->>'day')::date,'simulation'));
    end if;
    return home || jsonb_build_object('serverTime',ts,'controller',jsonb_build_object(
      'mode',controller.mode,'deviceId',controller.device_key,'online',online,
      'lastSeenAt',controller.last_seen_at,'firmwareVersion',controller.firmware_version,'pending',pending,
      'reported',case when controller.boot_id is not null then reported end,'desired',case when pending then desired end,
      'stateVersion',controller.state_version));
  end if;

  if p_action = 'mode' then
    if controller.mode = p_data->>'mode' then return '{"status":"completed"}'; end if;
    if exists (select 1 from lighting_commands c where c.status='claimed') then
      return '{"error":"COMMAND_IN_PROGRESS"}';
    end if;
    for cmd in update lighting_commands c set status='cancelled',completed_at=ts
      where c.status='pending' returning c.*
    loop
      update schedule_executions set outcome='missed',updated_at=ts where id=cmd.execution_id;
      insert into activity_logs(event, detail, created_at) values
        ('lighting.command_cancelled',jsonb_build_object('commandId',cmd.id),ts);
    end loop;
    update lighting_controller set mode=p_data->>'mode';
    return '{"status":"completed"}';
  end if;

  if p_action = 'command' then
    select * into cmd from lighting_commands where id=(p_data->>'commandId')::uuid;
    if not found then return '{"error":"COMMAND_NOT_FOUND"}'; end if;
    return jsonb_build_object('commandId',cmd.id,'status',cmd.status,'errorCode',cmd.error_code);
  end if;

  if p_action in ('enqueue','schedule') then
    payload := p_data->'payload';
    select * into cmd from lighting_commands where request_id=(p_data->>'requestId')::uuid;
    if found then
      if cmd.payload <> payload then return '{"error":"VERSION_CONFLICT"}'; end if;
      return jsonb_build_object('commandId',cmd.id,'status',cmd.status,'duplicate',true);
    end if;
    if controller.mode <> 'simulation' then return '{"error":"MODE_CHANGED"}'; end if;
    if not online then return '{"error":"DEVICE_OFFLINE"}'; end if;
    expiry := coalesce((p_data->>'expiresAt')::timestamptz, ts + interval '30 seconds');
    if expiry <= ts then return '{"error":"COMMAND_EXPIRED"}'; end if;
    if p_action = 'schedule' and controller.power = (payload->>'power')::boolean and
      not exists (select 1 from lighting_commands c where c.status in ('pending','claimed')) then
      return '{"status":"skipped_already_satisfied"}';
    end if;
    if (select count(*) from lighting_commands c where c.status in ('pending','claimed')) >= 8 then
      return '{"error":"QUEUE_FULL"}';
    end if;
    if p_action = 'enqueue' and exists (select 1 from lighting_commands c
      where c.status in ('pending','claimed') and c.created_at > ts - interval '300 milliseconds') then
      return '{"error":"RATE_LIMITED"}';
    end if;
    insert into lighting_commands(device_key,request_id,execution_id,payload,created_at,expires_at)
      values(controller.device_key,(p_data->>'requestId')::uuid,(p_data->>'executionId')::uuid,payload,ts,expiry)
      returning * into cmd;
    insert into activity_logs(event,detail,created_at) values ('lighting.command_created',
      jsonb_build_object('commandId',cmd.id,'source',case when cmd.execution_id is null then 'manual' else 'schedule' end),ts);
    return jsonb_build_object('commandId',cmd.id,'status',cmd.status,'duplicate',false);
  end if;

  boot := (p_data->>'bootId')::uuid;
  if p_action = 'heartbeat' and coalesce((p_data->>'boot')::boolean,false) and boot is distinct from controller.boot_id then
    -- A reboot loses its in-memory execution result. Do not replay its claim.
    for cmd in update lighting_commands c set status='failed',completed_at=ts,error_code='DEVICE_RESTARTED'
      where c.status='claimed' returning c.*
    loop
      update schedule_executions set outcome='failed',updated_at=ts where id=cmd.execution_id;
      insert into activity_logs(event,detail,created_at) values ('lighting.command_failed',
        jsonb_build_object('commandId',cmd.id,'errorCode','DEVICE_RESTARTED'),ts);
    end loop;
    update lighting_controller set boot_id=boot,state_version=-1,last_claim_at=null,last_state_at=null returning * into controller;
  end if;
  if boot is null or boot is distinct from controller.boot_id then return '{"error":"SESSION_CHANGED"}'; end if;

  if p_action = 'claim' then
    if controller.mode <> 'simulation' then return '{"command":null}'; end if;
    if controller.last_claim_at > ts - interval '750 milliseconds' then return '{"error":"RATE_LIMITED"}'; end if;
    update lighting_controller set last_claim_at=ts;
    select * into cmd from lighting_commands c where c.status in ('pending','claimed') order by sequence limit 1;
    if not found or cmd.lease_until > ts then return '{"command":null}'; end if;
    update lighting_commands set status='claimed',claimed_at=coalesce(claimed_at,ts),
      lease_until=least(ts + interval '10 seconds',expires_at),lease_id=gen_random_uuid()
      where id=cmd.id returning * into cmd;
    insert into activity_logs(event,detail,created_at) values ('lighting.command_claimed',jsonb_build_object('commandId',cmd.id),ts);
    return jsonb_build_object('command',jsonb_build_object('id',cmd.id,'leaseId',cmd.lease_id,'payload',cmd.payload,
      'type',case when cmd.payload ? 'power' and cmd.payload ? 'brightness' then 'lighting.set_state'
        when cmd.payload ? 'power' then 'lighting.set_power' else 'lighting.set_brightness' end,
      'ttlMs',floor(extract(epoch from (cmd.expires_at-ts))*1000)::integer));
  end if;

  if p_action = 'ack' then
    select * into cmd from lighting_commands where id=(p_data->>'commandId')::uuid;
    if not found or cmd.device_key <> controller.device_key then return '{"error":"COMMAND_NOT_FOUND"}'; end if;
    if cmd.status = 'expired' then return '{"error":"COMMAND_EXPIRED"}'; end if;
    if cmd.lease_id is distinct from (p_data->>'leaseId')::uuid then return '{"error":"VERSION_CONFLICT"}'; end if;
    if cmd.status in ('completed','failed') then return jsonb_build_object('status',cmd.status,'duplicate',true); end if;
    if cmd.status <> 'claimed' then return '{"error":"VERSION_CONFLICT"}'; end if;
    outcome_status := p_data->>'status';
    if outcome_status = 'completed' and not ((p_data->'state') @> cmd.payload) then
      return '{"error":"STATE_MISMATCH"}';
    end if;
    update lighting_commands set status=outcome_status,completed_at=ts,error_code=p_data->>'errorCode' where id=cmd.id;
    update schedule_executions set outcome=outcome_status,updated_at=ts where id=cmd.execution_id;
    insert into activity_logs(event,detail,created_at) values ('lighting.command_' || outcome_status,
      jsonb_strip_nulls(jsonb_build_object('commandId',cmd.id,'errorCode',p_data->>'errorCode',
        'source',case when cmd.execution_id is null then 'manual' else 'schedule' end)),ts);
  end if;

  if p_action in ('heartbeat','state','ack') then
    version := (p_data->>'stateVersion')::integer;
    if p_action = 'heartbeat' then
      if not online then
        insert into activity_logs(event,detail,created_at) values ('device.connected',jsonb_build_object('deviceId',controller.device_key),ts);
      end if;
      if not (p_data->>'boot')::boolean and controller.last_seen_at > ts - interval '1 second' then
        return '{"error":"RATE_LIMITED"}';
      end if;
      update lighting_controller set last_seen_at=ts,firmware_version=p_data->>'firmwareVersion',offline_logged=false;
    end if;
    if version > controller.state_version and p_data ? 'state' then
      if p_action = 'state' and controller.last_state_at > ts - interval '250 milliseconds' then
        return '{"error":"RATE_LIMITED"}';
      end if;
      payload := p_data->'state';
      update lighting_controller set power=(payload->>'power')::boolean,
        brightness=(payload->>'brightness')::integer,state_version=version,
        last_state_at=case when p_action='state' then ts else last_state_at end;
      if p_action = 'state' and controller.mode = 'simulation' then
        insert into activity_logs(event,detail,created_at) values
          (case when p_data->>'source'='local_button' then 'lighting.local_power_changed' else 'lighting.local_brightness_changed' end,
           payload || jsonb_build_object('source',p_data->>'source'),ts);
      end if;
    end if;
    return jsonb_build_object('status',coalesce(outcome_status,'accepted'));
  end if;
  return '{"error":"UNKNOWN_ACTION"}';
end;
$$;

revoke execute on function public.sua_lighting_sim(text,jsonb) from public, anon, authenticated;
grant execute on function public.sua_lighting_sim(text,jsonb) to service_role;

create or replace function public.sua_snapshot() returns jsonb language sql stable set search_path = public as $$
  with day as (select (now() at time zone 'Asia/Ho_Chi_Minh')::date as today)
  select jsonb_build_object(
    'day', day.today, 'serverTime', now(),
    'light', (select jsonb_build_object('power', s.power, 'brightness', s.brightness) from device_states s join devices d on s.device_id=d.id where d.kind='light'),
    'camera', (select case when s.power then 'offline' else 'off' end from device_states s join devices d on d.id=s.device_id where d.kind='camera'),
    'feeder', (select jsonb_build_object('status', status, 'created_at', created_at) from device_commands order by created_at desc limit 1),
    'feeding', (select to_jsonb(f) || jsonb_build_object('outcome', e.outcome) from feeding_schedules f left join schedule_executions e on e.feeding_id=f.id where f.day=day.today),
    'lighting', sua_lighting_schedule_snapshot(day.today,'mock'),
    'settings', (select jsonb_build_object('servo_ms', servo_ms, 'version', version) from system_settings where singleton),
    'activity', (select coalesce(jsonb_agg(to_jsonb(a) || jsonb_build_object('sequence', a.sequence::text) order by a.sequence desc), '[]')
      from (select * from activity_logs order by sequence desc limit 5) a)
  ) from day;
$$;

create or replace function public.sua_mutate(p_action text, p_data jsonb)
returns jsonb language plpgsql set search_path = public as $$
declare
  ts timestamptz;
  today date;
  local_time time;
  cycle system_settings%rowtype;
  f feeding_schedules%rowtype;
  l lighting_schedules%rowtype;
  cmd device_commands%rowtype;
  target record;
  due record;
  desired boolean;
  outcome text;
  execution uuid;
  feeder uuid;
  mark_on time;
  mark_off time;
  request uuid;
  processed integer := 0;
  simulation boolean := false;
  schedule_mode text := 'mock';
  queued jsonb;
begin
  -- The singleton row serializes schedule edits, claims and device changes.
  select * into strict cycle from system_settings where singleton for update;
  ts := clock_timestamp();
  today := (ts at time zone 'Asia/Ho_Chi_Minh')::date;
  local_time := (ts at time zone 'Asia/Ho_Chi_Minh')::time;
  select id into strict feeder from devices where kind='feeder';

  if p_action in ('process', 'light', 'light_schedule', 'cancel_light') and p_data->'simulationEnabled' = 'true'::jsonb then
    select mode = 'simulation' into strict simulation from lighting_controller;
  end if;
  if simulation then schedule_mode := 'simulation'; end if;
  if p_action in ('light', 'light_schedule', 'cancel_light') and p_data ? 'expected_mode' and
    p_data->>'expected_mode' <> schedule_mode then
    return '{"error":"MODE_CHANGED"}';
  end if;

  if p_action in ('process', 'dispense') then
    for cmd in update device_commands
      set status = case when simulate_failure then 'failed' else 'completed' end
      where status='executing' and finish_at <= ts returning *
    loop
      update schedule_executions set outcome=cmd.status, updated_at=ts where id=cmd.execution_id;
      insert into activity_logs(event, detail, created_at) values
        ('feed_' || cmd.status, jsonb_build_object('source', case when cmd.execution_id is null then 'manual' else 'schedule' end), ts);
    end loop;
  end if;

  case p_action
  when 'dispense' then
    request := (p_data->>'request_id')::uuid;
    select * into cmd from device_commands where request_id=request;
    if found then return jsonb_build_object('status', cmd.status, 'duplicate', true); end if;
    if exists (select 1 from device_commands where device_id=feeder and status='executing') then
      return '{"error":"FEEDER_BUSY"}';
    end if;
    if exists (select 1 from device_commands where device_id=feeder and finish_at > ts - interval '3 seconds') then
      return '{"error":"FEEDER_COOLDOWN"}';
    end if;
    insert into device_commands(device_id,request_id,status,created_at,finish_at,simulate_failure)
      values(feeder,request,'executing',ts,ts + make_interval(secs => cycle.servo_ms / 1000.0),
        coalesce((p_data->>'fail')::boolean,false));
    insert into activity_logs(event, detail, created_at) values ('feed_executing','{"source":"manual"}',ts);
    return '{"status":"executing","duplicate":false}';

  when 'process' then
    for due in
      select s.id, 'feed' as action, s.day, (s.day + s.feed_at) at time zone 'Asia/Ho_Chi_Minh' as at
        from feeding_schedules s where not s.cancelled and s.day<=today
        and not exists (select 1 from schedule_executions e where e.feeding_id=s.id)
      union all
      select s.id, m.action, s.day, (s.day + m.at) at time zone 'Asia/Ho_Chi_Minh' as at
        from lighting_schedules s cross join lateral (values ('on',s.on_at),('off',s.off_at)) m(action,at)
        where not s.cancelled and s.day<=today and s.mode=schedule_mode
        and not exists (select 1 from schedule_executions e where e.lighting_id=s.id and e.action=m.action)
      order by at, action, id
    loop
      continue when due.at > ts;
      if simulation and due.action <> 'feed' and due.day = today and ts - due.at <= interval '30 seconds' then
        insert into schedule_executions(lighting_id,action,outcome,scheduled_at,updated_at)
          values (due.id,due.action,'executing',due.at,ts) returning id into execution;
        queued := sua_lighting_sim('schedule',jsonb_build_object('requestId',execution,'executionId',execution,
          'payload', jsonb_build_object('power',due.action='on'),'expiresAt',due.at + interval '30 seconds'));
        if queued->>'status' = 'pending' then
          processed := processed + 1;
        elsif queued->>'status' = 'skipped_already_satisfied' then
          update schedule_executions set outcome='skipped_already_satisfied' where id=execution;
          insert into activity_logs(event,detail,created_at) values ('schedule_skipped_already_satisfied',
            jsonb_build_object('action',due.action,'scheduled_at',due.at),ts);
          processed := processed + 1;
        else
          -- Leave this slot available for the next scheduler tick within the window.
          delete from schedule_executions where id=execution;
        end if;
        continue;
      end if;
      outcome := 'missed';
      if due.day = today and ts - due.at <= interval '30 seconds' then
        if due.action='feed' then
          if exists (select 1 from device_commands where device_id=feeder and finish_at > ts - interval '3 seconds') then
            continue;
          end if;
          outcome := 'executing';
        else
          desired := due.action='on';
          select s.device_id, s.power into strict target from device_states s join devices d on d.id=s.device_id where d.kind='light';
          outcome := 'skipped_already_satisfied';
          if target.power <> desired then
            update device_states set power=desired, updated_at=ts where device_id=target.device_id;
            outcome := 'completed';
          end if;
        end if;
      end if;
      insert into schedule_executions (feeding_id,lighting_id,action,outcome,scheduled_at,updated_at)
        values (case when due.action='feed' then due.id end, case when due.action<>'feed' then due.id end,
          due.action,outcome,due.at,ts) returning id into execution;
      if outcome='executing' then
        insert into device_commands (device_id,request_id,execution_id,status,created_at,finish_at,simulate_failure)
          values (feeder,gen_random_uuid(),execution,outcome,ts,ts + make_interval(secs => cycle.servo_ms / 1000.0),
            coalesce((p_data->>'fail')::boolean,false));
      end if;
      insert into activity_logs(event,detail,created_at) values
        ('schedule_' || outcome,jsonb_build_object('action',due.action,'scheduled_at',due.at),ts);
      processed := processed + 1;
    end loop;
    return jsonb_build_object('processed', processed);

  when 'light', 'camera' then
    if p_action='light' and simulation then
      return sua_lighting_sim('enqueue',jsonb_build_object('requestId',coalesce((p_data->>'request_id')::uuid,gen_random_uuid()),
        'payload',p_data - 'simulationEnabled' - 'request_id' - 'expected_mode'));
    end if;
    if p_action='light' then
      p_data := p_data - 'simulationEnabled' - 'request_id' - 'expected_mode';
    end if;
    select s.device_id,s.power,s.brightness into strict target from device_states s join devices d on s.device_id=d.id where d.kind=p_action;
    desired := coalesce((p_data->>'power')::boolean,target.power);
    if desired = target.power and coalesce((p_data->>'brightness')::integer,target.brightness) = target.brightness then
      insert into activity_logs(event,detail,created_at) values (p_action || '_skipped','{}',ts);
      return '{"status":"skipped_already_satisfied"}';
    end if;
    update device_states set power=desired,brightness=coalesce((p_data->>'brightness')::integer,target.brightness),updated_at=ts
      where device_id=target.device_id;
    insert into activity_logs(event,detail,created_at) values (p_action || '_changed',p_data,ts);

  when 'settings' then
    if cycle.version <> (p_data->>'version')::integer then return '{"error":"VERSION_CONFLICT"}'; end if;
    update system_settings set servo_ms=(p_data->>'servo_ms')::integer,version=version+1,updated_at=ts where id=cycle.id;
    insert into activity_logs(event,detail,created_at) values ('settings_changed',jsonb_build_object('servo_ms',p_data->'servo_ms'),ts);

  when 'feed_schedule', 'cancel_feed' then
    if (p_data->>'day')::date is distinct from today then return '{"error":"DAY_CHANGED"}'; end if;
    select * into f from feeding_schedules where day=today;
    if coalesce(f.version,0) <> (p_data->>'version')::integer then return '{"error":"VERSION_CONFLICT"}'; end if;
    if f.id is not null and not f.cancelled and
      (f.feed_at <= local_time or exists (select 1 from schedule_executions where feeding_id=f.id)) then
        return '{"error":"SCHEDULE_LOCKED"}';
    end if;
    if p_action='cancel_feed' then
      if f.id is null or f.cancelled then return '{"error":"SCHEDULE_LOCKED"}'; end if;
      update feeding_schedules set cancelled=true,version=version+1 where id=f.id;
    else
      mark_on := (p_data->>'feed_at')::time;
      if mark_on <= local_time then return '{"error":"PAST_TIME"}'; end if;
      insert into feeding_schedules(day,feed_at) values(today,mark_on)
        on conflict(day) do update set feed_at=excluded.feed_at,cancelled=false,version=feeding_schedules.version+1;
    end if;
    insert into activity_logs(event,created_at) values (p_action,ts);

  when 'light_schedule', 'cancel_light' then
    if (p_data->>'day')::date is distinct from today then return '{"error":"DAY_CHANGED"}'; end if;
    select * into l from lighting_schedules where day=today and mode=schedule_mode;
    if coalesce(l.version,0) <> (p_data->>'version')::integer then return '{"error":"VERSION_CONFLICT"}'; end if;
    if p_action='cancel_light' then
      if l.id is null or l.cancelled or l.on_at <= local_time or
        exists (select 1 from schedule_executions where lighting_id=l.id) then return '{"error":"SCHEDULE_LOCKED"}'; end if;
      update lighting_schedules set cancelled=true,version=version+1 where id=l.id;
    else
      mark_on := (p_data->>'on_at')::time;
      mark_off := (p_data->>'off_at')::time;
      if l.id is not null and not l.cancelled then
        if (mark_on <> l.on_at and (l.on_at <= local_time or exists (
          select 1 from schedule_executions where lighting_id=l.id and action='on'
        ))) or (l.off_at <= local_time or exists (
          select 1 from schedule_executions where lighting_id=l.id and action='off'
        )) then return '{"error":"SCHEDULE_LOCKED"}'; end if;
      end if;
      if mark_on >= mark_off or mark_off <= local_time or
        (mark_on <= local_time and (l.id is null or l.cancelled or mark_on <> l.on_at)) then return '{"error":"PAST_TIME"}'; end if;
      insert into lighting_schedules(day,on_at,off_at,mode) values(today,mark_on,mark_off,schedule_mode)
        on conflict(day,mode) do update set on_at=excluded.on_at,off_at=excluded.off_at,cancelled=false,version=lighting_schedules.version+1;
    end if;
    insert into activity_logs(event,created_at) values (p_action,ts);
  else
    return '{"error":"UNKNOWN_ACTION"}';
  end case;
  return '{"status":"completed"}';
end;
$$;

commit;
