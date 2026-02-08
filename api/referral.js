// /api/referral.js — Track referrals and award bonus rewrites
import { getUser, getSupabaseAdmin } from './_lib/supabase.js';

const BONUS_PER_REFERRAL = 3; // +3 rewrites/day per referral
const MAX_BONUS = 15; // Cap at +15/day

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const user = await getUser(req);
  if (!user) return res.status(401).json({ error: 'Login required' });

  const { referralCode } = req.body;
  if (!referralCode) return res.status(400).json({ error: 'Missing referral code' });

  const supabase = getSupabaseAdmin();

  // Find referrer
  const { data: referrer } = await supabase
    .from('profiles')
    .select('id, bonus_rewrites')
    .eq('referral_code', referralCode)
    .single();

  if (!referrer) return res.status(404).json({ error: 'Invalid referral code' });
  if (referrer.id === user.id) return res.status(400).json({ error: 'Cannot refer yourself' });

  // Check if this user was already referred
  const { data: myProfile } = await supabase
    .from('profiles')
    .select('referred_by')
    .eq('id', user.id)
    .single();

  if (myProfile?.referred_by) {
    return res.status(400).json({ error: 'Referral already applied' });
  }

  // Apply referral — both get bonus
  const referrerBonus = Math.min((referrer.bonus_rewrites || 0) + BONUS_PER_REFERRAL, MAX_BONUS);

  await supabase.from('profiles').update({
    bonus_rewrites: referrerBonus,
    updated_at: new Date().toISOString(),
  }).eq('id', referrer.id);

  await supabase.from('profiles').update({
    referred_by: referralCode,
    bonus_rewrites: BONUS_PER_REFERRAL,
    updated_at: new Date().toISOString(),
  }).eq('id', user.id);

  return res.status(200).json({
    success: true,
    bonusAwarded: BONUS_PER_REFERRAL,
    message: `+${BONUS_PER_REFERRAL} bonus rewrites/day activated!`,
  });
}
