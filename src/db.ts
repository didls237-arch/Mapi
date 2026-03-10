import { Pool } from "pg";
import type { QueryResultRow } from "pg";
import { config } from "./config.js";

export const pool = new Pool({
  connectionString: config.PG_CONNECTION_STRING
});

export async function query<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params: unknown[] = []
): Promise<T[]> {
  const result = await pool.query<T>(sql, params);
  return result.rows;
}