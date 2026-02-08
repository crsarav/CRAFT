// /api/rewrite.js — Server-side enforced usage limits with Haiku 4.5
import { getUser, getUserProfile, getSupabaseAdmin } from './_lib/supabase.js';

const FREE_DAILY = 3;
const PRO_DAILY = 30;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { message, tone, toneDesc } = req.body;
    if (!message || !tone) return res.status(400).json({ error: 'Missing message or tone' });
    if (message.length > 3000) return res.status(400).json({ error: 'Message too long (max 3,000 chars)' });

    const supabase = getSupabaseAdmin();
    const user = await getUser(req);

    // Authenticated user: enforce server-side limits
    if (user && supabase) {
      const profile = await getUserProfile(user.id);
      const isPro = profile?.is_pro || false;
      const bonus = profile?.bonus_rewrites || 0;
      const currentUsage = profile?.daily_usage || 0;
      const dailyLimit = isPro ? PRO_DAILY : FREE_DAILY + bonus;

      if (currentUsage >= dailyLimit) {
        return res.status(429).json({
          error: isPro
            ? 'Daily limit reached (30). Resets at midnight UTC.'
            : 'Free limit reached. Upgrade to Pro for 30/day.',
          usage: currentUsage,
          limit: dailyLimit,
          upgrade: !isPro,
        });
      }

      // Call AI
      const rewrite = await callHaiku(message, tone, toneDesc);
      if (!rewrite) return res.status(502).json({ error: 'AI service temporarily unavailable' });

      // Increment usage + log
      try {
        await supabase.rpc('increment_usage', { p_user_id: user.id });
        await supabase.from('rewrites').insert({
          user_id: user.id, tone, input_length: message.length, output_length: rewrite.length,
        });
      } catch (dbErr) {
        console.error('DB usage tracking error:', dbErr);
        // Don't fail the request if tracking fails
      }

      return res.status(200).json({
        rewrite,
        usage: currentUsage + 1,
        limit: dailyLimit,
        isPro,
      });
    }

    // Anonymous or Supabase unavailable: allow rewrites (client-tracked)
    const rewrite = await callHaiku(message, tone, toneDesc);
    if (!rewrite) return res.status(502).json({ error: 'AI service temporarily unavailable' });

    return res.status(200).json({
      rewrite,
      usage: null,
      limit: FREE_DAILY,
      isPro: false,
    });
  } catch (err) {
    console.error('Handler crash:', err);
    return res.status(500).json({ error: 'Internal server error: ' + err.message });
  }
}

async function callHaiku(message, tone, toneDesc) {
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-3-5-haiku-20241022',
        max_tokens: 512,
        messages: [{
          role: 'user',
          content: `Rewrite this message in a ${tone.toLowerCase()} tone (${toneDesc.toLowerCase()}). Return ONLY the rewritten message — no intro, no explanation, no quotes:\n\n${message}`,
        }],
      }),
    });
    if (!response.ok) {
      const errBody = await response.text();
      console.error('Anthropic error:', response.status, errBody);
      return null;
    }
    const data = await response.json();
    return data.content?.map((c) => c.text || '').join('') || null;
  } catch (err) {
    console.error('Haiku error:', err);
    return null;
  }
}
