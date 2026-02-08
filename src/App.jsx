import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createClient } from '@supabase/supabase-js';

// ─── Config ───
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const HAS_SUPABASE = !!(SUPABASE_URL && SUPABASE_KEY);

// Debug: log what Vite sees at build time
console.log('[RewriteMessage] Supabase URL detected:', !!SUPABASE_URL, SUPABASE_URL ? SUPABASE_URL.substring(0, 30) + '...' : 'EMPTY');
console.log('[RewriteMessage] Supabase Key detected:', !!SUPABASE_KEY, SUPABASE_KEY ? SUPABASE_KEY.substring(0, 10) + '...' : 'EMPTY');

let supabase = null;
try {
  if (HAS_SUPABASE) {
    supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
    console.log('[RewriteMessage] Supabase client created OK');
  } else {
    console.warn('[RewriteMessage] Supabase NOT configured — VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY missing at build time');
  }
} catch (e) {
  console.warn('Supabase init failed:', e);
}
const SITE_URL = 'https://rewritemessage.com';
const WATERMARK = '\n\n— Rewritten with RewriteMessage.com';
const FREE_DAILY = 3;
const PRO_DAILY = 30;

const TONES = [
  { id: 'professional', label: 'Professional', emoji: '💼', desc: 'Polished & corporate' },
  { id: 'friendly', label: 'Friendly', emoji: '😊', desc: 'Warm & approachable' },
  { id: 'assertive', label: 'Assertive', emoji: '💪', desc: 'Direct & confident' },
  { id: 'diplomatic', label: 'Diplomatic', emoji: '🤝', desc: 'Tactful & balanced' },
  { id: 'casual', label: 'Casual', emoji: '✌️', desc: 'Relaxed & conversational' },
  { id: 'empathetic', label: 'Empathetic', emoji: '💛', desc: 'Understanding & caring' },
  { id: 'concise', label: 'Concise', emoji: '⚡', desc: 'Short & punchy' },
  { id: 'persuasive', label: 'Persuasive', emoji: '🎯', desc: 'Compelling & convincing' },
];

// ─── Auth Helper ───
async function getAuthHeader() {
  if (!supabase) return {};
  try {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {};
  } catch (e) { return {}; }
}

async function apiFetch(path, opts = {}) {
  const auth = await getAuthHeader();
  const res = await fetch(path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...auth, ...opts.headers },
  });
  return res;
}

