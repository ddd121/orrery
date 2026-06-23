import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Server-side Supabase client.
 *
 * Uses the SERVICE ROLE key, which bypasses RLS — so this module must NEVER be
 * imported into a client component or shipped to the browser. The `server-only`
 * import makes that a build-time error. (Non-`NEXT_PUBLIC_` env vars are also
 * stripped from the browser bundle, so the key cannot leak even by accident.)
 *
 * The app READS the resolved graph that the pipeline WRITES; it never runs
 * resolution itself. See ../../../CLAUDE.md.
 */
export function createServerClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY — copy .env.example to web/.env.local and fill it in.",
    );
  }
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
