// /api/me.js — Get current user's profile, usage, and limits
import { getUser, getUserProfile } from './_lib/supabase.js';

const FREE_DAILY = 3;
const PRO_DAILY = 30;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const user = await getUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });

  const profile = await getUserProfile(user.id);
  if (!profile) return res.status(404).json({ error: 'Profile not found' });

  const dailyLimit = profile.is_pro ? PRO_DAILY : FREE_DAILY + (profile.bonus_rewrites || 0);

  return res.status(200).json({
    id: profile.id,
    email: profile.email,
    isPro: profile.is_pro,
    referralCode: profile.referral_code,
    bonusRewrites: profile.bonus_rewrites || 0,
    usage: profile.daily_usage,
    limit: dailyLimit,
    remaining: Math.max(0, dailyLimit - profile.daily_usage),
    hasSubscription: !!profile.stripe_subscription_id,
  });
}
