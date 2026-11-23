begin;

create table public.devices (
  id uuid primary key default gen_random_uuid(),
  kind text not null unique check (kind in ('feeder', 'light', 'camera'))
);

create table public.device_states (
  device_id uuid primary key references public.devices(id),
  power boolean not null default false,
  brightness integer not null default 75 check (brightness between 0 and 100),
  updated_at timestamptz not null default now()
);

create table public.system_settings (
  id uuid primary key default gen_random_uuid(),
  singleton boolean not null unique default true check (singleton),
  servo_ms integer not null default 1000 check (servo_ms between 250 and 3000),
  version integer not null default 1 check (version > 0),
  updated_at timestamptz not null default now()
);

create table public.feeding_schedules (
  id uuid primary key default gen_random_uuid(),
  day date not null unique,
  feed_at time(0) not null,
  cancelled boolean not null default false,
  version integer not null default 1 check (version > 0)
);

create table public.lighting_schedules (
  id uuid primary key default gen_random_uuid(),
  day date not null unique,
  on_at time(0) not null,
  off_at time(0) not null,
  cancelled boolean not null default false,
  version integer not null default 1 check (version > 0),
  check (on_at < off_at)
);

create table public.schedule_executions (
  id uuid primary key default gen_random_uuid(),
  feeding_id uuid references public.feeding_schedules(id) unique,
  lighting_id uuid references public.lighting_schedules(id),
  action text not null,
  outcome text not null check (outcome in ('executing', 'completed', 'failed', 'missed', 'skipped_already_satisfied')),
  scheduled_at timestamptz not null,
  updated_at timestamptz not null default now(),
  unique (lighting_id, action),
  check ((feeding_id is not null and lighting_id is null and action = 'feed') or
    (feeding_id is null and lighting_id is not null and action in ('on', 'off')))
);

create table public.device_commands (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.devices(id),
  request_id uuid not null unique,
  execution_id uuid references public.schedule_executions(id) unique,
  status text not null check (status in ('executing', 'completed', 'failed')),
  created_at timestamptz not null,
  finish_at timestamptz not null,
  simulate_failure boolean not null,
  check (finish_at > created_at)
);

create unique index one_active_feeder_command on public.device_commands (device_id) where status = 'executing';
create index device_commands_created on public.device_commands (created_at desc);

create table public.activity_logs (
  id uuid primary key default gen_random_uuid(),
  sequence bigint generated always as identity unique,
  event text not null,
  detail jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table public.login_limits (
  bucket text primary key,
  attempts integer not null,
  expires_at timestamptz not null
);

insert into public.devices (kind) values ('feeder'), ('light'), ('camera');
insert into public.device_states (device_id) select id from public.devices;
insert into public.system_settings default values;

create function public.sua_login_limit(p_bucket text)
returns boolean language plpgsql set search_path = public as $$
declare
  ts timestamptz := clock_timestamp();
  hits integer;
  total integer;
begin
  delete from login_limits where expires_at <= ts;
  insert into login_limits values ('global', 1, ts + interval '10 minutes')
    on conflict (bucket) do update set attempts = least(101, login_limits.attempts + 1)
    returning attempts into total;
  if total > 100 then return false; end if;
  insert into login_limits values (p_bucket, 1, ts + interval '10 minutes')
    on conflict (bucket) do update set attempts = least(9, login_limits.attempts + 1)
    returning attempts into hits;
  return hits <= 8;
end;
$$;

create function public.sua_snapshot() returns jsonb language sql stable set search_path = public as $$
  with day as (select (now() at time zone 'Asia/Ho_Chi_Minh')::date as today)
  select jsonb_build_object(
    'day', day.today, 'serverTime', now(),
    'light', (select jsonb_build_object('power', s.power, 'brightness', s.brightness) from device_states s join devices d on d.id=s.device_id where d.kind='light'),
    'camera', (select case when s.power then 'offline' else 'off' end from device_states s join devices d on d.id=s.device_id where d.kind='camera'),
    'feeder', (select jsonb_build_object('status', status, 'created_at', created_at) from device_commands order by created_at desc limit 1),
    'feeding', (select to_jsonb(f) || jsonb_build_object('outcome', e.outcome) from feeding_schedules f left join schedule_executions e on e.feeding_id=f.id where f.day=day.today),
    'lighting', (select to_jsonb(l) || jsonb_build_object('on_outcome', a.outcome, 'off_outcome', b.outcome) from lighting_schedules l
      left join schedule_executions a on a.lighting_id=l.id and a.action='on'
      left join schedule_executions b on b.lighting_id=l.id and b.action='off' where l.day=day.today),
    'settings', (select jsonb_build_object('servo_ms', servo_ms, 'version', version) from system_settings where singleton),
    'activity', (select coalesce(jsonb_agg(to_jsonb(a) || jsonb_build_object('sequence', a.sequence::text) order by a.sequence desc), '[]')
      from (select * from activity_logs order by sequence desc limit 5) a)
  ) from day;
$$;

create function public.sua_activity(p_before bigint, p_limit integer)
returns jsonb language sql stable set search_path = public as $$
  select coalesce(jsonb_agg(to_jsonb(a) || jsonb_build_object('sequence', a.sequence::text) order by a.sequence desc), '[]')
  from (select * from activity_logs where p_before is null or sequence < p_before
    order by sequence desc limit least(greatest(p_limit, 1), 51)) a;
$$;

create function public.sua_mutate(p_action text, p_data jsonb)
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
begin
  -- The singleton row serializes schedule edits, claims and device changes.
  select * into strict cycle from system_settings where singleton for update;
  ts := clock_timestamp();
  today := (ts at time zone 'Asia/Ho_Chi_Minh')::date;
  local_time := (ts at time zone 'Asia/Ho_Chi_Minh')::time;
  select id into strict feeder from devices where kind='feeder';

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
        where not s.cancelled and s.day<=today
        and not exists (select 1 from schedule_executions e where e.lighting_id=s.id and e.action=m.action)
      order by at, action, id
    loop
      continue when due.at > ts;
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
    select * into l from lighting_schedules where day=today;
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
      insert into lighting_schedules(day,on_at,off_at) values(today,mark_on,mark_off)
        on conflict(day) do update set on_at=excluded.on_at,off_at=excluded.off_at,cancelled=false,version=lighting_schedules.version+1;
    end if;
    insert into activity_logs(event,created_at) values (p_action,ts);
  else
    return '{"error":"UNKNOWN_ACTION"}';
  end case;
  return '{"status":"completed"}';
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['devices','device_states','system_settings','feeding_schedules','lighting_schedules',
    'schedule_executions','device_commands','activity_logs','login_limits']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from public, anon, authenticated', t);
    execute format('grant select, insert, update, delete on table public.%I to service_role', t);
  end loop;
end;
$$;

grant usage, select on sequence public.activity_logs_sequence_seq to service_role;
revoke execute on function public.sua_login_limit(text), public.sua_snapshot(), public.sua_activity(bigint,integer),
  public.sua_mutate(text,jsonb) from public, anon, authenticated;
grant execute on function public.sua_login_limit(text), public.sua_snapshot(), public.sua_activity(bigint,integer),
  public.sua_mutate(text,jsonb) to service_role;

commit;
