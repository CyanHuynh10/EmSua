import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";

export async function openDatabase() {
  const db = new PGlite();
  await db.exec("create role anon; create role authenticated; create role service_role bypassrls;");
  for (const migration of ["202611230001_init", "202611270001_lighting_simulation"]) {
    const sql = await readFile(new URL(`../supabase/migrations/${migration}.sql`, import.meta.url), "utf8");
    await db.exec(sql);
  }
  return db;
}
