import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || '';
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || '';

if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
  console.warn(
    'Missing Supabase credentials. Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY environment variables.'
  );
}

export const supabase = SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY
  ? createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: {
        storage: localStorage,
        persistSession: true,
        autoRefreshToken: true,
      },
    })
  : null as unknown as ReturnType<typeof createClient<Database>>;