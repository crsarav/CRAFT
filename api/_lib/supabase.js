import { createClient } from '@supabase/supabase-js';

// Admin client (service_role) — bypasses RLS, server-side only
export function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    return null;
  }
  try {
    return createClient(url, key);
  } catch (e) {
    console.error('Supabase admin init failed:', e.message);
    return null;
  }
}

// Extract user from Authorization header
export async function getUser(req) {
  try {
    const auth = req.headers.authorization;
    if (!auth?.startsWith('Bearer ')) return null;

    const token = auth.replace('Bearer ', '');
    const supabase = getSupabaseAdmin();
    if (!supabase) return null;

    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) return null;

    return { id: user.id, email: user.email, token };
  } catch (e) {
    console.error('getUser error:', e.message);
    return null;
  }
}

// Get user profile with usage info
export async function getUserProfile(userId) {
  try {
    const supabase = getSupabaseAdmin();
    if (!supabase) return null;

    const { data: profile } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();

    const { data: dailyUsage } = await supabase
      .rpc('get_daily_usage', { p_user_id: userId });

    return {
      ...profile,
      daily_usage: dailyUsage || 0,
    };
  } catch (e) {
    console.error('getUserProfile error:', e.message);
    return null;
  }
}
