import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./supabase";

/** Browser-side Supabase client used by the dashboard, with RLS active. */
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, detectSessionInUrl: true },
});
