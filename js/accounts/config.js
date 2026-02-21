// js/accounts/config.js
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://qkdcloplojidvscgzfxq.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFrZGNsb3Bsb2ppZHZzY2d6ZnhxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA2MzU3MDgsImV4cCI6MjA4NjIxMTcwOH0.pUlvQK-FS2A54-ztAIaKtKpmxPn_RfkZpzGMjx7NidQ';

const ADMIN_EMAIL = 'naolmideksa@gmail.com';

/**
 * Google OAuth Web Client ID — required for native Google One Tap sign-in.
 * Get this from Google Cloud Console → APIs & Credentials → OAuth 2.0 Client IDs
 * (the **Web application** type, NOT Android). It's the same client ID configured in
 * Supabase → Authentication → Providers → Google.
 * Leave empty to fall back to the standard Supabase OAuth redirect flow.
 */
const GOOGLE_WEB_CLIENT_ID = '917537000667-ddotjubit837hn0bnginptc1ihrnqaql.apps.googleusercontent.com';

let supabase = null;

try {
    supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    console.log('Supabase client initialized');
} catch (error) {
    console.error('Error initializing Supabase:', error);
}

export function isAdminEmail(email) {
    return email && email.toLowerCase() === ADMIN_EMAIL.toLowerCase();
}

export { supabase, SUPABASE_URL, SUPABASE_ANON_KEY, ADMIN_EMAIL, GOOGLE_WEB_CLIENT_ID };
