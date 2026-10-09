import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { requireEnv } from "./env";

/** Neon over HTTP: one round trip per query, nothing to pool on Vercel. */
let client: NeonQueryFunction<false, false> | undefined;

export function sql(): NeonQueryFunction<false, false> {
  client ??= neon(requireEnv("DATABASE_URL"));
  return client;
}

/** Parameterised query returning typed rows. */
export async function query<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  return (await sql().query(text, params)) as T[];
}

export async function one<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T | null> {
  return (await query<T>(text, params))[0] ?? null;
}

/** JSON values go in as text and are cast with ::jsonb in the SQL. */
export const json = (v: unknown) => JSON.stringify(v ?? null);
