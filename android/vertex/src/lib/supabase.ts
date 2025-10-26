import 'react-native-url-polyfill/auto';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';

// TODO: Replace these with your Supabase credentials from .env
// For now, these will be replaced at build time
// Edit this file and add your credentials from your Supabase dashboard
const SUPABASE_URL = 'https://gdctvplxiogaicjpbvee.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdkY3R2cGx4aW9nYWljanBidmVlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjExNTA1NzYsImV4cCI6MjA3NjcyNjU3Nn0.T6pUQyYdmK6sYzWTABRLrf0SIEuF_96Z8CQvJJaGQm8';

export const createClient = () => {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || SUPABASE_URL.includes('your-project')) {
    console.warn('⚠️ Supabase not configured. Please update SUPABASE_URL and SUPABASE_ANON_KEY in src/lib/supabase.ts');
    // Return a dummy client that will fail gracefully
    throw new Error('Supabase credentials not configured');
  }
  return createSupabaseClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      storage: AsyncStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
    global: {
      fetch: fetch,
      headers: {
        'X-Client-Info': 'vertex-mobile',
      },
    },
  });
};

