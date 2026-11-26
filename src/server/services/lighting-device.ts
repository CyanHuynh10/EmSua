import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { LIGHTING_DEVICE_ID } from "@/features/model";
import { rpc } from "@/server/database/rpc";

export function simulationEnabled() {
  return process.env.VERCEL_ENV !== "production" && process.env.VERCEL_TARGET_ENV !== "production" &&
    /^[a-f0-9]{64}$/.test(process.env.LIGHTING_DEVICE_TOKEN_HASH ?? "");
}

const state = z.strictObject({ power: z.boolean(), brightness: z.number().int().min(0).max(100) });
const session = z.strictObject({ bootId: z.uuid() });
const versioned = session.extend({ stateVersion: z.number().int().min(0).max(2147483647) });
const ack = versioned.extend({ commandId: z.uuid(), leaseId: z.uuid() });
const endpoints = {
  heartbeat: { action: "heartbeat", schema: versioned.extend({
    boot: z.boolean(), firmwareVersion: z.string().regex(/^[a-z0-9.-]{1,48}$/), state,
  }) },
  "commands/claim": { action: "claim", schema: session },
  "commands/ack": { action: "ack", schema: z.discriminatedUnion("status", [
    ack.extend({ status: z.literal("completed"), state }),
    ack.extend({ status: z.literal("failed"), errorCode: z.enum(["LED_DRIVER_ERROR", "COMMAND_EXPIRED"]) }),
  ]) },
  state: { action: "state", schema: versioned.extend({ source: z.enum(["local_button", "local_potentiometer", "serial"]), state }) },
};

export const apiHeaders = { "Cache-Control": "no-store" };

async function readDeviceBody(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) return null;
  const buffer = new Uint8Array(1024);
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (length + value.byteLength > buffer.byteLength) {
      await reader.cancel();
      return undefined;
    }
    buffer.set(value, length);
    length += value.byteLength;
  }
  try { return JSON.parse(new TextDecoder().decode(buffer.subarray(0, length))) as unknown; }
  catch { return null; }
}

export async function lightingDevice(request: Request, path: string) {
  function fail(status: number, code: string) {
    return NextResponse.json({ success: false, error: { code } }, { status, headers: apiHeaders });
  }
  if (!simulationEnabled() || !Object.hasOwn(endpoints, path) || request.method !== "POST") return fail(404, "NOT_FOUND");
  const token = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(request.headers.get("authorization") ?? "")?.[1];
  if (request.headers.get("x-device-id") !== LIGHTING_DEVICE_ID || !token || !timingSafeEqual(
    createHash("sha256").update(token).digest(), Buffer.from(process.env.LIGHTING_DEVICE_TOKEN_HASH!, "hex"),
  )) return fail(401, "INVALID_DEVICE_CREDENTIALS");
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") return fail(415, "INVALID_CONTENT_TYPE");
  if (Number(request.headers.get("content-length")) > 1024) return fail(413, "BODY_TOO_LARGE");
  const endpoint = endpoints[path as keyof typeof endpoints];
  const raw = await readDeviceBody(request);
  if (raw === undefined) return fail(413, "BODY_TOO_LARGE");
  const body = endpoint.schema.safeParse(raw);
  if (!body.success) return fail(422, "VALIDATION_ERROR");
  const result = await rpc<{ error?: string; command?: { id: string } }>("sua_lighting_sim", { p_action: endpoint.action, p_data: body.data });
  if (result.error) return fail(result.error === "RATE_LIMITED" ? 429 : result.error === "COMMAND_NOT_FOUND" ? 404 : 409, result.error);
  if (result.command || endpoint.action === "ack") {
    console.info("[lighting]", endpoint.action, result.command?.id ?? ("commandId" in body.data ? body.data.commandId : ""));
  }
  return NextResponse.json({ success: true, data: result }, { headers: apiHeaders });
}
