import type { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import type { LightingController } from "../src/features/model";
import { openDatabase } from "./postgres.mjs";

let db: PGlite;
let bootId: string;
const initial = { power: false, brightness: 50 };
const events = "select event from activity_logs where detail->>'commandId' = $1 order by sequence";
const sim = async (action: string, data: object = {}) => {
  const { rows } = await db.query<{ result: Record<string, unknown> }>("select sua_lighting_sim($1,$2) as result", [action, data]);
  return rows[0].result;
};
const controller = async () => (await sim("snapshot")).controller as LightingController;
const heartbeat = (id = bootId) => sim("heartbeat", { bootId: id, boot: true, state: initial, stateVersion: 0, firmwareVersion: "test" });
const enqueue = (payload: object, requestId = randomUUID()) => sim("enqueue", { requestId, payload });
const claim = () => sim("claim", { bootId });
const clearClaimRate = () => db.exec("update lighting_controller set last_claim_at=null");
const expire = () => db.exec("update lighting_commands set created_at=now()-interval '40 seconds', expires_at=now()-interval '10 seconds'");
const unlockEnqueueRate = () => db.exec("update lighting_commands set created_at=created_at-interval '1 second'");

beforeAll(async () => { db = await openDatabase(); });
beforeEach(async () => {
  await db.exec("truncate lighting_commands, device_commands, schedule_executions, lighting_schedules, activity_logs; " +
    "update device_states set power=false,brightness=75; " +
    "update lighting_controller set mode='mock', boot_id=null, last_seen_at=null, last_claim_at=null, last_state_at=null, " +
    "offline_logged=true, power=false, brightness=50,state_version=-1");
  bootId = randomUUID();
});
afterAll(async () => { await db?.close(); });

it("grants only the server access to controller state and queue RPCs", async () => {
  for (const role of ["anon", "authenticated"]) {
    await db.exec(`set role ${role}`);
    try {
      await expect(db.query("select * from lighting_commands")).rejects.toThrow(/permission denied/);
      await expect(db.query("select sua_lighting_sim('snapshot','{}')")).rejects.toThrow(/permission denied/);
    } finally { await db.exec("reset role"); }
  }
  await db.exec("set role service_role");
  try {
    await heartbeat();
    expect(await controller()).toMatchObject({ reported: initial, online: true });
    await sim("mode", { mode: "simulation" });
    expect(await enqueue({ brightness: 100 })).toMatchObject({ status: "pending" });
    await unlockEnqueueRate();
    await expect(enqueue({ brightness: 101 })).rejects.toThrow(/check constraint/);
  } finally { await db.exec("reset role"); }
});

it("deduplicates submissions and claims, preserves FIFO and confirms only a matching ACK", async () => {
  await heartbeat();
  await sim("mode", { mode: "simulation" });
  const requestId = randomUUID();
  const pending = await enqueue({ power: true, brightness: 75 }, requestId);
  expect(await enqueue({ power: true, brightness: 75 }, requestId)).toMatchObject({ commandId: pending.commandId, duplicate: true });
  expect(await enqueue({ power: false }, requestId)).toEqual({ error: "VERSION_CONFLICT" });
  expect(await enqueue({ power: false })).toEqual({ error: "RATE_LIMITED" });
  await unlockEnqueueRate();
  const second = await enqueue({ power: false });
  expect(await controller()).toMatchObject({ desired: { power: false, brightness: 75 }, reported: initial });
  const results = await Promise.all([claim(), claim()]);
  expect(results[1]).toEqual({ error: "RATE_LIMITED" });
  const command = results[0].command as { id: string; leaseId: string };
  expect(command.id).toBe(pending.commandId);
  await clearClaimRate();
  expect(await claim()).toEqual({ command: null });
  const ack = { bootId, commandId: command.id, leaseId: command.leaseId, stateVersion: 1, status: "completed" };
  expect(await sim("ack", { ...ack, commandId: randomUUID(), state: initial })).toEqual({ error: "COMMAND_NOT_FOUND" });
  expect(await sim("ack", { ...ack, state: initial })).toEqual({ error: "STATE_MISMATCH" });
  expect(await sim("ack", { ...ack, state: { power: true, brightness: 75 } })).toMatchObject({ status: "completed" });
  await sim("state", { bootId, stateVersion: 2, source: "local_button", state: { power: false, brightness: 75 } });
  expect(await sim("ack", { ...ack, state: { power: true, brightness: 75 } })).toEqual({ status: "completed", duplicate: true });
  expect(await controller()).toMatchObject({ reported: { power: false, brightness: 75 }, stateVersion: 2 });
  expect((await db.query<{ event: string }>(events, [command.id])).rows.map((row) => row.event)).toEqual([
    "lighting.command_created", "lighting.command_claimed", "lighting.command_completed",
  ]);
  await clearClaimRate();
  expect(await claim()).toMatchObject({ command: { id: second.commandId } });
});

it("renews a lease with a new token and records a failed ACK without changing reported state", async () => {
  await heartbeat();
  await sim("mode", { mode: "simulation" });
  const { commandId } = await enqueue({ power: true });
  const first = (await claim()).command as { leaseId: string };
  await db.exec("update lighting_commands set lease_until=now()-interval '1 second'; update lighting_controller set last_claim_at=null");
  const second = (await claim()).command as { leaseId: string };
  expect(second.leaseId).not.toBe(first.leaseId);
  const ack = { bootId, commandId, stateVersion: 0, status: "failed", errorCode: "LED_DRIVER_ERROR" };
  expect(await sim("ack", { ...ack, leaseId: first.leaseId })).toEqual({ error: "VERSION_CONFLICT" });
  expect(await sim("ack", { ...ack, leaseId: second.leaseId })).toMatchObject({ status: "failed" });
  expect(await controller()).toMatchObject({ reported: initial, pending: false });
});

it("expires offline commands and refuses stale sessions and replay on reboot", async () => {
  await sim("mode", { mode: "simulation" });
  expect(await enqueue({ power: true })).toEqual({ error: "DEVICE_OFFLINE" });
  await heartbeat();
  const { commandId: old } = await enqueue({ power: true });
  await expire();
  expect(await claim()).toEqual({ command: null });
  expect(await sim("command", { commandId: old })).toMatchObject({ status: "expired" });
  await clearClaimRate();
  const { commandId } = await enqueue({ brightness: 25 });
  expect(await claim()).toMatchObject({ command: { id: commandId } });
  const nextBoot = randomUUID();
  await heartbeat(nextBoot);
  expect(await claim()).toEqual({ error: "SESSION_CHANGED" });
  expect(await sim("claim", { bootId: nextBoot })).toEqual({ command: null });
  expect(await sim("command", { commandId })).toMatchObject({ status: "failed", errorCode: "DEVICE_RESTARTED" });
  await db.exec("update lighting_controller set last_seen_at=now()-interval '31 seconds'");
  expect(await controller()).toMatchObject({ online: false, reported: initial });
});

it("keeps Mock, Simulation and feeder stores independent and cancels unclaimed commands when changing modes", async () => {
  await heartbeat();
  await sim("mode", { mode: "simulation" });
  const { commandId } = await enqueue({ power: true });
  await sim("mode", { mode: "mock" });
  expect((await db.query(`select sua_mutate('light','{"simulationEnabled":true,"expected_mode":"simulation","power":true}') as result`)).rows)
    .toEqual([{ result: { error: "MODE_CHANGED" } }]);
  await db.query("select sua_mutate('light',$1)", [{ simulationEnabled: true, power: true, brightness: 19 }]);
  expect(await sim("snapshot")).toMatchObject({ light: { power: true, brightness: 19 }, feeder: null, controller: { reported: initial } });
  expect(await claim()).toEqual({ command: null });
  expect(await sim("command", { commandId })).toMatchObject({ status: "cancelled" });
});

it("dispatches a single due schedule command, updates its outcome on ACK and misses old slots", async () => {
  await heartbeat();
  await sim("mode", { mode: "simulation" });
  const local = "clock_timestamp() at time zone 'Asia/Ho_Chi_Minh'";
  await db.query(`insert into lighting_schedules(day,on_at,off_at,mode) values
    ((${local})::date, ((${local})-interval '8 seconds')::time, '23:59:59','simulation'),
    ((${local})::date-1,'17:00','18:00','simulation'), ((${local})::date,'19:00','20:00','mock')`);
  await Promise.all([db.query(`select sua_mutate('process','{"simulationEnabled":true}')`),
    db.query(`select sua_mutate('process','{"simulationEnabled":true}')`)]);
  const { rows } = await db.query<{ payload: object; status: string; execution_id: string }>(
    "select payload,status,execution_id from lighting_commands",
  );
  expect(rows).toEqual([{ payload: { power: true }, status: "pending", execution_id: expect.any(String) }]);
  expect((await db.query("select outcome from schedule_executions order by scheduled_at")).rows).toEqual([
    { outcome: "missed" }, { outcome: "missed" }, { outcome: "executing" },
  ]);
  const { id, leaseId } = (await claim()).command as { id: string; leaseId: string };
  await sim("ack", { bootId, commandId: id, leaseId, stateVersion: 1, status: "completed", state: { ...initial, power: true } });
  expect((await db.query("select outcome from schedule_executions where id=$1", [rows[0].execution_id])).rows).toEqual([{ outcome: "completed" }]);
  expect(await sim("snapshot")).toMatchObject({ light: { power: false }, lighting: { off_at: "23:59:59", on_outcome: "completed" },
    controller: { reported: { power: true, brightness: 50 } } });
  expect((await db.query("select sua_snapshot() as result")).rows).toMatchObject([{ result: { lighting: { off_at: "20:00:00" } } }]);
});
