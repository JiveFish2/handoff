import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { Sql } from "./postgres";

// Applies every file in migrations/ that has not run yet, in name order, each in its own
// transaction. Plain SQL on purpose: the schema is part of what this project shows.
export async function migrate(sql: Sql, dir = path.join(process.cwd(), "migrations")) {
  await sql`CREATE TABLE IF NOT EXISTS public.schema_migrations (
    name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`;
  const done = new Set((await sql<{ name: string }[]>`SELECT name FROM public.schema_migrations`).map((r) => r.name));
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  const applied: string[] = [];
  for (const file of files) {
    if (done.has(file)) continue;
    const text = await readFile(path.join(dir, file), "utf8");
    await sql.begin(async (tx) => {
      await tx.unsafe(text);
      await tx`INSERT INTO public.schema_migrations (name) VALUES (${file})`;
    });
    applied.push(file);
  }
  return applied;
}
