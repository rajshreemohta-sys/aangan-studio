import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { requireEnv } from "./env";

/** Server-only Supabase client. Uses the secret key; RLS denies everything else. */
// Untyped on purpose: row shapes live in database.types.ts and are applied at the call site.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, "public", "public", any, any>;
let client: Db | undefined;

export function db(): Db {
  client ??= createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SECRET_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function must<R = any>(res: { data: unknown; error: { message: string } | null }, what: string): R {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  if (res.data === null || res.data === undefined) throw new Error(`${what}: no data`);
  return res.data as R;
}
