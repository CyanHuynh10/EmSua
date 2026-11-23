import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";

export async function openDatabase() {
  const db = new PGlite();
  await db.exec("create role anon; create role authenticated; create role service_role bypassrls;");
  const sql = await readFile(new URL("../supabase/migrations/202611230001_init.sql", import.meta.url), "utf8");
  await db.exec(sql);
  return db;
}
