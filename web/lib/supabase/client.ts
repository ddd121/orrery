import { createClient } from "@supabase/supabase-js";

/**
 * Browser Supabase client (publishable/anon key). Reads only — the resolved graph
 * is exposed read-only to the anon role via RLS SELECT policies. No writes, no
 * service role in the browser. (See CLAUDE.md.)
 */
export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);
