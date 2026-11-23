import type { PGlite } from "@electric-sql/pglite";

export function openDatabase(): Promise<PGlite>;
