import { scryptSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { makeSession, passwordMatches, SESSION_SECONDS, validSession } from "../src/server/auth/crypto";

describe("admin session", () => {
  it("validates correct and incorrect passwords", async () => {
    const salt = Buffer.alloc(16, 7);
    const hash = `scrypt:${salt.toString("hex")}:${scryptSync("test password", salt, 64).toString("hex")}`;
    expect(await passwordMatches("test password", hash)).toBe(true);
    expect(await passwordMatches("wrong password", hash)).toBe(false);
    await expect(passwordMatches("test password", "malformed")).rejects.toThrow();
  });

  it("rejects expired, tampered and superseded sessions", () => {
    const token = makeSession("test signing key", "revision", 0);
    expect(validSession(token, "test signing key", "revision", 100)).toBe(true);
    expect(validSession(token, "test signing key", "new revision", 100)).toBe(false);
    expect(validSession(token, "test signing key", "revision", SESSION_SECONDS * 1000)).toBe(false);
    expect(validSession(token.replace(/^\d+/, "99999"), "test signing key", "revision", 100)).toBe(false);
  });
});
