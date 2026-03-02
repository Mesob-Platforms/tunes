// js/accounts/config.js
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://qkdcloplojidvscgzfxq.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFrZGNsb3Bsb2ppZHZzY2d6ZnhxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA2MzU3MDgsImV4cCI6MjA4NjIxMTcwOH0.pUlvQK-FS2A54-ztAIaKtKpmxPn_RfkZpzGMjx7NidQ';

const ADMIN_EMAIL = 'naolmideksa@gmail.com';

/**
 * Google OAuth Web Client ID — used for web and in Supabase → Authentication → Google.
 * Same as configured in Supabase → Authentication → Providers → Google.
 */
const GOOGLE_WEB_CLIENT_ID = '917537000667-rnr049dt6m0qp1mehsdagctj0s31e137.apps.googleusercontent.com';

/**
 * Google OAuth Android Client ID — required for native "Continue with Google" on Android.
 * From Google Cloud Console → Credentials → Android OAuth client (package com.mesob.tunes + your SHA-1).
 */
const GOOGLE_ANDROID_CLIENT_ID = '917537000667-uji450r9mdj0a9vkjh7m8h66q519cht3.apps.googleusercontent.com';

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

export { supabase, SUPABASE_URL, SUPABASE_ANON_KEY, ADMIN_EMAIL, GOOGLE_WEB_CLIENT_ID, GOOGLE_ANDROID_CLIENT_ID };
