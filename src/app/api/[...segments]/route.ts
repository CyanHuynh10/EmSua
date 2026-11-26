import { NextResponse } from "next/server";
import { z } from "zod";
import { SERVO_MIN, SERVO_MAX, type Snapshot } from "@/features/model";
import { passwordMatches } from "@/server/auth/crypto";
import { adminConfig, loginBucket, requestOrigin, setSession, signedIn } from "@/server/auth/session";
import { rpc } from "@/server/database/rpc";
import { activity, deviceAdapter, mutate, snapshot } from "@/server/services/home";
import { lightingDevice, simulationEnabled } from "@/server/services/lighting-device";

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const schedule = z.object({ version: z.number().int().min(0).max(2147483647), day: z.iso.date() });
const mode = z.enum(["mock", "simulation"]);
const lightSchedule = schedule.extend({ expected_mode: mode.optional() });
const empty = z.strictObject({});
const actions: Record<string, { name: string; schema: z.ZodType<object> }> = {
  "POST feeder/dispense": { name: "dispense", schema: z.strictObject({ request_id: z.uuid() }) },
  "PUT feeder/schedule": { name: "feed_schedule", schema: schedule.extend({ feed_at: time }).strict() },
  "DELETE feeder/schedule": { name: "cancel_feed", schema: schedule.strict() },
  "PATCH light": {
    name: "light",
    schema: z.strictObject({ power: z.boolean().optional(), brightness: z.number().int().min(0).max(100).optional(),
      request_id: z.uuid().optional(), expected_mode: mode.optional() })
      .refine((value) => value.power !== undefined || value.brightness !== undefined),
  },
  "PUT light/schedule": {
    name: "light_schedule",
    schema: lightSchedule.extend({ on_at: time, off_at: time }).strict().refine((value) => value.on_at < value.off_at),
  },
  "DELETE light/schedule": { name: "cancel_light", schema: lightSchedule.strict() },
  "PATCH camera": { name: "camera", schema: z.strictObject({ power: z.boolean() }) },
  "PATCH settings": {
    name: "settings",
    schema: z.strictObject({ servo_ms: z.number().int().min(SERVO_MIN).max(SERVO_MAX), version: z.number().int().min(1).max(2147483647) }),
  },
  "POST schedules/process": { name: "process", schema: empty },
};

const readers: Record<string, (data: Snapshot) => unknown> = {
  dashboard: (data) => data,
  devices: (data) => ({ mode: deviceAdapter().mode, connected: deviceAdapter().connected, feeder: data.feeder, light: data.light, camera: data.camera, controller: data.controller }),
  "feeder/schedule": (data) => data.feeding,
  light: (data) => data.controller?.mode === "simulation" ? { ...data.controller.reported, controller: data.controller } : data.light,
  "light/schedule": (data) => data.lighting,
  camera: (data) => ({ status: data.camera }),
  settings: (data) => ({ ...data.settings, mode: deviceAdapter().mode, connected: deviceAdapter().connected, controller: data.controller }),
};

const domainErrors: Record<string, [number, string]> = {
  VERSION_CONFLICT: [409, "Dữ liệu đã thay đổi. Tải lại dữ liệu trước khi lưu."],
  DAY_CHANGED: [409, "Đã sang ngày mới. Tải lại dữ liệu để tạo lịch hôm nay."],
  FEEDER_BUSY: [409, "Máy đang chạy một chu trình cho ăn."],
  FEEDER_COOLDOWN: [429, "Chờ vài giây trước khi bắt đầu chu trình mới."],
  SCHEDULE_LOCKED: [409, "Mốc lịch đã đến giờ hoặc đã được xử lý."],
  PAST_TIME: [422, "Chọn giờ còn lại trong hôm nay theo đúng thứ tự."],
  DEVICE_OFFLINE: [409, "ESP32 Wokwi đang ngoại tuyến."],
  MODE_CHANGED: [409, "Chế độ đèn đã thay đổi. Tải lại trạng thái để tiếp tục."],
  COMMAND_IN_PROGRESS: [409, "Đợi ESP32 xử lý xong lệnh trước khi đổi chế độ."],
  QUEUE_FULL: [429, "Hàng đợi đèn đã đầy. Thử lại sau."],
  RATE_LIMITED: [429, "Đợi một chút trước khi gửi lệnh tiếp theo."],
};

const headers = { "Cache-Control": "no-store" };
const success = (data: unknown, status = 200) => NextResponse.json({ success: true, data }, { status, headers });
const failure = (status: number, code: string, message: string) =>
  NextResponse.json({ success: false, error: { code, message } }, { status, headers });

const login = z.strictObject({ username: z.string().trim().min(1).max(100), password: z.string().min(1).max(256) });

