import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

const isValidUrl = (url: string): boolean => {
  if (!url) return false;
  try {
    new URL(url);
    return url.startsWith('http://') || url.startsWith('https://');
  } catch {
    return false;
  }
};

const shouldCreateClient = SUPABASE_URL && SUPABASE_KEY && isValidUrl(SUPABASE_URL);

export const supabase = shouldCreateClient
  ? createClient(SUPABASE_URL, SUPABASE_KEY)
  : createClient('https://placeholder.supabase.co', 'placeholder');

if (!shouldCreateClient) {
  console.warn('Supabase credentials not configured - real-time features disabled');
}
