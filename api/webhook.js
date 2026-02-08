// /api/webhook.js — Stripe webhook handler
// Handles: subscription created, updated, deleted, payment failed
import Stripe from 'stripe';
import { getSupabaseAdmin } from './_lib/supabase.js';

// Vercel needs raw body for signature verification
export const config = {
  api: { bodyParser: false },
};

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const supabase = getSupabaseAdmin();
  const sig = req.headers['stripe-signature'];

  let event;
  try {
    const rawBody = await getRawBody(req);
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature error:', err.message);
    return res.status(400).json({ error: `Webhook Error: ${err.message}` });
  }

  const { type, data } = event;

  try {
    switch (type) {
      // New subscription or reactivation
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const sub = data.object;
        const customerId = sub.customer;
        const isActive = ['active', 'trialing'].includes(sub.status);

        // Find user by stripe_customer_id
        const { data: profile } = await supabase
          .from('profiles')
          .select('id')
          .eq('stripe_customer_id', customerId)
          .single();

        if (profile) {
          await supabase
            .from('profiles')
            .update({
              is_pro: isActive,
              stripe_subscription_id: sub.id,
              updated_at: new Date().toISOString(),
            })
            .eq('id', profile.id);

          console.log(`User ${profile.id}: is_pro=${isActive} (${sub.status})`);
        }
        break;
      }

      // Subscription cancelled or expired
      case 'customer.subscription.deleted': {
        const sub = data.object;
        const customerId = sub.customer;

        const { data: profile } = await supabase
          .from('profiles')
          .select('id')
          .eq('stripe_customer_id', customerId)
          .single();

        if (profile) {
          await supabase
            .from('profiles')
            .update({
              is_pro: false,
              stripe_subscription_id: null,
              updated_at: new Date().toISOString(),
            })
            .eq('id', profile.id);

          console.log(`User ${profile.id}: subscription cancelled`);
        }
        break;
      }

      // Payment failed
      case 'invoice.payment_failed': {
        const invoice = data.object;
        const customerId = invoice.customer;

        const { data: profile } = await supabase
          .from('profiles')
          .select('id, email')
          .eq('stripe_customer_id', customerId)
          .single();

        if (profile) {
          console.log(`Payment failed for user ${profile.id} (${profile.email})`);
          // Optional: send email notification, downgrade after grace period
        }
        break;
      }

      default:
        console.log(`Unhandled event: ${type}`);
    }
  } catch (err) {
    console.error(`Error handling ${type}:`, err);
    return res.status(500).json({ error: 'Webhook handler error' });
  }

  return res.status(200).json({ received: true });
}
