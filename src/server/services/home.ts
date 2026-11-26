import "server-only";
import { MockAdapter } from "@/devices/mock/adapter";
import type { Activity, Snapshot } from "@/features/model";
import { rpc } from "@/server/database/rpc";
import { simulationEnabled } from "./lighting-device";

export function deviceAdapter() {
  if ((process.env.DEVICE_MODE ?? "mock") !== "mock") throw new Error("Unsupported DEVICE_MODE");
  return new MockAdapter();
}

export async function snapshot() {
  const adapter = deviceAdapter();
  const data = simulationEnabled() ? await rpc<Snapshot>("sua_lighting_sim", { p_action: "snapshot", p_data: {} }) :
    await rpc<Snapshot>("sua_snapshot");
  const light = data.controller?.mode === "simulation" ? data.controller.reported : data.light;
  return { ...data, light, camera: adapter.cameraState(data.camera !== "off") };
}

export async function activity(before: string | null, limit: number) {
  const rows = await rpc<Activity[]>("sua_activity", { p_before: before, p_limit: limit + 1 });
  const items = rows.slice(0, limit);
  return { items, nextCursor: rows.length > limit ? items.at(-1)!.sequence : null };
}

export async function mutate(action: string, data: object) {
  const adapter = deviceAdapter();
  const feeder = action === "process" || action === "dispense" ? adapter.feederSimulation() : {};
  const p_data: Record<string, unknown> = { ...data, ...feeder };
  if (["light", "process", "light_schedule", "cancel_light"].includes(action)) {
    if (simulationEnabled()) p_data.simulationEnabled = true;
    else {
      delete p_data.expected_mode;
      delete p_data.request_id;
    }
  }
  return rpc<Record<string, unknown>>("sua_mutate", { p_action: action, p_data });
}
