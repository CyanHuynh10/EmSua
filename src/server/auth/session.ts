import "server-only";
import { createHash, createHmac } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { makeSession, validSession } from "./crypto";

export const SESSION_COOKIE = "sua_session";

export function adminConfig() {
  const { ADMIN_USERNAME: username, ADMIN_PASSWORD_HASH: hash, SESSION_SECRET: secret } = process.env;
  if (!username || !hash || !secret || Buffer.byteLength(secret) < 32) {
    throw new Error("Admin configuration is missing");
  }
  const revision = createHash("sha256").update(username).update("\0").update(hash).digest("hex");
  return { username, hash, secret, revision };
}

export async function signedIn() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return false;
  try {
    const { secret, revision } = adminConfig();
    return validSession(token, secret, revision);
  } catch {
    return false;
  }
}

export async function requireAdmin() {
  if (!(await signedIn())) redirect("/login");
}

export async function setSession(secure: boolean, logout = false) {
  const jar = await cookies();
  const options = { httpOnly: true, sameSite: "strict" as const, secure, path: "/" };
  if (logout) {
    jar.set(SESSION_COOKIE, "", { ...options, maxAge: 0 });
    return;
  }
  const { secret, revision } = adminConfig();
  jar.set(SESSION_COOKIE, makeSession(secret, revision), options);
}

export function requestOrigin(request: Request) {
  const actual = new URL(request.url);
  const header = request.headers.get("origin");
  if (!header) return null;
  const allowed = [process.env.APP_ORIGIN];
  if (process.env.VERCEL === "1") {
    for (const host of [process.env.VERCEL_URL, process.env.VERCEL_BRANCH_URL,
      process.env.VERCEL_PROJECT_PRODUCTION_URL]) {
      if (host) allowed.push(`https://${host}`);
    }
  } else if (process.env.NODE_ENV !== "production" && ["localhost", "127.0.0.1", "[::1]"].includes(actual.hostname)) {
    allowed.push(actual.origin);
  }
  if (!allowed.includes(header) || request.headers.get("sec-fetch-site") === "cross-site") return null;
  return new URL(header);
}

export function loginBucket(request: Request, secret: string) {
  const ip = process.env.VERCEL === "1" ? request.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim() : null;
  return createHmac("sha256", secret).update(ip || "default").digest("hex");
}
