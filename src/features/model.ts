export type Outcome = "executing" | "completed" | "failed" | "missed" | "skipped_already_satisfied";
export type CameraState = "off" | "connecting" | "online" | "offline" | "error";

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
  detail: { action?: string; source?: string; scheduled_at?: string };
  created_at: string;
}

export interface Snapshot {
  day: string;
  serverTime: string;
  light: { power: boolean; brightness: number };
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

export function localTime(value: string) {
  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: TIME_ZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(new Date(value));
}
