// /api/checkout.js — Create Stripe Checkout session for Pro subscription
import Stripe from 'stripe';
import { getUser, getSupabaseAdmin } from './_lib/supabase.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const user = await getUser(req);
  if (!user) return res.status(401).json({ error: 'Login required' });

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const supabase = getSupabaseAdmin();

  // Get or create Stripe customer
  const { data: profile } = await supabase
    .from('profiles')
    .select('stripe_customer_id, email')
    .eq('id', user.id)
    .single();

  let customerId = profile?.stripe_customer_id;

  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email,
      metadata: { supabase_user_id: user.id },
    });
    customerId = customer.id;

    await supabase
      .from('profiles')
      .update({ stripe_customer_id: customerId })
      .eq('id', user.id);
  }

  // Create checkout session
  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: 'subscription',
    line_items: [{
      price: process.env.STRIPE_PRICE_ID, // Your $5/mo price ID
      quantity: 1,
    }],
    subscription_data: {
      trial_period_days: 7,
      metadata: { supabase_user_id: user.id },
    },
    success_url: `${process.env.NEXT_PUBLIC_SITE_URL || 'https://rewritemessage.com'}?upgraded=true`,
    cancel_url: `${process.env.NEXT_PUBLIC_SITE_URL || 'https://rewritemessage.com'}?cancelled=true`,
    allow_promotion_codes: true,
  });

  return res.status(200).json({ url: session.url });
}
