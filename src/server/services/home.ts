import "server-only";
import { MockAdapter } from "@/devices/mock/adapter";
import type { Activity, Snapshot } from "@/features/model";
import { rpc } from "@/server/database/rpc";

export function deviceAdapter() {
  if ((process.env.DEVICE_MODE ?? "mock") !== "mock") throw new Error("Unsupported DEVICE_MODE");
  return new MockAdapter();
}

export async function snapshot() {
  const adapter = deviceAdapter();
  const data = await rpc<Snapshot>("sua_snapshot");
  return { ...data, camera: adapter.cameraState(data.camera !== "off") };
}

export async function activity(before: string | null, limit: number) {
  const rows = await rpc<Activity[]>("sua_activity", { p_before: before, p_limit: limit + 1 });
  const items = rows.slice(0, limit);
  return { items, nextCursor: rows.length > limit ? items.at(-1)!.sequence : null };
}

export async function mutate(action: string, data: object) {
  const adapter = deviceAdapter();
  const simulation = action === "process" || action === "dispense" ? adapter.feederSimulation() : {};
  return rpc<Record<string, unknown>>("sua_mutate", { p_action: action, p_data: { ...data, ...simulation } });
}
