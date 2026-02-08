# RewriteMessage — Full Stack Setup Guide

> rewritemessage.com — AI message rewriter with auth, payments, and server-enforced limits.

## Architecture

```
User → Vercel (React frontend)
         ↓ API calls with JWT
       Vercel Serverless Functions
         ├── /api/rewrite.js   → Anthropic Haiku 4.5
         ├── /api/checkout.js  → Stripe Checkout
         ├── /api/webhook.js   → Stripe Webhooks
         ├── /api/portal.js    → Stripe Customer Portal
         ├── /api/me.js        → User profile + usage
         └── /api/referral.js  → Referral tracking
         ↓
       Supabase (Auth + Postgres DB)
```

---

## Setup (30 minutes total)

### Step 1: Supabase — Auth + Database (10 min)

1. Go to [supabase.com](https://supabase.com) → New Project
2. Name: `rewritemessage`, pick a region, set a DB password
3. Wait for project to spin up (~30 sec)

**Create tables:**
4. Go to **SQL Editor** → **New Query**
5. Paste the entire contents of `supabase-schema.sql` → click **Run**
6. You should see "Success" — this creates: profiles, usage, rewrites tables + functions

**Get your keys:**
7. Go to **Settings** → **API**
8. Copy these 3 values:
   - `Project URL` → this is your `SUPABASE_URL`
   - `anon public` key → this is your `SUPABASE_ANON_KEY`
   - `service_role` key → this is your `SUPABASE_SERVICE_ROLE_KEY` (keep secret!)

**Enable Google OAuth (optional but recommended):**
9. Go to **Authentication** → **Providers** → **Google**
10. Toggle ON, add your Google OAuth credentials
    - Get these from [console.cloud.google.com](https://console.cloud.google.com) → APIs & Services → Credentials → Create OAuth Client ID
    - Authorized redirect URI: `https://YOUR_PROJECT.supabase.co/auth/v1/callback`

**Set site URL:**
11. **Authentication** → **URL Configuration**
    - Site URL: `https://rewritemessage.com`
    - Redirect URLs: add `https://rewritemessage.com`

---

### Step 2: Stripe — Payments (10 min)

1. Go to [dashboard.stripe.com](https://dashboard.stripe.com) → sign up / log in
2. **Products** → **Add Product**
   - Name: `RewriteMessage Pro`
   - Price: `$5.00` / month / recurring
   - Click Save
3. Copy the **Price ID** (starts with `price_`) → this is your `STRIPE_PRICE_ID`

**API Keys:**
4. **Developers** → **API Keys**
   - Copy `Secret key` → this is your `STRIPE_SECRET_KEY`

**Webhook:**
5. **Developers** → **Webhooks** → **Add endpoint**
   - URL: `https://rewritemessage.com/api/webhook`
   - Events: select these:
     - `customer.subscription.created`
     - `customer.subscription.updated`
     - `customer.subscription.deleted`
     - `invoice.payment_failed`
   - Click **Add endpoint**
6. Click the webhook → **Signing secret** → Copy → this is your `STRIPE_WEBHOOK_SECRET`

**Customer Portal:**
7. **Settings** → **Billing** → **Customer portal**
   - Enable it, configure allowed actions (cancel, update payment)

---

### Step 3: Deploy to Vercel (5 min)

**Push to GitHub:**
```bash
cd rewritemessage
git init
git add .
git commit -m "init: full stack with auth, payments, usage tracking"
gh repo create rewritemessage --public --source=. --push
```

**Deploy:**
1. Go to [vercel.com/new](https://vercel.com/new) → Import `rewritemessage`
2. Click **Deploy** (auto-detects Vite)

**Add Environment Variables:**
3. Go to **Settings** → **Environment Variables**
4. Add ALL of these:

| Key | Value | Where to get it |
|-----|-------|----------------|
| `ANTHROPIC_API_KEY` | `sk-ant-...` | console.anthropic.com → API Keys |
| `VITE_SUPABASE_URL` | `https://xxx.supabase.co` | Supabase → Settings → API |
| `VITE_SUPABASE_ANON_KEY` | `eyJ...` | Supabase → Settings → API (anon) |
| `SUPABASE_URL` | `https://xxx.supabase.co` | Same as VITE_SUPABASE_URL |
| `SUPABASE_ANON_KEY` | `eyJ...` | Same as VITE_SUPABASE_ANON_KEY |
| `SUPABASE_SERVICE_ROLE_KEY` | `eyJ...` | Supabase → Settings → API (service_role) |
| `STRIPE_SECRET_KEY` | `sk_live_...` | Stripe → Developers → API Keys |
| `STRIPE_WEBHOOK_SECRET` | `whsec_...` | Stripe → Webhooks → Signing secret |
| `STRIPE_PRICE_ID` | `price_...` | Stripe → Products → your $5/mo price |
| `NEXT_PUBLIC_SITE_URL` | `https://rewritemessage.com` | Your domain |

5. **Redeploy**: Deployments → ⋮ → Redeploy

**Connect Domain:**
6. Settings → Domains → Add `rewritemessage.com`
7. Add DNS records at your registrar as Vercel instructs

---

### Step 4: Test Everything (5 min)

1. ✅ Visit site → should load with no errors
2. ✅ Do a rewrite without signing in (anon, 3/day)
3. ✅ Sign up with email → check Supabase Auth → user should appear
4. ✅ Do a rewrite while signed in → check Supabase `usage` table
5. ✅ Click "Upgrade" → should redirect to Stripe Checkout
6. ✅ Use Stripe test card: `4242 4242 4242 4242` (any expiry, any CVC)
7. ✅ After payment → user's `is_pro` should be `true` in profiles table
8. ✅ Pro user gets 30 rewrites/day, no watermark on copies

---

## What's Enforced Server-Side

| Feature | How it works |
|---------|-------------|
| Daily limit (3 free / 30 pro) | API checks `usage` table before each rewrite |
| Pro status | Set by Stripe webhook, stored in `profiles.is_pro` |
| Referral bonuses | `/api/referral` validates + awards to both users |
| Watermark | Frontend adds it; Pro flag from server controls removal |
| Usage tracking | `increment_usage()` Postgres function, atomic |

**Can users bypass limits?** Anon users (no account) can clear localStorage — but they only get 3/day and see watermarks. Logged-in users are fully server-enforced. This incentivizes signup.

---

## File Structure

```
rewritemessage/
├── api/
│   ├── _lib/supabase.js     # Shared auth + DB helpers
│   ├── rewrite.js            # AI rewrite + usage enforcement
│   ├── checkout.js           # Stripe checkout session
│   ├── webhook.js            # Stripe webhook handler
│   ├── portal.js             # Stripe billing portal
│   ├── me.js                 # User profile + usage endpoint
│   └── referral.js           # Referral tracking
├── src/
│   ├── main.jsx              # Entry + SW registration
│   └── App.jsx               # Full app with auth, payments, referrals
├── public/
│   ├── manifest.json         # PWA manifest
│   ├── sw.js                 # Service worker
│   └── icons/                # PWA icons
├── supabase-schema.sql       # Database schema (run in SQL Editor)
├── index.html                # SEO + PWA meta tags
├── package.json
├── vercel.json
└── .env.example
```

---

## Revenue Model

| | Free | Pro ($5/mo) |
|---|---|---|
| Rewrites/day | 3 | 30 |
| Watermark | Yes | No |
| Server-enforced | Yes (logged in) | Yes |
| Referral bonus | +3/day per referral | Stacks on top |

| Metric | Value |
|--------|-------|
| Cost per rewrite (Haiku 4.5) | ~$0.0016 |
| Avg Pro user cost/month | ~$0.48 (10/day avg) |
| Heavy Pro user cost/month | ~$1.44 (30/day) |
| **Pro revenue/month** | **$5.00** |
| **Margin (average)** | **~90%** |
| **Margin (heavy user)** | **~71%** |

---

## Local Development

```bash
npm install
cp .env.example .env.local   # Fill in all keys
npm run dev                   # http://localhost:3000
```

For Stripe webhooks locally, use [Stripe CLI](https://stripe.com/docs/stripe-cli):
```bash
stripe listen --forward-to localhost:3000/api/webhook
```
