import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import confetti from 'canvas-confetti';
import { Mail, Lock, User, AlertCircle, CheckCircle2, ArrowRight, Sparkles, Building2, MousePointer2, BrainCircuit, Layers } from 'lucide-react';
import { IconBrandWhatsapp } from '@tabler/icons-react';

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const redirectTo = new URLSearchParams(location.search).get('redirect');

  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [signupComplete, setSignupComplete] = useState(false);
  const [isForgotPassword, setIsForgotPassword] = useState(false);
  const [resetSent, setResetSent] = useState(false);

  // WhatsApp Demo State
  const [showWaDemo, setShowWaDemo] = useState(false);
  const [waStep, setWaStep] = useState(0);

  // Cyclic Text State
  const [cyclicIndex, setCyclicIndex] = useState(0);
  const [showResult, setShowResult] = useState(false);

  const cyclicPhrases = [
    { action: "Send a transaction from WhatsApp", result: "we instantly record it." },
    { action: "Share site progress from WhatsApp", result: "we analyze and map it." },
    { action: "Ask a question about your site", result: "we immediately answer it." }
  ];

  useEffect(() => {
    if (!isSignUp) return;
    
    setShowResult(false);
    const resultTimer = setTimeout(() => setShowResult(true), 1200);
    const nextTimer = setTimeout(() => setCyclicIndex((prev) => (prev + 1) % cyclicPhrases.length), 4500);

    return () => {
      clearTimeout(resultTimer);
      clearTimeout(nextTimer);
    };
  }, [isSignUp, cyclicIndex]);

  // Clear errors when toggling mode
  useEffect(() => {
    setError(null);
    setSuccess(null);
    setSignupComplete(false);
    setIsForgotPassword(false);
    setResetSent(false);
    setTimeout(() => {
      setEmail('');
      setPassword('');
      setName('');
    }, 150);
  }, [isSignUp]);

  // WhatsApp animation sequence
  useEffect(() => {
    if (showWaDemo) {
      setWaStep(0);
      const timers = [
        setTimeout(() => setWaStep(1), 600),   // User message shows
        setTimeout(() => setWaStep(2), 1800),  // Bot typing...
        setTimeout(() => setWaStep(3), 3200),  // Bot reply shows
        setTimeout(() => setWaStep(4), 4500),  // Platform "Recorded" pop-up
        setTimeout(() => setWaStep(5), 6500),  // ERP Dashboard Reveal
        setTimeout(() => setWaStep(6), 8500)   // Gracefully show Signup Button
      ];
      return () => timers.forEach(clearTimeout);
    }
  }, [showWaDemo]);

  const triggerCelebration = () => {
    const duration = 3000;
    const animationEnd = Date.now() + duration;
    const defaults = { startVelocity: 30, spread: 360, ticks: 60, zIndex: 50 };

    const randomInRange = (min: number, max: number) => Math.random() * (max - min) + min;

    const interval: any = setInterval(function () {
      const timeLeft = animationEnd - Date.now();
      if (timeLeft <= 0) return clearInterval(interval);

      const particleCount = 50 * (timeLeft / duration);
      confetti(Object.assign({}, defaults, { particleCount, origin: { x: randomInRange(0.1, 0.3), y: Math.random() - 0.2 } }));
      confetti(Object.assign({}, defaults, { particleCount, origin: { x: randomInRange(0.7, 0.9), y: Math.random() - 0.2 } }));
    }, 250);
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    if (error) setError(error.message);
    else setResetSent(true);
    setLoading(false);
  };

  const handleResendConfirmation = async () => {
    setLoading(true);
    setError(null);
    const { error } = await supabase.auth.resend({ type: 'signup', email });
    if (error) setError(error.message);
    setLoading(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(null);

    if (isSignUp) {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: name }, emailRedirectTo: `${window.location.origin}/welcome` }
      });
      if (error) {
        setError(error.message);
      } else if (data?.user?.identities?.length === 0) {
        // Supabase returns an empty identities array for already-confirmed accounts
        setError('exists');
      } else {
        triggerCelebration();
        setSignupComplete(true);
      }
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        setError(error.message);
      } else if (redirectTo) {
        navigate(redirectTo, { replace: true });
      }
    }
    setLoading(false);
  };

  return (
    <div className="min-h-[100dvh] w-full bg-[#fdfdfc] flex flex-col items-center overflow-x-hidden overflow-y-auto relative selection:bg-[#C8603A]/20 selection:text-[#C8603A] font-sans">

      <style>{`
        @keyframes pastel-float-1 {
          0% { transform: translate(0, 0) scale(1); }
          33% { transform: translate(10vw, -10vh) scale(1.1); }
          66% { transform: translate(-5vw, 15vh) scale(0.9); }
          100% { transform: translate(0, 0) scale(1); }
        }
        @keyframes pastel-float-2 {
          0% { transform: translate(0, 0) scale(1); }
          33% { transform: translate(-10vw, 15vh) scale(1.15); }
          66% { transform: translate(15vw, -5vh) scale(0.85); }
          100% { transform: translate(0, 0) scale(1); }
        }
        @keyframes pastel-float-3 {
          0% { transform: translate(0, 0) scale(1); }
          50% { transform: translate(5vw, 15vh) scale(1.2); }
          100% { transform: translate(0, 0) scale(1); }
        }
        .bg-noise {
          background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E");
          opacity: 0.015;
          pointer-events: none;
        }
        .light-input {
          width: 100%;
          height: 52px;
          padding: 0 16px 0 44px;
          border-radius: 14px;
          border: 1px solid rgba(0,0,0,0.06);
          background: rgba(255,255,255,0.6);
          font-size: 15px;
          color: #1a1a1a;
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        }
        .light-input:focus {
          outline: none;
          border-color: rgba(200,96,58,0.4);
          background: #ffffff;
          box-shadow: 0 0 0 4px rgba(200,96,58,0.08);
        }
        .light-input::placeholder { color: rgba(0,0,0,0.3); font-weight: 400; }
        .light-icon {
          position: absolute;
          left: 16px;
          top: 50%;
          transform: translateY(-50%);
          color: rgba(0,0,0,0.3);
          transition: color 0.3s ease;
        }
        .light-input:focus + .light-icon,
        .light-input:not(:placeholder-shown) + .light-icon {
          color: #C8603A;
        }
        
        .chat-bubble-in {
          animation: popIn 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }
        @keyframes popIn {
          0% { opacity: 0; transform: scale(0.95) translateY(10px); }
          100% { opacity: 1; transform: scale(1) translateY(0); }
        }
      `}</style>

      {/* Background Canvas (Light Theme) */}
      <div className="fixed inset-0 z-0 overflow-hidden pointer-events-none">
        <div className="absolute inset-0 bg-noise z-10" />
        {/* Soft Peach Orb */}
        <div className="absolute top-[10%] left-[20%] w-[600px] h-[600px] bg-[#ffeed9] rounded-full mix-blend-multiply opacity-70 blur-[100px]" style={{ animation: 'pastel-float-1 30s infinite ease-in-out' }} />
        {/* Soft Sky Blue Orb */}
        <div className="absolute top-[20%] right-[10%] w-[700px] h-[700px] bg-[#e0f2fe] rounded-full mix-blend-multiply opacity-60 blur-[120px]" style={{ animation: 'pastel-float-2 35s infinite ease-in-out' }} />
        {/* Soft Mint Orb */}
        <div className="absolute bottom-[0%] left-[30%] w-[500px] h-[500px] bg-[#dcfce7] rounded-full mix-blend-multiply opacity-50 blur-[100px]" style={{ animation: 'pastel-float-3 25s infinite ease-in-out' }} />
      </div>

      {/* Removed static top navigation logo to reposition it dynamically in the form container */}

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col items-center justify-center w-full px-4 pb-8 lg:pb-[4vh] relative z-10 min-h-fit overflow-x-hidden">
        <div className="flex items-center justify-center w-full transition-all duration-[1000ms] ease-[cubic-bezier(0.16,1,0.3,1)] max-w-6xl">

          {/* LEFT COLUMN: Hero & Form */}
          <div className={`flex flex-col items-center transition-all duration-[1000ms] w-full shrink-0 ${isSignUp ? 'md:w-1/2 md:items-end md:pr-10 lg:pr-16' : 'w-full md:w-[500px]'}`}>
            <div className="w-full max-w-[420px] flex flex-col items-center md:items-stretch">

              {/* Dynamic Brand Logo */}
              <div className={`mb-6 lg:mb-[5vh] w-full transition-all duration-[1000ms] flex ${isSignUp ? 'md:justify-start justify-center' : 'justify-center'}`}>
                <div className="flex items-center">
                  <span className="text-3xl lg:text-[clamp(28px,4vh,32px)] font-black tracking-tighter text-slate-900">
                    Briklay<span className="text-[#C8603A]">.</span>
                  </span>
                </div>
              </div>

              {/* Typography Hero */}
              <div className={`mb-4 lg:mb-[4vh] w-full transition-all duration-[1000ms] ${isSignUp ? 'md:text-left' : 'text-center'}`}>
                <h1 className="text-3xl sm:text-5xl lg:text-[clamp(32px,6vh,56px)] font-medium tracking-tight text-slate-900 mb-2 lg:mb-[2vh] leading-[1.15]">
                  Construction{' '}
                  <button
                    onClick={() => setShowWaDemo(true)}
                    className="relative inline-block cursor-pointer group ml-2 border-b-2 border-dashed border-[#C8603A]/40 hover:border-[#C8603A] transition-colors pb-1"
                  >
                    <span className="relative z-10 font-bold text-transparent bg-clip-text bg-gradient-to-r from-[#C8603A] to-[#eab308]">Magic.</span>

                    {/* Subtle background glow */}
                    <div className="absolute inset-0 bg-[#C8603A]/10 rounded-xl blur-md scale-90 opacity-0 group-hover:opacity-100 group-hover:scale-100 transition-all duration-500"></div>

                    {/* Animated Floating Cursor (Below pointing up) */}
                    <div className="absolute -bottom-10 right-0 lg:right-4 text-slate-800 animate-[bounce_2s_infinite] pointer-events-none drop-shadow-lg z-20">
                      <MousePointer2 size={24} className="fill-slate-800" />
                      <div className="absolute inset-0 bg-white/50 blur-md rounded-full -z-10 animate-pulse"></div>
                    </div>
                  </button>
                </h1>
                <div className={`flex items-center gap-3 sm:gap-4 mt-3 lg:mt-[3vh] animate-[popIn_0.8s_ease_forwards] transition-all duration-[1000ms] ${isSignUp ? 'md:justify-start justify-center' : 'justify-center'}`}>
                  <span className="text-[10px] sm:text-[11px] tracking-[0.2em] sm:tracking-[0.3em] uppercase font-medium text-slate-400">Simple</span>
                  <span className="w-1 h-1 rounded-full bg-slate-300/60"></span>
                  <span className="text-[10px] sm:text-[11px] tracking-[0.2em] sm:tracking-[0.3em] uppercase font-medium text-slate-400">Reliable</span>
                  <span className="w-1 h-1 rounded-full bg-slate-300/60"></span>
                  <span className="text-[10px] sm:text-[11px] tracking-[0.2em] sm:tracking-[0.3em] uppercase font-medium text-slate-400">Powerful</span>
                </div>
              </div>

              {/* Form Card */}
              <div className="w-full bg-white/70 backdrop-blur-2xl border border-white rounded-[24px] md:rounded-[28px] p-5 sm:p-6 lg:p-[clamp(24px,4vh,32px)] shadow-[0_24px_48px_-12px_rgba(0,0,0,0.08)] animate-[popIn_0.8s_ease_0.1s_forwards] opacity-0 shrink-0">

                {signupComplete ? (
                  /* Email confirmation screen — shown after successful signup */
                  <div className="text-center py-2">
                    <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-4">
                      <CheckCircle2 size={32} className="text-emerald-600" />
                    </div>
                    <h2 className="text-2xl font-bold text-slate-900 mb-2">Check your email</h2>
                    <p className="text-[14px] text-slate-500 leading-relaxed mb-1">We sent a confirmation link to</p>
                    <p className="text-[14px] font-semibold text-slate-900 mb-6">{email}</p>
                    <p className="text-[13px] text-slate-400 leading-relaxed mb-6">
                      Click the link in your email to activate your account. Check your spam folder if you don't see it within a minute.
                    </p>
                    {error && (
                      <div className="flex items-center gap-3 p-3 rounded-2xl bg-red-50 border border-red-100 text-red-600 mb-4">
                        <AlertCircle size={18} className="shrink-0" />
                        <p className="text-[13px] font-medium leading-snug">{error}</p>
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={handleResendConfirmation}
                      disabled={loading}
                      className="text-[13px] font-medium text-[#C8603A] hover:underline disabled:opacity-50 transition-opacity"
                    >
                      {loading ? 'Sending…' : 'Resend confirmation email'}
                    </button>
                    <div className="mt-6 text-center">
                      <button
                        type="button"
                        className="text-[13px] font-medium text-slate-500 hover:text-slate-900 transition-colors"
                        onClick={() => setIsSignUp(false)}
                      >
                        Back to{' '}
                        <span className="text-slate-900 font-semibold underline decoration-slate-300 underline-offset-4">Sign in</span>
                      </button>
                    </div>
                  </div>
                ) : isForgotPassword ? (
                  /* Forgot password form */
                  <>
                    <div className="mb-4 text-center">
                      <h2 className="text-2xl lg:text-[clamp(20px,3vh,24px)] font-bold text-slate-900 mb-1">Reset password</h2>
                      <p className="text-[14px] text-slate-500">Enter your email and we'll send you a reset link.</p>
                    </div>
                    {resetSent ? (
                      <div className="text-center py-4">
                        <div className="w-14 h-14 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-4">
                          <CheckCircle2 size={28} className="text-emerald-600" />
                        </div>
                        <p className="text-[14px] text-slate-700 font-medium mb-1">Reset link sent!</p>
                        <p className="text-[13px] text-slate-500 leading-relaxed">
                          Check <span className="font-semibold text-slate-800">{email}</span> for a password reset link.
                        </p>
                      </div>
                    ) : (
                      <form onSubmit={handleForgotPassword} className="space-y-3">
                        <div className="relative">
                          <input
                            type="email"
                            className="light-input peer"
                            placeholder="Email address"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            required
                            disabled={loading}
                          />
                          <Mail size={18} strokeWidth={2} className="light-icon" />
                        </div>
                        {error && (
                          <div className="flex items-center gap-3 p-3 rounded-2xl bg-red-50 border border-red-100 text-red-600">
                            <AlertCircle size={18} className="shrink-0" />
                            <p className="text-[13px] font-medium leading-snug">{error}</p>
                          </div>
                        )}
                        <button
                          type="submit"
                          disabled={loading}
                          className="w-full h-[48px] mt-1 relative flex items-center justify-center gap-2 rounded-xl text-white font-semibold text-[15px] transition-all overflow-hidden group disabled:opacity-80 disabled:cursor-not-allowed shadow-[0_8px_20px_-4px_rgba(200,96,58,0.3)] hover:shadow-[0_12px_24px_-4px_rgba(200,96,58,0.4)] hover:-translate-y-0.5 active:translate-y-0"
                          style={{ background: 'linear-gradient(135deg, #C8603A 0%, #da714b 100%)' }}
                        >
                          {loading ? (
                            <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                          ) : (
                            <>
                              <span className="relative z-10">Send Reset Link</span>
                              <ArrowRight size={18} strokeWidth={2.5} className="relative z-10 transition-transform group-hover:translate-x-1" />
                            </>
                          )}
                        </button>
                      </form>
                    )}
                    <div className="mt-6 text-center">
                      <button
                        type="button"
                        className="text-[13px] font-medium text-slate-500 hover:text-slate-900 transition-colors"
                        onClick={() => { setIsForgotPassword(false); setResetSent(false); setError(null); }}
                      >
                        Back to{' '}
                        <span className="text-slate-900 font-semibold underline decoration-slate-300 underline-offset-4">Sign in</span>
                      </button>
                    </div>
                  </>
                ) : (
                  /* Normal login / signup form */
                  <>
                    <div className={`mb-4 lg:mb-[3vh] transition-all duration-[1000ms] ${isSignUp ? 'md:text-left text-center' : 'text-center'}`}>
                      <h2 className="text-2xl lg:text-[clamp(20px,3vh,24px)] font-bold text-slate-900 mb-1">
                        {isSignUp ? 'Create account' : 'Welcome back'}
                      </h2>
                      <p className="text-[14px] text-slate-500">
                        {isSignUp
                          ? "Join the world's most advanced platform."
                          : 'Enter your credentials to access your workspace.'}
                      </p>
                    </div>

                    <form onSubmit={handleSubmit} className="space-y-3">
                      <div
                        className="overflow-hidden transition-all duration-500 ease-[cubic-bezier(0.4,0,0.2,1)]"
                        style={{ maxHeight: isSignUp ? '80px' : '0px', opacity: isSignUp ? 1 : 0 }}
                      >
                        <div className="relative pb-3">
                          <input
                            type="text"
                            className="light-input peer"
                            placeholder="Full Name"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            required={isSignUp}
                            disabled={loading}
                          />
                          <User size={18} strokeWidth={2} className="light-icon" />
                        </div>
                      </div>

                      <div className="relative">
                        <input
                          type="email"
                          className="light-input peer"
                          placeholder="Email address"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          required
                          disabled={loading}
                        />
                        <Mail size={18} strokeWidth={2} className="light-icon" />
                      </div>

                      <div className="relative">
                        <input
                          type="password"
                          className="light-input peer"
                          placeholder="Password"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          required
                          disabled={loading}
                          minLength={isSignUp ? 6 : undefined}
                        />
                        <Lock size={18} strokeWidth={2} className="light-icon" />
                      </div>

                      {!isSignUp && (
                        <div className="flex justify-end -mt-1">
                          <button
                            type="button"
                            onClick={() => { setIsForgotPassword(true); setError(null); }}
                            className="text-[12px] text-slate-400 hover:text-[#C8603A] transition-colors"
                          >
                            Forgot password?
                          </button>
                        </div>
                      )}

                      {/* Error & Success Messages */}
                      <div className="overflow-hidden transition-all duration-300" style={{ maxHeight: error || success ? '120px' : '0px', opacity: error || success ? 1 : 0 }}>
                        {error && error !== 'exists' && (
                          <div className="flex items-center gap-3 p-3 rounded-2xl bg-red-50 border border-red-100 text-red-600 mt-2">
                            <AlertCircle size={18} className="shrink-0" />
                            <p className="text-[13px] font-medium leading-snug">{error}</p>
                          </div>
                        )}
                        {error === 'exists' && (
                          <div className="flex items-start gap-3 p-3 rounded-2xl bg-amber-50 border border-amber-100 text-amber-700 mt-2">
                            <AlertCircle size={18} className="shrink-0 mt-0.5" />
                            <div>
                              <p className="text-[13px] font-medium leading-snug">An account with this email already exists.</p>
                              <button
                                type="button"
                                onClick={() => setIsSignUp(false)}
                                className="text-[12px] text-amber-800 underline underline-offset-2 mt-0.5 hover:text-amber-900"
                              >
                                Log in instead?
                              </button>
                            </div>
                          </div>
                        )}
                        {success && (
                          <div className="flex items-center gap-3 p-3 rounded-2xl bg-emerald-50 border border-emerald-100 text-emerald-600 mt-2">
                            <CheckCircle2 size={18} className="shrink-0" />
                            <p className="text-[13px] font-medium leading-snug">{success}</p>
                          </div>
                        )}
                      </div>

                      {/* Submit Button */}
                      <button
                        type="submit"
                        disabled={loading}
                        className="w-full h-[48px] mt-1 relative flex items-center justify-center gap-2 rounded-xl text-white font-semibold text-[15px] transition-all overflow-hidden group disabled:opacity-80 disabled:cursor-not-allowed shadow-[0_8px_20px_-4px_rgba(200,96,58,0.3)] hover:shadow-[0_12px_24px_-4px_rgba(200,96,58,0.4)] hover:-translate-y-0.5 active:translate-y-0"
                        style={{ background: 'linear-gradient(135deg, #C8603A 0%, #da714b 100%)' }}
                      >
                        {loading ? (
                          <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        ) : (
                          <>
                            <span className="relative z-10">{isSignUp ? 'Create Account' : 'Sign In'}</span>
                            <ArrowRight size={18} strokeWidth={2.5} className="relative z-10 transition-transform group-hover:translate-x-1" />
                          </>
                        )}
                      </button>
                    </form>

                    {/* Toggle mode */}
                    <div className="mt-6 lg:mt-[3vh] text-center">
                      <button
                        type="button"
                        className="text-[13px] font-medium text-slate-500 hover:text-slate-900 transition-colors inline-flex items-center gap-1.5"
                        onClick={() => setIsSignUp(!isSignUp)}
                      >
                        {isSignUp ? 'Already have an account?' : "Don't have an account?"}
                        <span className="text-slate-900 font-semibold underline decoration-slate-300 underline-offset-4">
                          {isSignUp ? 'Sign in' : 'Sign up'}
                        </span>
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* RIGHT COLUMN: Sign Up Details Panel */}
          <div
            className={`hidden md:flex flex-col justify-center transition-all duration-[1000ms] ease-[cubic-bezier(0.16,1,0.3,1)] overflow-hidden ${isSignUp ? 'w-1/2 opacity-100 pl-10 lg:pl-16' : 'w-0 opacity-0'
              }`}
            style={{ maxHeight: isSignUp ? '1000px' : '0px' }}
          >
            <div className="w-full max-w-[440px] whitespace-nowrap">

              <div className="mb-6 lg:mb-[6vh]">
                <h3 className="text-3xl lg:text-[clamp(24px,5vh,30px)] font-medium tracking-tight text-slate-900 mb-2 lg:mb-[2vh]">Build faster, <br />together.</h3>
                <p className="text-[14px] lg:text-[clamp(13px,2vh,15px)] text-slate-500 leading-relaxed whitespace-normal pr-10">
                  Join the most advanced construction ecosystem. Synchronize your sites, vendors, and ledger in real-time.
                </p>
              </div>

              <div className="flex flex-col gap-6 lg:gap-[4vh]">

                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-white to-emerald-50/40 border border-white/80 shadow-[0_4px_16px_-4px_rgba(16,185,129,0.15),inset_0_2px_6px_-2px_rgba(255,255,255,1)] flex items-center justify-center shrink-0 backdrop-blur-xl relative overflow-hidden group">
                    <div className="absolute inset-0 bg-gradient-to-tr from-emerald-100/30 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-700"></div>
                    <IconBrandWhatsapp size={24} strokeWidth={1.5} className="text-emerald-700 relative z-10" />
                  </div>
                  <div className="pt-1">
                    <h4 className="font-semibold text-slate-900 text-[15px] tracking-tight">Conversational Intelligence</h4>
                    <div className="text-[14px] text-slate-500 mt-1 whitespace-normal leading-relaxed relative">
                      <span className="block mb-1">Work exactly how you communicate:</span>
                      <div className="grid min-h-[44px]">
                        {cyclicPhrases.map((phrase, idx) => (
                          <span 
                            key={idx}
                            className={`col-start-1 row-start-1 transition-all duration-[1200ms] ease-[cubic-bezier(0.16,1,0.3,1)] flex flex-wrap gap-x-1 ${
                              idx === cyclicIndex 
                                ? 'opacity-100 translate-y-0 relative z-10' 
                                : 'opacity-0 translate-y-2 pointer-events-none absolute'
                            }`}
                          >
                            <span className="text-slate-600 font-medium">{phrase.action}</span>
                            <span 
                              className={`transition-all duration-[1200ms] ease-out text-emerald-700 font-medium ${
                                idx === cyclicIndex && showResult 
                                  ? 'opacity-100 blur-none translate-x-0' 
                                  : 'opacity-0 blur-[4px] -translate-x-2'
                              }`}
                            >
                              — {phrase.result}
                            </span>
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-white to-blue-50/40 border border-white/80 shadow-[0_4px_16px_-4px_rgba(59,130,246,0.15),inset_0_2px_6px_-2px_rgba(255,255,255,1)] flex items-center justify-center shrink-0 backdrop-blur-xl relative overflow-hidden group">
                    <div className="absolute inset-0 bg-gradient-to-tr from-blue-100/30 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-700"></div>
                    <Layers size={22} strokeWidth={1.5} className="text-blue-700 relative z-10" />
                  </div>
                  <div className="pt-1">
                    <h4 className="font-semibold text-slate-900 text-[15px] tracking-tight">Multi-Project Tracking</h4>
                    <p className="text-[14px] text-slate-500 mt-1 whitespace-normal leading-relaxed">
                      Manage an unlimited number of active work sites with precise, real-time financial breakdowns at your fingertips.
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-white to-amber-50/40 border border-white/80 shadow-[0_4px_16px_-4px_rgba(245,158,11,0.15),inset_0_2px_6px_-2px_rgba(255,255,255,1)] flex items-center justify-center shrink-0 backdrop-blur-xl relative overflow-hidden group">
                    <div className="absolute inset-0 bg-gradient-to-tr from-amber-100/30 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-700"></div>
                    <BrainCircuit size={22} strokeWidth={1.5} className="text-amber-700 relative z-10" />
                  </div>
                  <div className="pt-1">
                    <h4 className="font-semibold text-slate-900 text-[15px] tracking-tight">Proactive Intelligence</h4>
                    <p className="text-[14px] text-slate-500 mt-1 whitespace-normal leading-relaxed">
                      Briklay analyzes your transaction patterns and workflows, uniting orders and site data to deliver actionable, comprehensive insights.
                    </p>
                  </div>
                </div>

              </div>

            </div>
          </div>

        </div>
      </div>

      {/* WhatsApp Interactive Demo Modal */}
      {showWaDemo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm animate-[popIn_0.3s_ease] overflow-hidden">
          <div className="absolute inset-0" onClick={() => setShowWaDemo(false)} />

          {/* Smooth Sliding Wrapper */}
          <div
            className={`relative flex items-center justify-center transition-transform duration-[800ms] ease-[cubic-bezier(0.16,1,0.3,1)] ${waStep >= 5 ? 'md:-translate-x-[200px] -translate-y-[80px] md:-translate-y-0' : 'translate-x-0 translate-y-0'
              }`}
          >

            {/* The Phone */}
            <div className={`relative w-[340px] h-[640px] bg-[#ece5dd] rounded-[36px] shadow-2xl overflow-hidden border-[8px] border-slate-800 transition-all duration-[800ms] ease-[cubic-bezier(0.16,1,0.3,1)] z-20 flex flex-col ${waStep >= 5 ? 'opacity-20 blur-[4px] md:blur-none md:opacity-70 scale-[0.98]' : 'opacity-100 scale-100 blur-0'}`}>

              {/* Phone Header */}
              <div className="bg-[#075e54] text-white px-4 py-3 flex items-center justify-between shadow-md relative z-10 pt-6">
                <div className="absolute top-0 inset-x-0 h-6 bg-black flex justify-center rounded-t-[28px]">
                  <div className="w-32 h-4 bg-black rounded-b-xl mt-[-2px]"></div>
                </div>
                <div className="flex items-center gap-3 mt-2">
                  <button onClick={() => setShowWaDemo(false)} className="hover:bg-white/10 p-1 rounded-full transition-colors -ml-1">
                    <ArrowRight size={20} className="rotate-180" />
                  </button>
                  <div className="w-9 h-9 rounded-full bg-white flex items-center justify-center">
                    <Building2 size={20} className="text-[#075e54]" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-[15px] leading-tight">Briklay ERP</h3>
                    <p className="text-[11px] text-white/80">Online</p>
                  </div>
                </div>
              </div>

              {/* Chat Body */}
              <div className="flex-1 p-4 overflow-y-auto flex flex-col gap-3 bg-[url('https://i.pinimg.com/736x/8c/98/99/8c98994518b575bfd8c949e91d20548b.jpg')] bg-cover bg-center">

                {waStep >= 1 && (
                  <div className="self-end max-w-[85%] bg-[#dcf8c6] rounded-xl rounded-tr-none p-3 shadow-sm chat-bubble-in">
                    <p className="text-[14px] text-slate-800 leading-snug">Record a cement purchase of ₹45,000 from UltraTech.</p>
                    <span className="text-[10px] text-slate-500 float-right mt-1 ml-2">10:42 AM</span>
                  </div>
                )}

                {waStep === 2 && (
                  <div className="self-start max-w-[85%] bg-white rounded-xl rounded-tl-none p-3 shadow-sm chat-bubble-in flex items-center gap-1.5">
                    <div className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                    <div className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: '150ms' }} />
                    <div className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                )}

                {waStep >= 3 && (
                  <div className="self-start max-w-[85%] bg-white rounded-xl rounded-tl-none p-3 shadow-sm chat-bubble-in">
                    <p className="text-[14px] text-slate-800 leading-snug">Done! I've recorded a purchase order for ₹45,000 to UltraTech.</p>
                    <div className="mt-2 bg-slate-50 border border-slate-100 rounded-lg p-2 flex items-center gap-2">
                      <div className="w-8 h-8 rounded-full bg-[#C8603A]/10 flex items-center justify-center">
                        <Sparkles size={14} className="text-[#C8603A]" />
                      </div>
                      <div>
                        <p className="text-[12px] font-semibold text-slate-900">PO-UT-45K created</p>
                        <p className="text-[10px] text-slate-500">View in Briklay</p>
                      </div>
                    </div>
                    <span className="text-[10px] text-slate-500 float-right mt-1 ml-2">10:42 AM</span>
                  </div>
                )}
              </div>

              {/* Action Popup overlaying the chat */}
              {waStep === 4 && (
                <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 flex justify-center pointer-events-none chat-bubble-in z-20">
                  <div className="bg-white/95 backdrop-blur-md shadow-2xl rounded-2xl p-4 border border-slate-100 flex flex-col items-center gap-2 transform -rotate-2">
                    <div className="w-12 h-12 rounded-full bg-emerald-100 flex items-center justify-center">
                      <CheckCircle2 size={24} className="text-emerald-600" />
                    </div>
                    <div className="text-center">
                      <p className="text-sm font-bold text-slate-900">Transaction Recorded</p>
                      <p className="text-[11px] text-slate-500">Synced to ERP instantly.</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Fake input bar */}
              <div className="bg-[#f0f0f0] p-2 flex items-center gap-2 relative z-10 pb-6 shrink-0">
                <div className="flex-1 bg-white rounded-full h-10 px-4 text-sm text-slate-400 flex items-center">
                  Message...
                </div>
                <div className="w-10 h-10 rounded-full bg-[#00897b] flex items-center justify-center shrink-0">
                  <div className="w-3 h-3 bg-white rounded-sm transform rotate-45 ml-[-2px]" />
                </div>
              </div>
            </div>

            {/* The ERP Dashboard Reveal (Responsive positioning) */}
            <div
              className={`flex flex-col w-[340px] md:w-[640px] h-[340px] md:h-[580px] bg-white rounded-[24px] shadow-2xl overflow-hidden border border-slate-200 absolute md:left-[380px] left-0 top-[240px] md:top-auto transition-all duration-[800ms] ease-[cubic-bezier(0.16,1,0.3,1)] z-30 ${waStep >= 5 ? 'opacity-100 translate-y-0 md:translate-x-0 scale-100 pointer-events-auto' : 'opacity-0 translate-y-10 md:translate-y-0 md:-translate-x-10 scale-[0.95] pointer-events-none'
                }`}
            >
              {/* Header */}
              <div className="px-5 md:px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50 shrink-0">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-[#C8603A] flex items-center justify-center">
                    <Building2 size={16} className="text-white" />
                  </div>
                  <h2 className="text-base md:text-lg font-bold text-slate-800">Purchase Orders</h2>
                </div>
                <div className="px-2 md:px-3 py-1 bg-emerald-100 text-emerald-700 text-[10px] md:text-xs font-bold rounded-full animate-pulse flex items-center gap-1.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-500"></div> LIVE SYNC
                </div>
              </div>
              {/* Table */}
              <div className="flex-1 p-4 md:p-6 bg-white overflow-y-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="text-[10px] md:text-xs uppercase text-slate-400 border-b border-slate-100">
                      <th className="pb-3 font-semibold">PO Number</th>
                      <th className="pb-3 font-semibold hidden md:table-cell">Vendor</th>
                      <th className="pb-3 font-semibold">Amount</th>
                      <th className="pb-3 font-semibold">Source</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b border-slate-50">
                      <td className="py-4 text-xs md:text-sm font-medium text-slate-900">PO-UT-44K</td>
                      <td className="py-4 text-xs md:text-sm text-slate-600 hidden md:table-cell">Ambuja Cements</td>
                      <td className="py-4 text-xs md:text-sm text-slate-900">₹32,000</td>
                      <td className="py-4"><span className="px-2 py-1 bg-slate-100 text-slate-600 rounded text-[10px] md:text-xs">Web</span></td>
                    </tr>
                    {/* Animated Row */}
                    <tr className="bg-[#25D366]/5 chat-bubble-in border-l-4 border-[#25D366]">
                      <td className="py-4 pl-2 md:pl-3 text-xs md:text-sm font-bold text-slate-900">PO-UT-45K</td>
                      <td className="py-4 text-xs md:text-sm font-medium text-slate-900 hidden md:table-cell">UltraTech</td>
                      <td className="py-4 text-xs md:text-sm font-bold text-emerald-600">₹45,000</td>
                      <td className="py-4">
                        <span className="inline-flex items-center gap-1 px-1.5 md:px-2 py-1 bg-[#25D366]/10 text-[#25D366] rounded text-[10px] md:text-xs font-bold whitespace-nowrap">
                          <IconBrandWhatsapp size={12} className="shrink-0" /> <span className="hidden sm:inline">WhatsApp</span><span className="sm:hidden">WA</span>
                        </span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

          </div>

          {/* Gracefully Show Signup Button at the end of the demo */}
          {waStep >= 6 && (
            <div className="absolute bottom-12 left-1/2 -translate-x-1/2 z-50">
              <div className="animate-[popIn_0.8s_ease]">
                <button
                  onClick={() => {
                    setShowWaDemo(false);
                    setIsSignUp(true);
                  }}
                  className="h-[56px] px-6 sm:px-10 bg-gradient-to-r from-slate-900 to-slate-800 text-white rounded-full font-semibold text-[14px] sm:text-[15px] shadow-[0_12px_30px_-8px_rgba(200,96,58,0.4)] hover:shadow-[0_20px_40px_-8px_rgba(200,96,58,0.5)] hover:-translate-y-1 hover:border-[#C8603A]/50 transition-all duration-300 flex items-center justify-center gap-3 sm:gap-4 border border-slate-700/50 group overflow-hidden relative"
                >
                  {/* Subtle inner glow */}
                  <div className="absolute inset-0 bg-gradient-to-b from-white/10 to-transparent opacity-50 rounded-full pointer-events-none" />
                  {/* Hover sheen */}
                  <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent -translate-x-[100%] group-hover:translate-x-[100%] transition-transform duration-1000 pointer-events-none" />

                  <span className="hidden sm:inline relative z-10 tracking-wide font-medium">Unlock your Workspace</span>
                  <span className="sm:hidden relative z-10 tracking-wide font-medium">Experience Briklay</span>

                  <div className="w-8 h-8 rounded-full bg-white/10 backdrop-blur-sm shadow-inner flex items-center justify-center group-hover:bg-[#C8603A] transition-colors relative z-10">
                    <ArrowRight size={16} className="text-white group-hover:translate-x-0.5 transition-transform" />
                  </div>
                </button>
              </div>
            </div>
          )}
        </div>
      )}

    </div>
  );
}
