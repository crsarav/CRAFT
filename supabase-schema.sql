-- ============================================
-- RewriteMessage Database Schema
-- Run this in Supabase → SQL Editor → New Query
-- ============================================

-- 1. Profiles table (extends Supabase auth.users)
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  is_pro BOOLEAN DEFAULT FALSE,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  referred_by TEXT,
  referral_code TEXT UNIQUE,
  bonus_rewrites INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Daily usage tracking
CREATE TABLE public.usage (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  date DATE DEFAULT CURRENT_DATE,
  count INTEGER DEFAULT 0,
  UNIQUE(user_id, date)
);

-- 3. Rewrite history (optional, for analytics)
CREATE TABLE public.rewrites (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  tone TEXT NOT NULL,
  input_length INTEGER,
  output_length INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, referral_code)
  VALUES (
    NEW.id,
    NEW.email,
    'r' || substr(md5(random()::text), 1, 7)
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 5. Row Level Security
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rewrites ENABLE ROW LEVEL SECURITY;

-- Users can read their own profile
CREATE POLICY "Users read own profile"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id);

-- Users can update their own profile
CREATE POLICY "Users update own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id);

-- Users can read their own usage
CREATE POLICY "Users read own usage"
  ON public.usage FOR SELECT
  USING (auth.uid() = user_id);

-- Service role can do everything (used by API routes)
-- No policy needed — API uses service_role key which bypasses RLS

-- 6. Index for fast usage lookups
CREATE INDEX idx_usage_user_date ON public.usage(user_id, date);
CREATE INDEX idx_profiles_stripe ON public.profiles(stripe_customer_id);
CREATE INDEX idx_profiles_referral ON public.profiles(referral_code);

-- 7. Helper: increment usage (called from API)
CREATE OR REPLACE FUNCTION public.increment_usage(p_user_id UUID)
RETURNS INTEGER AS $$
DECLARE
  new_count INTEGER;
BEGIN
  INSERT INTO public.usage (user_id, date, count)
  VALUES (p_user_id, CURRENT_DATE, 1)
  ON CONFLICT (user_id, date)
  DO UPDATE SET count = usage.count + 1
  RETURNING count INTO new_count;
  RETURN new_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 8. Helper: get today's usage
CREATE OR REPLACE FUNCTION public.get_daily_usage(p_user_id UUID)
RETURNS INTEGER AS $$
DECLARE
  current_count INTEGER;
BEGIN
  SELECT count INTO current_count
  FROM public.usage
  WHERE user_id = p_user_id AND date = CURRENT_DATE;
  RETURN COALESCE(current_count, 0);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
