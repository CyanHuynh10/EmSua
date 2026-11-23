import type { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { openDatabase } from "./postgres.mjs";

let db: PGlite;
const local = "(clock_timestamp() at time zone 'Asia/Ho_Chi_Minh')";
const mutate = async (action: string, data: object = {}) => {
  const result = await db.query<{ result: Record<string, unknown> }>("select sua_mutate($1, $2) as result", [action, JSON.stringify(data)]);
  return result.rows[0].result;
};

beforeAll(async () => { db = await openDatabase(); });
beforeEach(async () => {
  await db.exec(`truncate activity_logs, login_limits, device_commands, schedule_executions, feeding_schedules, lighting_schedules;
    update system_settings set version=1, servo_ms=3000;
    update device_states set power=false, brightness=75;`);
});
afterAll(async () => { await db?.close(); });

it("isolates privileged tables and RPCs from anonymous roles while allowing service_role", async () => {
  await db.exec("set role anon");
  try {
    await expect(db.query("select sua_snapshot()")).rejects.toThrow(/permission denied/);
    await expect(db.query("select * from system_settings")).rejects.toThrow(/permission denied/);
  } finally {
    await db.exec("reset role");
  }
  await db.exec("set role service_role");
  try {
    await expect(mutate("light", { power: true })).resolves.toEqual({ status: "completed" });
  } finally {
    await db.exec("reset role");
  }
});

it("rate limits repeated login attempts in the same database bucket", async () => {
  for (let attempt = 1; attempt <= 9; attempt++) {
    const { rows } = await db.query<{ allowed: boolean }>("select sua_login_limit('test') as allowed");
    expect(rows[0].allowed).toBe(attempt <= 8);
  }
});

it("deduplicates retries and rejects simultaneous cycles, persists failure and avoids automatic retry", async () => {
  const id = randomUUID();
  expect(await mutate("dispense", { request_id: id, fail: true })).toEqual({ status: "executing", duplicate: false });
  expect(await mutate("dispense", { request_id: id })).toEqual({ status: "executing", duplicate: true });
  expect(await mutate("dispense", { request_id: randomUUID() })).toEqual({ error: "FEEDER_BUSY" });
  await db.exec("update device_commands set created_at=now()-interval '4 sec', finish_at=now()-interval '1 sec'");
  await mutate("process");
  await mutate("process");
  expect(await mutate("dispense", { request_id: id })).toEqual({ status: "failed", duplicate: true });
  const count = await db.query("select count(*)::integer n from device_commands");
  expect(count.rows[0]).toEqual({ n: 1 });
});

it("processes orders within 30 seconds at most once and recovers completed feeder state", async () => {
  await db.exec(`insert into feeding_schedules(day,feed_at) values (${local}::date, (${local}-interval '8 sec')::time)`);
  const results = await Promise.all([mutate("process"), mutate("process")]);
  expect(results.map((result) => result.processed).sort()).toEqual([0, 1]);
  await db.exec("update device_commands set created_at=now()-interval '4 sec', finish_at=now()-interval '1 sec'");
  await mutate("process");
  expect((await db.query("select outcome from schedule_executions")).rows).toEqual([{ outcome: "completed" }]);
});

it("marks expired schedules once, with neither same-day late execution nor previous-day catch-up", async () => {
  await db.exec(`insert into feeding_schedules(day,feed_at) values (${local}::date, (${local}-interval '35 sec')::time),
    (${local}::date-1,'23:59')`);
  await expect(db.exec(`insert into feeding_schedules(day,feed_at) values (${local}::date,'18:00')`)).rejects.toThrow(/unique constraint/);
  expect(await mutate("process")).toEqual({ processed: 2 });
  expect(await mutate("process")).toEqual({ processed: 0 });
  expect((await db.query("select outcome from schedule_executions")).rows).toEqual([{ outcome: "missed" }, { outcome: "missed" }]);
  expect((await db.query("select * from device_commands")).rows).toEqual([]);
});

it("keeps manual brightness and schedule history when the on action is already satisfied", async () => {
  await mutate("light", { power: true, brightness: 41 });
  await db.exec(`insert into lighting_schedules(day,on_at,off_at) values (${local}::date, (${local}-interval '8 sec')::time,'23:59:59')`);
  expect(await mutate("process")).toEqual({ processed: 1 });
  const { rows: [row] } = await db.query<{ outcome: string; on_at: string; day: string }>(
    "select outcome, on_at::text, day::text from schedule_executions join lighting_schedules on lighting_id=lighting_schedules.id");
  expect(row.outcome).toBe("skipped_already_satisfied");
  expect(await mutate("light_schedule", { day: row.day, on_at: row.on_at, off_at: "23:59:58", version: 1 })).toEqual({ status: "completed" });
  expect(await mutate("light_schedule", { day: row.day, on_at: "23:59:57", off_at: "23:59:58", version: 2 })).toEqual({ error: "SCHEDULE_LOCKED" });
  await mutate("light", { power: false });
  expect((await db.query("select brightness from device_states join devices on devices.id=device_id where kind='light'")).rows).toEqual([{ brightness: 41 }]);
  expect((await db.query("select outcome from schedule_executions")).rows).toEqual([{ outcome: "skipped_already_satisfied" }]);
});

it("rejects stale settings versions and pages activities with a stable cursor", async () => {
  expect(await mutate("settings", { version: 1, servo_ms: 1200 })).toEqual({ status: "completed" });
  expect(await mutate("settings", { version: 1, servo_ms: 1300 })).toEqual({ error: "VERSION_CONFLICT" });
  await mutate("camera", { power: true });
  await mutate("camera", { power: false });
  type Page = { items: { sequence: string; event: string }[] };
  const first = await db.query<Page>("select sua_activity(null, 2) as items");
  expect(first.rows[0].items.map((entry) => entry.event)).toEqual(["camera_changed", "camera_changed"]);
  const second = await db.query<Page>("select sua_activity($1, 2) as items", [first.rows[0].items[1].sequence]);
  expect(second.rows[0].items.map((entry) => entry.event)).toEqual(["settings_changed"]);
});