async function handle(request: Request, ctx: RouteContext<"/api/[...segments]">) {
  const route = (await ctx.params).segments.join("/");
  const method = request.method;
  const isLogin = route === "auth/login" && method === "POST";
  try {
    if (route.startsWith("device/")) return await lightingDevice(request, route.slice("device/".length));
    if (!isLogin && !(await signedIn())) return failure(401, "UNAUTHENTICATED", "Vui lòng đăng nhập.");
    if (method === "GET") {
      if (simulationEnabled() && route.startsWith("light/commands/")) {
        const id = z.uuid().safeParse(route.slice("light/commands/".length));
        if (!id.success) return failure(422, "VALIDATION_ERROR", "Mã lệnh không hợp lệ.");
        const result = await rpc<Record<string, unknown>>("sua_lighting_sim", { p_action: "command", p_data: { commandId: id.data } });
        return result.error ? failure(404, "COMMAND_NOT_FOUND", "Không tìm thấy lệnh đèn.") : success(result);
      }
      if (route === "activity") {
        const params = new URL(request.url).searchParams;
        const query = z.object({
          before: z.string().regex(/^[1-9]\d{0,18}$/).refine((value) => BigInt(value) <= 9223372036854775807n).optional(),
          limit: z.coerce.number().int().min(1).max(50),
        }).safeParse({ before: params.get("before") ?? undefined, limit: params.get("limit") ?? 15 });
        if (!query.success) return failure(422, "VALIDATION_ERROR", "Tham số phân trang không hợp lệ.");
        return success(await activity(query.data.before ?? null, query.data.limit));
      }
      const reader = Object.hasOwn(readers, route) ? readers[route] : undefined;
      return reader ? success(reader(await snapshot())) : failure(404, "NOT_FOUND", "Không tìm thấy API.");
    }
    const origin = requestOrigin(request);
    if (!origin) return failure(403, "INVALID_ORIGIN", "Nguồn yêu cầu không hợp lệ.");
    if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") {
      return failure(415, "INVALID_CONTENT_TYPE", "Yêu cầu định dạng JSON.");
    }
    if (Number(request.headers.get("content-length")) > 4096) {
      return failure(413, "BODY_TOO_LARGE", "Dữ liệu vượt giới hạn.");
    }
    const body = await request.json().catch(() => null);
    if (isLogin) {
      const data = login.safeParse(body);
      if (!data.success) return failure(422, "VALIDATION_ERROR", "Nhập tài khoản và mật khẩu hợp lệ.");
      const { username, hash, secret } = adminConfig();
      if (!(await rpc<boolean>("sua_login_limit", { p_bucket: loginBucket(request, secret) }))) {
        return failure(429, "RATE_LIMITED", "Quá nhiều lần thử. Vui lòng thử lại sau.");
      }
      const matches = await passwordMatches(data.data.password, hash);
      if (!matches || data.data.username !== username) return failure(401, "BAD_CREDENTIALS", "Sai tài khoản hoặc mật khẩu.");
      await setSession(origin.protocol === "https:");
      return success(null);
    }
    if (route === "auth/logout" && method === "POST") {
      await setSession(origin.protocol === "https:", true);
      return success(null);
    }
    if (route === "settings/lighting" && method === "PATCH" && simulationEnabled()) {
      const requested = z.strictObject({ mode }).safeParse(body);
      if (!requested.success) return failure(422, "VALIDATION_ERROR", "Chế độ đèn không hợp lệ.");
      const result = await rpc<{ error?: string }>("sua_lighting_sim", { p_action: "mode", p_data: requested.data });
      return result.error ? failure(409, result.error, domainErrors.COMMAND_IN_PROGRESS[1]) : success(result);
    }
    const action = actions[`${method} ${route}`];
    if (!action) return failure(404, "NOT_FOUND", "Không tìm thấy API.");
    const payload = action.schema.safeParse(body);
    if (!payload.success) return failure(422, "VALIDATION_ERROR", "Kiểm tra lại các trường đã nhập.");
    if ("expected_mode" in payload.data && payload.data.expected_mode === "simulation" && !simulationEnabled()) {
      return failure(409, "MODE_CHANGED", domainErrors.MODE_CHANGED[1]);
    }
    const result = await mutate(action.name, payload.data);
    if (typeof result.error === "string") {
      const [status, message] = domainErrors[result.error] ?? [400, "Không xử lý được yêu cầu."];
      return failure(status, result.error, message);
    }
    const accepted = result.status === "pending" || result.status === "claimed" ||
      (result.status === "executing" && result.duplicate === false);
    return success(result, accepted ? 202 : 200);
  } catch (error) {
    console.error("[sua]", method, route, error instanceof Error ? error.message : "Unexpected error");
    return failure(503, "SERVICE_UNAVAILABLE", "Dịch vụ đang gián đoạn. Vui lòng thử lại sau.");
  }
}

export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const PUT = handle;
export const DELETE = handle;
