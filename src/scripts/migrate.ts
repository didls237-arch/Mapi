import fs from "node:fs/promises";
import path from "node:path";
import { pool } from "../db.js";

async function ensureMigrationTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id BIGSERIAL PRIMARY KEY,
      filename TEXT NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function hasMigration(filename: string): Promise<boolean> {
  const result = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE filename = $1) AS exists`,
    [filename]
  );
  return Boolean(result.rows[0]?.exists);
}

async function applyMigration(filename: string, sql: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(sql);
    await client.query("INSERT INTO schema_migrations(filename) VALUES ($1)", [filename]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function main(): Promise<void> {
  await ensureMigrationTable();

  const sqlDir = path.join(process.cwd(), "sql");
  const files = (await fs.readdir(sqlDir))
    .filter((name) => name.endsWith(".sql"))
    .sort((a, b) => a.localeCompare(b));

  for (const file of files) {
    const applied = await hasMigration(file);
    if (applied) {
      console.log(`Skip migration (already applied): ${file}`);
      continue;
    }

    const sqlPath = path.join(sqlDir, file);
    const sql = await fs.readFile(sqlPath, "utf8");
    await applyMigration(file, sql);
    console.log(`Migration applied: ${file}`);
  }

  await pool.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});