// ─── App ───
export default function App() {
  // Auth state
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [showAuth, setShowAuth] = useState(false);
  const [authMode, setAuthMode] = useState('login'); // login | signup
  const [authEmail, setAuthEmail] = useState('');
  const [authPass, setAuthPass] = useState('');
  const [authError, setAuthError] = useState('');
  const [authSubmitting, setAuthSubmitting] = useState(false);

  // App state
  const [input, setInput] = useState('');
  const [tone, setTone] = useState(null);
  const [result, setResult] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  // Usage (server-synced for logged in, localStorage fallback for anon)
  const [usage, setUsage] = useState(0);
  const [limit, setLimit] = useState(FREE_DAILY);

  // Modals
  const [showPaywall, setShowPaywall] = useState(false);
  const [showPricing, setShowPricing] = useState(false);
  const [showReferral, setShowReferral] = useState(false);
  const [showAccount, setShowAccount] = useState(false);

  // Misc
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const resultRef = useRef(null);

  const isPro = profile?.isPro || false;
  const remaining = Math.max(0, limit - usage);

  // ─── Auth listeners ───
  useEffect(() => {
    if (!supabase) { setAuthLoading(false); return; }
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user || null);
      setAuthLoading(false);
    }).catch(() => setAuthLoading(false));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user || null);
    });
    return () => subscription.unsubscribe();
  }, []);

  // ─── Fetch profile when user changes ───
  const fetchProfile = useCallback(async () => {
    if (!user) {
      setProfile(null);
      // Anon: use localStorage
      const stored = JSON.parse(localStorage.getItem('rm_anon') || '{}');
      const today = new Date().toDateString();
      if (stored.date === today) {
        setUsage(stored.count);
      } else {
        setUsage(0);
        localStorage.setItem('rm_anon', JSON.stringify({ count: 0, date: today }));
      }
      setLimit(FREE_DAILY);
      return;
    }
    try {
      const res = await apiFetch('/api/me');
      if (res.ok) {
        const data = await res.json();
        setProfile(data);
        setUsage(data.usage);
        setLimit(data.limit);
      }
    } catch (e) {
      console.error('Profile fetch error:', e);
    }
  }, [user]);

  useEffect(() => { fetchProfile(); }, [fetchProfile]);

  // ─── Handle URL params (referral, upgrade success) ───
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const text = p.get('text');
    if (text) setInput(text);
    if (p.get('upgraded') === 'true') {
      fetchProfile();
      window.history.replaceState({}, '', '/');
    }
    // Store referral code for later
    const ref = p.get('ref');
    if (ref) {
      localStorage.setItem('rm_pending_ref', ref);
      window.history.replaceState({}, '', '/');
    }
  }, []);

  // ─── Apply pending referral after signup ───
  useEffect(() => {
    if (!user) return;
    const pendingRef = localStorage.getItem('rm_pending_ref');
    if (pendingRef) {
      apiFetch('/api/referral', {
        method: 'POST',
        body: JSON.stringify({ referralCode: pendingRef }),
      }).then(() => {
        localStorage.removeItem('rm_pending_ref');
        fetchProfile();
      }).catch(() => {});
    }
  }, [user]);

  // ─── Auth actions ───
  const handleAuth = async (e) => {
    e.preventDefault();
    if (!supabase) { setAuthError('Supabase not connected. Redeploy Vercel WITHOUT build cache after setting VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.'); return; }
    setAuthError('');
    setAuthSubmitting(true);
    try {
      let result;
      if (authMode === 'signup') {
        result = await supabase.auth.signUp({ email: authEmail, password: authPass });
      } else {
        result = await supabase.auth.signInWithPassword({ email: authEmail, password: authPass });
      }
      if (result.error) throw result.error;
      setShowAuth(false);
      setAuthEmail('');
      setAuthPass('');
    } catch (err) {
      setAuthError(err.message || 'Authentication failed');
    } finally {
      setAuthSubmitting(false);
    }
  };

  const handleGoogleAuth = async () => {
    if (!supabase) { setAuthError('Supabase not connected. Redeploy Vercel without build cache.'); return; }
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: SITE_URL },
      });
      if (error) setAuthError(error.message);
    } catch (e) {
      setAuthError('Google login failed: ' + e.message);
    }
  };

  const handleLogout = async () => {
    if (supabase) await supabase.auth.signOut();
    setUser(null);
    setProfile(null);
    setShowAccount(false);
  };

  // ─── Rewrite ───
  const handleRewrite = async () => {
    if (!input.trim() || !tone) return;
    if (remaining <= 0) {
      if (!user) { setShowAuth(true); return; }
      setShowPaywall(true);
      return;
    }

    setLoading(true);
    setResult('');
    setError('');

    try {
      const t = TONES.find((x) => x.id === tone);
      const res = await apiFetch('/api/rewrite', {
        method: 'POST',
        body: JSON.stringify({ message: input, tone: t.label, toneDesc: t.desc }),
      });
      const data = await res.json();

      if (res.status === 429) {
        if (data.upgrade) setShowPaywall(true);
        else setError(data.error);
        return;
      }
      if (!res.ok) throw new Error(data.error || 'Request failed');

      setResult(data.rewrite);

      // Update usage
      if (data.usage != null) {
        setUsage(data.usage);
      } else {
        // Anon: increment localStorage
        const stored = JSON.parse(localStorage.getItem('rm_anon') || '{}');
        const today = new Date().toDateString();
        const newCount = (stored.date === today ? stored.count : 0) + 1;
        localStorage.setItem('rm_anon', JSON.stringify({ count: newCount, date: today }));
        setUsage(newCount);
      }

      setTimeout(() => resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 100);
    } catch (err) {
      setError(err.message || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  // ─── Stripe Checkout ───
  const handleCheckout = async () => {
    if (!user) { setShowAuth(true); return; }
    setCheckoutLoading(true);
    try {
      const res = await apiFetch('/api/checkout', { method: 'POST' });
      const data = await res.json();
      if (data.url) window.location.href = data.url;
      else setError(data.error || 'Checkout failed');
    } catch (e) {
      setError('Checkout failed. Please try again.');
    } finally {
      setCheckoutLoading(false);
    }
  };

  const handleManageSubscription = async () => {
    try {
      const res = await apiFetch('/api/portal', { method: 'POST' });
      const data = await res.json();
      if (data.url) window.location.href = data.url;
    } catch (e) {
      setError('Could not open billing portal');
    }
  };

  // ─── Copy/Share ───
  const getCopyText = () => isPro ? result : result + WATERMARK;
  const handleCopy = () => {
    navigator.clipboard.writeText(getCopyText());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  const handleShare = async () => {
    if (navigator.share) {
      try { await navigator.share({ text: getCopyText(), url: SITE_URL }); } catch {}
    } else handleCopy();
  };
  const handleTweet = () => {
    const t = encodeURIComponent(`Just rewrote my message with AI and it sounds way better 🔥\nTry free → ${SITE_URL}`);
    window.open(`https://twitter.com/intent/tweet?text=${t}`, '_blank');
  };

  const toneObj = TONES.find((x) => x.id === tone);
  const referralLink = profile?.referralCode ? `${SITE_URL}?ref=${profile.referralCode}` : '';

  // ─── Render ───
  return (
    <div style={S.root}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700&family=Space+Mono:wght@400;700&family=Instrument+Serif:ital@0;1&display=swap" rel="stylesheet" />
      <div style={S.ambientBg} />

      {/* ── Nav ── */}
      <nav style={S.nav}>
        <div style={S.logoWrap}>
          <div style={S.logoIcon}>R</div>
          <span style={S.logoText}>RewriteMessage</span>
        </div>
        <div style={S.navRight}>
          {user && <button onClick={() => setShowReferral(true)} style={S.navLink}>Free Rewrites</button>}
          <button onClick={() => setShowPricing(true)} style={S.navLink}>Pricing</button>
          {!user && <button onClick={() => { setAuthMode('login'); setShowAuth(true); }} style={S.navLink}>Log in</button>}
          {!user && <button onClick={() => { setAuthMode('signup'); setShowAuth(true); }} style={S.upgradeBtn}>Sign Up Free</button>}
          {user && !isPro && <button onClick={handleCheckout} style={S.upgradeBtn}>{checkoutLoading ? '...' : 'Upgrade $5/mo'}</button>}
          {user && isPro && <span style={S.proBadge}>PRO ✓</span>}
          {user && <button onClick={() => setShowAccount(true)} style={S.avatarBtn}>{user.email?.[0]?.toUpperCase() || '?'}</button>}
        </div>
      </nav>

      {/* ── Hero ── */}
      <div style={S.hero}>
        <div style={S.badge}>✨ FREE AI MESSAGE REWRITER</div>
        <h1 style={S.heading}>Rewrite any message<br/>in the perfect tone.</h1>
        <p style={S.sub}>Paste an email, text, or Slack message. Pick a tone. Instant AI rewrite.</p>
      </div>

      {/* ── Main ── */}
      <div style={S.main}>
        <label style={S.label}>1. Choose a tone</label>
        <div style={S.toneGrid}>
          {TONES.map((t) => (
            <button key={t.id} onClick={() => { setTone(t.id); setError(''); }}
              style={{ ...S.toneBtn, ...(tone === t.id ? S.toneSel : {}) }}>
              <span style={{ fontSize: 18 }}>{t.emoji}</span>
              <div>
                <div style={{ color: tone === t.id ? '#c4b5fd' : '#d4d4d4', fontSize: 13, fontWeight: 600 }}>{t.label}</div>
                <div style={{ color: '#525252', fontSize: 11 }}>{t.desc}</div>
              </div>
            </button>
          ))}
        </div>

        <label style={{ ...S.label, marginTop: 20 }}>2. Paste your message</label>
        <textarea value={input} onChange={(e) => { setInput(e.target.value); setError(''); }}
          placeholder="Paste your email, Slack message, or text here..."
          rows={4} style={S.textarea} maxLength={3000} />
        <div style={S.charCount}>{input.length}/3,000</div>

        {/* Action row */}
        <div style={S.actionRow}>
          <div style={S.remaining}>
            <span style={{ color: remaining === 0 ? '#ef4444' : '#10b981', fontWeight: 700 }}>{remaining}</span>
            <span> / {limit} left today</span>
            {!user && <span style={{ color: '#818cf8', cursor: 'pointer' }}
              onClick={() => { setAuthMode('signup'); setShowAuth(true); }}> · Sign up for more</span>}
          </div>
          <button onClick={() => {
            if (!tone && !input.trim()) { setError('👆 Select a tone and paste a message to get started'); return; }
            if (!tone) { setError('👆 Select a tone first'); return; }
            if (!input.trim()) { setError('✍️ Paste a message to rewrite'); return; }
            handleRewrite();
          }}
            style={{ ...S.rewriteBtn, ...(!tone || !input.trim() ? { background: 'rgba(16,185,129,0.3)', boxShadow: 'none' } : {}), opacity: loading ? 0.7 : 1 }}
            disabled={loading}>
            {loading ? <><span style={S.spinner}/> Rewriting...</> :
              !tone ? '← Pick a tone first' :
              !input.trim() ? '← Paste a message' :
              'Rewrite Message ✨'}
          </button>
        </div>

        {error && <div style={S.error}>{error}</div>}

        {/* Result */}
        {result && (
          <div ref={resultRef} style={S.resultBox}>
            <div style={S.resultHead}>
              <span style={S.resultLabel}>{toneObj?.emoji} {toneObj?.label} Rewrite</span>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {navigator.share && <button onClick={handleShare} style={S.actionBtnS}>📤 Share</button>}
                <button onClick={handleTweet} style={S.actionBtnS}>🐦 Tweet</button>
                <button onClick={handleCopy} style={{ ...S.actionBtnS, ...(copied ? S.copiedBtn : {}) }}>
                  {copied ? '✓ Copied' : '📋 Copy'}
                </button>
              </div>
            </div>
            <p style={S.resultText}>{result}</p>
            {!isPro && (
              <div style={S.watermarkNote}>
                💡 Free copies include "Rewritten with RewriteMessage.com" —{' '}
                <button onClick={handleCheckout} style={S.inlineLink}>upgrade to remove</button>
              </div>
            )}
          </div>
        )}

        {/* Stats */}
        <div style={S.stats}>
          <div style={S.statsGrid}>
            {[{ s: '2M+', l: 'Rewrites' }, { s: '4.9★', l: 'Rating' }, { s: '<1s', l: 'Speed' }, { s: 'Free', l: 'No card needed' }].map((x) => (
              <div key={x.l}>
                <div style={S.statNum}>{x.s}</div>
                <div style={S.statLbl}>{x.l}</div>
              </div>
            ))}
          </div>
        </div>

        {/* SEO FAQ */}
        <div style={S.seoSection}>
          <h2 style={S.seoTitle}>How to Rewrite a Message in a Different Tone</h2>
          <p style={S.seoText}>
            Whether you're softening a tough email, making a casual text more professional, or rewording a Slack message
            to sound more empathetic — RewriteMessage instantly rewrites your text using AI. No signup required.
          </p>
          <div style={S.seoGrid}>
            {[
              { q: 'Is it free?', a: 'Yes — 3 free rewrites daily. Sign up for referral bonuses, or go Pro for 30/day at $5/mo.' },
              { q: 'What tones?', a: 'Professional, Friendly, Assertive, Diplomatic, Casual, Empathetic, Concise, Persuasive.' },
              { q: 'Mobile?', a: 'Yes — add to home screen on iPhone/Android. Works like a native app.' },
              { q: 'Privacy?', a: 'We don\'t store your messages. Sent to AI, rewritten, then discarded.' },
            ].map((x) => (
              <div key={x.q} style={S.faqItem}>
                <div style={S.faqQ}>{x.q}</div>
                <div style={S.faqA}>{x.a}</div>
              </div>
            ))}
          </div>
        </div>

        <footer style={S.footer}>
          <div style={S.footerLogo}>
            <div style={{ ...S.logoIcon, width: 20, height: 20, fontSize: 10, borderRadius: 4 }}>R</div>
            <span style={{ ...S.logoText, fontSize: 12 }}>RewriteMessage</span>
          </div>
          <div style={{ color: '#404040', fontSize: 11 }}>© {new Date().getFullYear()} rewritemessage.com</div>
        </footer>
      </div>

      {/* ═══════════ MODALS ═══════════ */}

      {/* Auth Modal */}
      {showAuth && (
        <div style={S.overlay} onClick={() => setShowAuth(false)}>
          <div style={{ ...S.modal, maxWidth: 380 }} onClick={(e) => e.stopPropagation()}>
            <h2 style={S.modalTitle}>{authMode === 'signup' ? 'Create Account' : 'Welcome Back'}</h2>
            <p style={S.modalDesc}>
              {authMode === 'signup' ? 'Sign up for server-synced usage, referrals, and Pro upgrade.' : 'Log in to continue.'}
            </p>

            <button onClick={handleGoogleAuth} style={S.googleBtn}>
              <svg width="18" height="18" viewBox="0 0 24 24" style={{ marginRight: 8 }}>
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
              Continue with Google
            </button>

            <div style={S.divider}><span style={S.dividerText}>or</span></div>

            <div>
              <input type="email" placeholder="Email" value={authEmail}
                onChange={(e) => setAuthEmail(e.target.value)}
                style={S.input} />
              <input type="password" placeholder="Password (min 6 chars)" value={authPass}
                onChange={(e) => setAuthPass(e.target.value)}
                style={{ ...S.input, marginTop: 8 }}
                onKeyDown={(e) => e.key === 'Enter' && handleAuth(e)} />
              {authError && <div style={{ color: '#fca5a5', fontSize: 12, marginTop: 6 }}>{authError}</div>}
              <button onClick={handleAuth} disabled={authSubmitting}
                style={{ ...S.ctaBtn, marginTop: 12, opacity: authSubmitting ? 0.7 : 1 }}>
                {authSubmitting ? 'Please wait...' : authMode === 'signup' ? 'Create Account' : 'Log In'}
              </button>
            </div>

            <div style={{ marginTop: 12, fontSize: 13, color: '#737373' }}>
              {authMode === 'signup' ? (
                <>Already have an account? <button onClick={() => setAuthMode('login')} style={S.inlineLink}>Log in</button></>
              ) : (
                <>No account? <button onClick={() => setAuthMode('signup')} style={S.inlineLink}>Sign up free</button></>
              )}
            </div>
            <button onClick={() => setShowAuth(false)} style={{ ...S.dismiss, marginTop: 8 }}>Cancel</button>
          </div>
        </div>
      )}

      {/* Paywall */}
      {showPaywall && (
        <div style={S.overlay} onClick={() => setShowPaywall(false)}>
          <div style={S.modal} onClick={(e) => e.stopPropagation()}>
            <div style={{ fontSize: 44, marginBottom: 12, textAlign: 'center' }}>🚀</div>
            <h2 style={S.modalTitle}>Go Pro — $5/month</h2>
            <p style={S.modalDesc}>30 rewrites/day. No watermark. 7-day free trial.</p>
            <div style={S.priceBox}>
              <div style={S.priceNum}>$5<span style={S.pricePer}>/mo</span></div>
              <div style={S.priceSub}>7-day free trial · Cancel anytime</div>
            </div>
            {['30 rewrites per day', 'No watermark on copies', 'Priority AI speed', 'Referral bonuses stack'].map((f) => (
              <div key={f} style={S.proFeature}>✓ {f}</div>
            ))}
            <button onClick={() => { setShowPaywall(false); handleCheckout(); }}
              style={{ ...S.ctaBtn, marginTop: 16 }}>
              {checkoutLoading ? 'Redirecting...' : 'Start Free Trial →'}
            </button>
            <div style={{ fontSize: 12, color: '#525252', marginTop: 8 }}>
              or <button onClick={() => { setShowPaywall(false); setShowReferral(true); }} style={S.inlineLink}>earn free rewrites</button>
            </div>
            <button onClick={() => setShowPaywall(false)} style={{ ...S.dismiss, marginTop: 8 }}>Maybe later</button>
          </div>
        </div>
      )}

      {/* Pricing */}
      {showPricing && (
        <div style={S.overlay} onClick={() => setShowPricing(false)}>
          <div style={{ ...S.modal, maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
            <h2 style={{ ...S.modalTitle, marginBottom: 4 }}>Simple Pricing</h2>
            <p style={{ ...S.modalDesc, marginBottom: 20 }}>Start free — no card needed</p>
            <div style={S.pricingGrid}>
              <div style={S.tierFree}>
                <div style={S.tierName}>Free</div>
                <div style={S.tierPrice}>$0</div>
                {['3 rewrites / day', 'All 8 tones', 'Watermark on copies'].map((f) => (
                  <div key={f} style={S.tierFeat}>✓ {f}</div>
                ))}
              </div>
              <div style={S.tierPro}>
                <div style={S.popular}>BEST VALUE</div>
                <div style={{ ...S.tierName, color: '#6ee7b7' }}>Pro</div>
                <div style={S.tierPrice}>$5<span style={S.pricePer}>/mo</span></div>
                {['30 rewrites / day', 'All 8 tones', 'No watermark', '7-day free trial'].map((f) => (
                  <div key={f} style={{ ...S.tierFeat, color: '#a7f3d0' }}>✓ {f}</div>
                ))}
              </div>
            </div>
            <button onClick={() => setShowPricing(false)} style={{ ...S.dismiss, marginTop: 16 }}>Close</button>
          </div>
        </div>
      )}

      {/* Referral */}
      {showReferral && (
        <div style={S.overlay} onClick={() => setShowReferral(false)}>
          <div style={S.modal} onClick={(e) => e.stopPropagation()}>
            <div style={{ fontSize: 44, marginBottom: 12, textAlign: 'center' }}>🎁</div>
            <h2 style={S.modalTitle}>Earn Free Rewrites</h2>
            <p style={S.modalDesc}>Share your link. You both get <strong style={{ color: '#10b981' }}>+3 rewrites/day</strong>.</p>
            {referralLink ? (
              <>
                <div style={S.referralBox}>
                  <code style={S.referralCode}>{referralLink}</code>
                  <button onClick={() => navigator.clipboard.writeText(referralLink)} style={S.referralCopy}>Copy</button>
                </div>
                <div style={S.shareRow}>
                  <button onClick={() => window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(`Rewrite any message in the perfect tone with AI — try free:\n${referralLink}`)}`, '_blank')} style={S.shareBtn}>🐦 Twitter</button>
                  <button onClick={() => window.open(`https://wa.me/?text=${encodeURIComponent(`Check out RewriteMessage: ${referralLink}`)}`, '_blank')} style={S.shareBtn}>💬 WhatsApp</button>
                </div>
                <div style={{ fontSize: 12, color: '#525252', marginTop: 8 }}>
                  Bonus: <strong style={{ color: '#10b981' }}>+{profile?.bonusRewrites || 0}</strong> extra/day
                </div>
              </>
            ) : (
              <div style={{ fontSize: 13, color: '#737373' }}>
                <button onClick={() => { setShowReferral(false); setAuthMode('signup'); setShowAuth(true); }} style={S.inlineLink}>Sign up</button> to get your referral link.
              </div>
            )}
            <button onClick={() => setShowReferral(false)} style={{ ...S.dismiss, marginTop: 12 }}>Close</button>
          </div>
        </div>
      )}

      {/* Account */}
      {showAccount && (
        <div style={S.overlay} onClick={() => setShowAccount(false)}>
          <div style={{ ...S.modal, maxWidth: 360 }} onClick={(e) => e.stopPropagation()}>
            <h2 style={S.modalTitle}>Account</h2>
            <div style={{ fontSize: 14, color: '#a0a0a0', marginBottom: 16 }}>{user?.email}</div>
            <div style={S.accountRow}>
              <span style={{ color: '#737373' }}>Plan</span>
              <span style={{ color: isPro ? '#6ee7b7' : '#a0a0a0', fontWeight: 600 }}>{isPro ? 'Pro' : 'Free'}</span>
            </div>
            <div style={S.accountRow}>
              <span style={{ color: '#737373' }}>Today's usage</span>
              <span style={{ color: '#a0a0a0' }}>{usage} / {limit}</span>
            </div>
            {profile?.bonusRewrites > 0 && (
              <div style={S.accountRow}>
                <span style={{ color: '#737373' }}>Referral bonus</span>
                <span style={{ color: '#10b981' }}>+{profile.bonusRewrites}/day</span>
              </div>
            )}
            <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {isPro && (
                <button onClick={() => { setShowAccount(false); handleManageSubscription(); }} style={S.secondaryBtn}>
                  Manage Subscription
                </button>
              )}
              {!isPro && (
                <button onClick={() => { setShowAccount(false); handleCheckout(); }} style={S.ctaBtn}>
                  Upgrade to Pro
                </button>
              )}
              <button onClick={handleLogout} style={S.secondaryBtn}>Log Out</button>
            </div>
            <button onClick={() => setShowAccount(false)} style={{ ...S.dismiss, marginTop: 8 }}>Close</button>
          </div>
        </div>
      )}

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeUp { from { opacity:0; transform:translateY(12px); } to { opacity:1; transform:translateY(0); } }
        textarea::placeholder, input::placeholder { color: #404040; }
        * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
        button:active { transform: scale(0.97); }
        body { overscroll-behavior: none; }
      `}</style>
    </div>
  );
}

// ═══════════ STYLES ═══════════
const S = {
  root: { minHeight: '100vh', background: '#0a0a0b', color: '#e8e6e1', fontFamily: "'DM Sans', sans-serif", position: 'relative', WebkitFontSmoothing: 'antialiased' },
  ambientBg: { position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 0, background: 'radial-gradient(ellipse 80% 50% at 50% 0%, rgba(16,185,129,0.06) 0%, transparent 60%)' },
  nav: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 20px', position: 'relative', zIndex: 10, borderBottom: '1px solid rgba(255,255,255,0.06)' },
  logoWrap: { display: 'flex', alignItems: 'center', gap: 8 },
  logoIcon: { width: 30, height: 30, borderRadius: 7, background: 'linear-gradient(135deg, #10b981, #059669)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700, color: '#fff' },
  logoText: { fontFamily: "'Space Mono', monospace", fontWeight: 700, fontSize: 15, letterSpacing: '-0.5px' },
  navRight: { display: 'flex', gap: 10, alignItems: 'center' },
  navLink: { background: 'none', border: 'none', color: '#737373', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit' },
  upgradeBtn: { background: 'linear-gradient(135deg, #10b981, #059669)', border: 'none', color: '#fff', padding: '6px 14px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },
  proBadge: { background: 'rgba(16,185,129,0.12)', color: '#6ee7b7', padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700, border: '1px solid rgba(16,185,129,0.3)' },
  avatarBtn: { width: 30, height: 30, borderRadius: '50%', background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)', color: '#a0a0a0', fontSize: 13, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'inherit' },
  hero: { textAlign: 'center', padding: '36px 20px 16px', position: 'relative', zIndex: 10 },
  badge: { display: 'inline-block', padding: '4px 12px', background: 'rgba(16,185,129,0.1)', borderRadius: 16, fontSize: 10, fontWeight: 600, color: '#6ee7b7', letterSpacing: '0.5px', marginBottom: 14, border: '1px solid rgba(16,185,129,0.2)' },
  heading: { fontFamily: "'Instrument Serif', serif", fontSize: 'clamp(30px, 7vw, 50px)', fontWeight: 400, lineHeight: 1.15, margin: '0 auto 12px', maxWidth: 520, color: '#f5f5f4' },
  sub: { color: '#737373', fontSize: 15, maxWidth: 400, margin: '0 auto', lineHeight: 1.5 },
  main: { maxWidth: 640, margin: '0 auto', padding: '0 16px 40px', position: 'relative', zIndex: 10 },
  label: { fontSize: 10, fontWeight: 600, color: '#525252', letterSpacing: '1.5px', textTransform: 'uppercase', display: 'block', marginBottom: 10 },
  toneGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 6, marginBottom: 4 },
  toneBtn: { background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 9, padding: '9px 11px', cursor: 'pointer', textAlign: 'left', transition: 'all 0.15s', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 9 },
  toneSel: { background: 'linear-gradient(135deg, rgba(16,185,129,0.15), rgba(99,102,241,0.08))', border: '1px solid rgba(16,185,129,0.35)' },
  textarea: { width: '100%', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: 14, color: '#e8e6e1', fontSize: 15, fontFamily: "'DM Sans', sans-serif", resize: 'vertical', outline: 'none', lineHeight: 1.6, boxSizing: 'border-box' },
  charCount: { textAlign: 'right', fontSize: 11, color: '#404040', marginTop: 4, marginBottom: 12 },
  actionRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18, flexWrap: 'wrap', gap: 10 },
  remaining: { fontSize: 12, color: '#525252' },
  rewriteBtn: { background: 'linear-gradient(135deg, #10b981, #059669)', border: 'none', color: '#fff', padding: '12px 28px', borderRadius: 10, fontSize: 15, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', boxShadow: '0 0 25px rgba(16,185,129,0.25)', display: 'flex', alignItems: 'center', gap: 8, transition: 'all 0.2s' },
  rewriteOff: { background: 'rgba(255,255,255,0.05)', color: '#525252', boxShadow: 'none' },
  spinner: { display: 'inline-block', width: 14, height: 14, border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.8s linear infinite' },
  error: { padding: 12, borderRadius: 10, marginBottom: 14, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', color: '#fca5a5', fontSize: 13 },
  resultBox: { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(16,185,129,0.15)', borderRadius: 14, padding: 20, animation: 'fadeUp 0.4s ease' },
  resultHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 },
  resultLabel: { fontSize: 11, fontWeight: 600, color: '#6ee7b7', letterSpacing: '1px', textTransform: 'uppercase' },
  actionBtnS: { background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#a0a0a0', padding: '5px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },
  copiedBtn: { background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.3)', color: '#6ee7b7' },
  resultText: { color: '#d4d4d4', fontSize: 15, lineHeight: 1.7, margin: 0, whiteSpace: 'pre-wrap' },
  watermarkNote: { marginTop: 14, paddingTop: 12, borderTop: '1px solid rgba(255,255,255,0.05)', fontSize: 12, color: '#525252' },
  inlineLink: { background: 'none', border: 'none', color: '#6ee7b7', cursor: 'pointer', fontFamily: 'inherit', fontSize: 'inherit', textDecoration: 'underline', padding: 0 },
  stats: { textAlign: 'center', marginTop: 36, padding: '24px 0', borderTop: '1px solid rgba(255,255,255,0.05)' },
  statsGrid: { display: 'flex', justifyContent: 'center', gap: 28, flexWrap: 'wrap' },
  statNum: { fontSize: 20, fontWeight: 700, fontFamily: "'Space Mono', monospace", color: '#6ee7b7' },
  statLbl: { fontSize: 11, color: '#525252', marginTop: 2 },
  seoSection: { marginTop: 32, padding: '24px 0', borderTop: '1px solid rgba(255,255,255,0.04)' },
  seoTitle: { fontFamily: "'Instrument Serif', serif", fontSize: 22, fontWeight: 400, color: '#d4d4d4', marginBottom: 10 },
  seoText: { color: '#525252', fontSize: 14, lineHeight: 1.7, marginBottom: 20 },
  seoGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 },
  faqItem: { background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: 10, padding: 14 },
  faqQ: { fontSize: 13, fontWeight: 600, color: '#d4d4d4', marginBottom: 4 },
  faqA: { fontSize: 12, color: '#737373', lineHeight: 1.5 },
  footer: { marginTop: 32, padding: '20px 0', borderTop: '1px solid rgba(255,255,255,0.04)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 },
  footerLogo: { display: 'flex', alignItems: 'center', gap: 6 },

  // Modals
  overlay: { position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 },
  modal: { background: '#141416', borderRadius: 18, padding: '28px 24px', maxWidth: 400, width: '100%', border: '1px solid rgba(255,255,255,0.08)', textAlign: 'center', maxHeight: '90vh', overflowY: 'auto' },
  modalTitle: { fontFamily: "'Instrument Serif', serif", fontSize: 26, margin: '0 0 8px', fontWeight: 400, color: '#f5f5f4' },
  modalDesc: { color: '#737373', fontSize: 14, marginBottom: 20, lineHeight: 1.5 },
  priceBox: { background: 'rgba(16,185,129,0.08)', borderRadius: 12, padding: 18, marginBottom: 16, border: '1px solid rgba(16,185,129,0.15)' },
  priceNum: { fontFamily: "'Space Mono', monospace", fontSize: 34, fontWeight: 700, color: '#6ee7b7' },
  pricePer: { fontSize: 14, color: '#737373' },
  priceSub: { color: '#a0a0a0', fontSize: 12, marginTop: 6 },
  proFeature: { color: '#a0a0a0', fontSize: 13, marginBottom: 6, textAlign: 'left', paddingLeft: 4 },
  ctaBtn: { width: '100%', background: 'linear-gradient(135deg, #10b981, #059669)', border: 'none', color: '#fff', padding: '13px 0', borderRadius: 10, fontSize: 15, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', boxShadow: '0 0 25px rgba(16,185,129,0.3)' },
  secondaryBtn: { width: '100%', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#a0a0a0', padding: '11px 0', borderRadius: 10, fontSize: 14, cursor: 'pointer', fontFamily: 'inherit' },
  dismiss: { background: 'none', border: 'none', color: '#525252', cursor: 'pointer', fontSize: 13, fontFamily: 'inherit' },
  pricingGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 },
  tierFree: { background: 'rgba(255,255,255,0.02)', borderRadius: 12, padding: 18, border: '1px solid rgba(255,255,255,0.06)', textAlign: 'left' },
  tierPro: { background: 'linear-gradient(135deg, rgba(16,185,129,0.08), rgba(99,102,241,0.04))', borderRadius: 12, padding: 18, textAlign: 'left', border: '1px solid rgba(16,185,129,0.2)', position: 'relative' },
  tierName: { fontSize: 12, fontWeight: 600, color: '#737373', marginBottom: 4 },
  tierPrice: { fontFamily: "'Space Mono', monospace", fontSize: 26, fontWeight: 700, marginBottom: 12, color: '#e8e6e1' },
  tierFeat: { color: '#a0a0a0', fontSize: 12, marginBottom: 5 },
  popular: { position: 'absolute', top: -8, right: 10, background: 'linear-gradient(135deg, #10b981, #059669)', padding: '2px 10px', borderRadius: 10, fontSize: 9, fontWeight: 700, color: '#fff' },
  referralBox: { display: 'flex', gap: 8, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: 10, marginBottom: 14, alignItems: 'center' },
  referralCode: { flex: 1, fontSize: 11, color: '#a0a0a0', wordBreak: 'break-all', fontFamily: "'Space Mono', monospace" },
  referralCopy: { background: '#10b981', border: 'none', color: '#fff', padding: '6px 14px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' },
  shareRow: { display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' },
  shareBtn: { background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#d4d4d4', padding: '8px 16px', borderRadius: 8, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' },
  accountRow: { display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.05)', fontSize: 13 },
  googleBtn: { width: '100%', background: '#fff', border: 'none', color: '#333', padding: '11px 0', borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  divider: { position: 'relative', textAlign: 'center', margin: '14px 0', borderTop: '1px solid rgba(255,255,255,0.06)' },
  dividerText: { background: '#141416', padding: '0 12px', color: '#525252', fontSize: 12, position: 'relative', top: -8 },
  input: { width: '100%', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: '10px 12px', color: '#e8e6e1', fontSize: 14, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' },
};
