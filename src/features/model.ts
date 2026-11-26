export type Outcome = "executing" | "completed" | "failed" | "missed" | "skipped_already_satisfied";
export type CameraState = "off" | "connecting" | "online" | "offline" | "error";
export type DeviceMode = "mock" | "simulation" | "real";
export const LIGHTING_DEVICE_ID = "sua-controller-wokwi-01";
export interface LightState { power: boolean; brightness: number }
export type CommandStatus = "pending" | "claimed" | "completed" | "failed" | "expired" | "cancelled";
export interface LightingCommand { commandId: string; status: CommandStatus; errorCode?: string }
export interface LightingController {
  mode: Exclude<DeviceMode, "real">;
  deviceId: string;
  online: boolean;
  lastSeenAt: string | null;
  firmwareVersion: string | null;
  pending: boolean;
  reported: LightState | null;
  desired: LightState | null;
  stateVersion: number;
}

interface Schedule {
  id: string;
  day: string;
  version: number;
  cancelled: boolean;
}

export interface Activity {
  id: string;
  sequence: string;
  event: string;
  detail: { action?: string; source?: string; scheduled_at?: string; commandId?: string };
  created_at: string;
}

export interface Snapshot {
  day: string;
  serverTime: string;
  light: LightState | null;
  controller?: LightingController;
  camera: CameraState;
  feeder: { status: Outcome; created_at: string } | null;
  feeding: (Schedule & { feed_at: string; outcome: Outcome | null }) | null;
  lighting: (Schedule & {
    on_at: string; off_at: string; on_outcome: Outcome | null; off_outcome: Outcome | null;
  }) | null;
  settings: { servo_ms: number; version: number };
  activity: Activity[];
}

export type ApiResponse<T> = { success: true; data: T } |
  { success: false; error: { code: string; message: string } };

export const TIME_ZONE = "Asia/Ho_Chi_Minh";
export const POLL_INTERVAL = 15_000;
export const SERVO_MIN = 250;
export const SERVO_MAX = 3000;
export const MODE_LABEL = { mock: "Mock Mode", simulation: "Simulation Mode — Wokwi", real: "Real Mode — Chưa khả dụng" };

export function localTime(value: string) {
  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: TIME_ZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(new Date(value));
}
