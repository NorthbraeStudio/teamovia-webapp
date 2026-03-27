import { createClient, SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string;

declare global {
  var __supabaseClient: SupabaseClient | undefined;
}

if (!globalThis.__supabaseClient) {
  globalThis.__supabaseClient = createClient(supabaseUrl, supabaseAnonKey);
}

export const supabase = globalThis.__supabaseClient;