// /api/debug.js — Check all environment variables and connections
// DELETE THIS FILE before going to production!

export default async function handler(req, res) {
  const checks = {};

  // 1. Check env vars exist (don't reveal values, just presence)
  const vars = [
    'ANTHROPIC_API_KEY',
    'SUPABASE_URL',
    'SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
    'STRIPE_SECRET_KEY',
    'STRIPE_PRICE_ID',
    'STRIPE_WEBHOOK_SECRET',
  ];
  checks.env = {};
  for (const v of vars) {
    const val = process.env[v];
    checks.env[v] = val
      ? { set: true, length: val.length, preview: val.substring(0, 12) + '...' }
      : { set: false };
  }

  // 2. Test Anthropic API
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY || '',
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-3-5-haiku-20241022',
        max_tokens: 10,
        messages: [{ role: 'user', content: 'Say "OK"' }],
      }),
    });
    if (response.ok) {
      checks.anthropic = { status: 'OK', code: response.status };
    } else {
      const body = await response.text();
      checks.anthropic = { status: 'ERROR', code: response.status, body };
    }
  } catch (e) {
    checks.anthropic = { status: 'FAILED', error: e.message };
  }

  // 3. Test Supabase connection
  try {
    const { createClient } = await import('@supabase/supabase-js');
    const supabase = createClient(
      process.env.SUPABASE_URL || '',
      process.env.SUPABASE_SERVICE_ROLE_KEY || ''
    );
    const { data, error } = await supabase.from('profiles').select('id').limit(1);
    checks.supabase = error
      ? { status: 'ERROR', error: error.message }
      : { status: 'OK', rows: data?.length || 0 };
  } catch (e) {
    checks.supabase = { status: 'FAILED', error: e.message };
  }

  return res.status(200).json(checks);
}
