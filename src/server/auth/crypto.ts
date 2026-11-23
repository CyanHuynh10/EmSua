import { createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const derive = promisify(scrypt);
export const SESSION_SECONDS = 4 * 60 * 60;

export async function passwordMatches(password: string, encoded: string) {
  const match = /^scrypt:([a-f0-9]{32}):([a-f0-9]{128})$/i.exec(encoded);
  if (!match) throw new Error("Invalid ADMIN_PASSWORD_HASH format");
  const actual = await derive(password, Buffer.from(match[1], "hex"), 64) as Buffer;
  return timingSafeEqual(actual, Buffer.from(match[2], "hex"));
}

function sign(value: string, secret: string) {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

export function makeSession(secret: string, revision: string, now = Date.now()) {
  const value = `${Math.floor(now / 1000) + SESSION_SECONDS}.${randomBytes(16).toString("hex")}`;
  return `${value}.${sign(`${value}.${revision}`, secret)}`;
}

export function validSession(token: string, secret: string, revision: string, now = Date.now()) {
  const match = /^(\d{1,12})\.([a-f0-9]{32})\.([\w-]{43})$/.exec(token);
  if (!match || Number(match[1]) <= Math.floor(now / 1000)) return false;
  const expected = sign(`${match[1]}.${match[2]}.${revision}`, secret);
  return timingSafeEqual(Buffer.from(match[3]), Buffer.from(expected));
}
