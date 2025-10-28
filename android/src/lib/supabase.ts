import 'react-native-url-polyfill/auto';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '@env';

export const createClient = () => {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.error('⚠️ Supabase not configured. Please check your .env file');
    throw new Error('Supabase credentials not configured. Please add SUPABASE_URL and SUPABASE_ANON_KEY to your .env file');
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

