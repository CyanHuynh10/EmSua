begin;

-- Scope controller writes to the selected device, including PostgREST safe updates.
create or replace function public.sua_lighting_sim(p_action text, p_data jsonb)
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
  select * into strict controller from lighting_controller where device_key='sua-controller-wokwi-01' for update;
  ts := clock_timestamp();
  online := coalesce(controller.last_seen_at > ts - interval '30 seconds', false);
  if not online and not controller.offline_logged then
    update lighting_controller set offline_logged=true where device_key=controller.device_key;
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
    update lighting_controller set mode=p_data->>'mode' where device_key=controller.device_key;
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
    update lighting_controller set boot_id=boot,state_version=-1,last_claim_at=null,last_state_at=null where device_key=controller.device_key returning * into controller;
  end if;
  if boot is null or boot is distinct from controller.boot_id then return '{"error":"SESSION_CHANGED"}'; end if;

  if p_action = 'claim' then
    if controller.mode <> 'simulation' then return '{"command":null}'; end if;
    if controller.last_claim_at > ts - interval '750 milliseconds' then return '{"error":"RATE_LIMITED"}'; end if;
    update lighting_controller set last_claim_at=ts where device_key=controller.device_key;
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
      update lighting_controller set last_seen_at=ts,firmware_version=p_data->>'firmwareVersion',offline_logged=false where device_key=controller.device_key;
    end if;
    if version > controller.state_version and p_data ? 'state' then
      if p_action = 'state' and controller.last_state_at > ts - interval '250 milliseconds' then
        return '{"error":"RATE_LIMITED"}';
      end if;
      payload := p_data->'state';
      update lighting_controller set power=(payload->>'power')::boolean,
        brightness=(payload->>'brightness')::integer,state_version=version,
        last_state_at=case when p_action='state' then ts else last_state_at end where device_key=controller.device_key;
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

commit;
