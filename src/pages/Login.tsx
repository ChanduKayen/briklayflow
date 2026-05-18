import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import confetti from 'canvas-confetti';
import { Mail, Lock, User, AlertCircle, CheckCircle2, ArrowRight } from 'lucide-react';

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

  // Clear errors when toggling mode
  useEffect(() => {
    setError(null);
    setSuccess(null);
    // Add a slight delay before clearing fields to allow exit animations
    setTimeout(() => {
      setEmail('');
      setPassword('');
      setName('');
    }, 150);
  }, [isSignUp]);

  const triggerCelebration = () => {
    const duration = 3000;
    const animationEnd = Date.now() + duration;
    const defaults = { startVelocity: 30, spread: 360, ticks: 60, zIndex: 0 };

    const randomInRange = (min: number, max: number) => Math.random() * (max - min) + min;

    const interval: any = setInterval(function() {
      const timeLeft = animationEnd - Date.now();

      if (timeLeft <= 0) {
        return clearInterval(interval);
      }

      const particleCount = 50 * (timeLeft / duration);
      confetti(Object.assign({}, defaults, { particleCount, origin: { x: randomInRange(0.1, 0.3), y: Math.random() - 0.2 } }));
      confetti(Object.assign({}, defaults, { particleCount, origin: { x: randomInRange(0.7, 0.9), y: Math.random() - 0.2 } }));
    }, 250);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(null);

    if (isSignUp) {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: name } }
      });
      if (error) {
        setError(error.message);
      } else {
        setSuccess("Account created successfully. Welcome aboard!");
        triggerCelebration();
        // Automatically switch back to sign in mode after a delay
        setTimeout(() => {
          setIsSignUp(false);
          setEmail('');
          setPassword('');
          setName('');
        }, 4000);
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
    <div className="min-h-screen flex w-full bg-[#fcfbf9] overflow-hidden">
      {/* Dynamic CSS styles for the animations and gradients */}
      <style>{`
        @keyframes fade-slide-up {
          0% { opacity: 0; transform: translateY(20px); }
          100% { opacity: 1; transform: translateY(0); }
        }
        @keyframes gradient-shift {
          0% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
          100% { background-position: 0% 50%; }
        }
        @keyframes blob-float {
          0% { transform: translate(0px, 0px) scale(1); }
          33% { transform: translate(30px, -50px) scale(1.1); }
          66% { transform: translate(-20px, 20px) scale(0.9); }
          100% { transform: translate(0px, 0px) scale(1); }
        }
        .animate-fade-in { animation: fade-slide-up 0.7s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
        .delay-100 { animation-delay: 100ms; }
        .delay-200 { animation-delay: 200ms; }
        .delay-300 { animation-delay: 300ms; }
        .delay-400 { animation-delay: 400ms; }
        .opacity-0 { opacity: 0; }
        
        .premium-input {
          width: 100%;
          height: 52px;
          padding: 0 16px 0 44px;
          border-radius: 12px;
          border: 1px solid rgba(0,0,0,0.08);
          background: rgba(255,255,255,0.8);
          font-size: 15px;
          color: #1a1a1a;
          transition: all 0.2s ease;
          backdrop-filter: blur(8px);
        }
        .premium-input:focus {
          outline: none;
          border-color: #C8603A;
          box-shadow: 0 0 0 4px rgba(200,96,58,0.1);
          background: #ffffff;
        }
        .premium-input::placeholder { color: rgba(0,0,0,0.3); font-weight: 400; }
        
        .input-icon {
          position: absolute;
          left: 16px;
          top: 50%;
          transform: translateY(-50%);
          color: rgba(0,0,0,0.35);
          transition: color 0.2s ease;
        }
        .premium-input:focus + .input-icon,
        .premium-input:not(:placeholder-shown) + .input-icon {
          color: #C8603A;
        }
      `}</style>

      {/* Left side: Form Container */}
      <div className="w-full lg:w-[45%] flex flex-col justify-center px-8 md:px-16 lg:px-24 xl:px-32 relative z-10">
        
        <div className="w-full max-w-[420px] mx-auto">
          {/* Logo */}
          <div className="mb-12 animate-fade-in opacity-0">
            <h1 className="text-3xl font-black tracking-tight" style={{ color: '#1a1a1a' }}>Briklay.</h1>
          </div>

          {/* Headings */}
          <div className="mb-10 animate-fade-in opacity-0 delay-100">
            <h2 className="text-[32px] font-bold leading-tight mb-2 text-[#1a1a1a]">
              {isSignUp ? 'Create an account' : 'Welcome back'}
            </h2>
            <p className="text-[15px] text-[#666] font-medium">
              {isSignUp 
                ? 'Join Briklay to build and manage world-class projects.' 
                : 'Please enter your details to sign in.'}
            </p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-5 animate-fade-in opacity-0 delay-200">
            
            {/* Smooth height transition wrapper for Name field */}
            <div 
              className={`overflow-hidden transition-all duration-500 ease-[cubic-bezier(0.4,0,0.2,1)]`}
              style={{ maxHeight: isSignUp ? '100px' : '0px', opacity: isSignUp ? 1 : 0 }}
            >
              <div className="relative pb-5">
                <input 
                  type="text" 
                  className="premium-input peer" 
                  placeholder="Full Name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required={isSignUp}
                  disabled={loading}
                />
                <User size={18} strokeWidth={2} className="input-icon" />
              </div>
            </div>

            <div className="relative">
              <input 
                type="email" 
                className="premium-input peer" 
                placeholder="Email address"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={loading}
              />
              <Mail size={18} strokeWidth={2} className="input-icon" />
            </div>

            <div className="relative">
              <input 
                type="password" 
                className="premium-input peer" 
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                disabled={loading}
                minLength={isSignUp ? 6 : undefined}
              />
              <Lock size={18} strokeWidth={2} className="input-icon" />
            </div>

            {/* Error & Success Messages */}
            <div className="overflow-hidden transition-all duration-300" style={{ maxHeight: error || success ? '100px' : '0px', opacity: error || success ? 1 : 0 }}>
              {error && (
                <div className="flex items-center gap-3 p-3.5 rounded-xl bg-red-50 text-red-600 border border-red-100">
                  <AlertCircle size={18} className="shrink-0" />
                  <p className="text-[13.5px] font-medium leading-snug">{error}</p>
                </div>
              )}
              {success && (
                <div className="flex items-center gap-3 p-3.5 rounded-xl bg-green-50 text-emerald-600 border border-green-100">
                  <CheckCircle2 size={18} className="shrink-0" />
                  <p className="text-[13.5px] font-medium leading-snug">{success}</p>
                </div>
              )}
            </div>

            {/* Submit Button */}
            <button 
              type="submit" 
              disabled={loading}
              className="w-full h-[52px] mt-2 relative flex items-center justify-center gap-2 rounded-xl text-white font-semibold text-[15px] transition-all overflow-hidden group disabled:opacity-80 disabled:cursor-not-allowed hover:shadow-lg hover:-translate-y-0.5 active:translate-y-0"
              style={{ background: '#C8603A', boxShadow: '0 4px 14px 0 rgba(200,96,58,0.39)' }}
            >
              {loading ? (
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <>
                  <span className="relative z-10">{isSignUp ? 'Create Account' : 'Sign In'}</span>
                  <ArrowRight size={18} strokeWidth={2.5} className="relative z-10 transition-transform group-hover:translate-x-1" />
                </>
              )}
              {/* Button hover gradient overlay */}
              <div className="absolute inset-0 bg-gradient-to-r from-black/0 via-white/20 to-black/0 opacity-0 group-hover:opacity-100 transform -translate-x-full group-hover:animate-[shimmer_1.5s_infinite]" />
            </button>
          </form>

          {/* Toggle mode */}
          <div className="mt-8 text-center animate-fade-in opacity-0 delay-300">
            <button 
              type="button" 
              className="text-[14px] font-medium text-[#666] hover:text-[#1a1a1a] transition-colors inline-flex items-center gap-1.5"
              onClick={() => setIsSignUp(!isSignUp)}
            >
              {isSignUp ? 'Already have an account?' : "Don't have an account?"}
              <span style={{ color: '#C8603A', fontWeight: 600 }}>
                {isSignUp ? 'Sign in' : 'Sign up'}
              </span>
            </button>
          </div>
          
        </div>
      </div>

      {/* Right side: Visual Showcase */}
      <div className="hidden lg:flex flex-1 relative bg-[#1a1a1a] overflow-hidden items-center justify-center p-12">
        {/* Animated Background Mesh */}
        <div 
          className="absolute inset-0 opacity-60"
          style={{
            background: 'linear-gradient(-45deg, #1a1a1a, #2c1b14, #3d2218, #1a1a1a)',
            backgroundSize: '400% 400%',
            animation: 'gradient-shift 15s ease infinite',
          }}
        />
        
        {/* Abstract Blobs */}
        <div className="absolute w-[600px] h-[600px] bg-[#C8603A]/20 rounded-full blur-3xl top-[-100px] right-[-100px] mix-blend-screen" style={{ animation: 'blob-float 20s infinite ease-in-out' }} />
        <div className="absolute w-[500px] h-[500px] bg-[#eab308]/10 rounded-full blur-3xl bottom-[-100px] left-[-100px] mix-blend-screen" style={{ animation: 'blob-float 25s infinite ease-in-out reverse' }} />

        {/* Content Overlay */}
        <div className="relative z-10 max-w-lg text-white animate-fade-in opacity-0 delay-400">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/10 border border-white/20 backdrop-blur-md mb-8">
            <span className="w-2 h-2 rounded-full bg-[#C8603A] animate-pulse" />
            <span className="text-[11px] font-bold tracking-widest uppercase text-white/90">Briklay Platform 2.0</span>
          </div>
          
          <h2 className="text-5xl font-bold leading-[1.1] tracking-tight mb-6" style={{ textShadow: '0 4px 24px rgba(0,0,0,0.5)' }}>
            Build the future.<br/>
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-white to-white/60">
              Manage with precision.
            </span>
          </h2>
          
          <p className="text-lg text-white/70 font-medium leading-relaxed max-w-md">
            Join the world's most advanced construction ERP. Track finances, empower teams, and deliver projects on time, every time.
          </p>

          {/* Testimonial / Social Proof */}
          <div className="mt-16 pt-8 border-t border-white/10 flex items-center gap-4">
            <div className="flex -space-x-3">
              {[1,2,3].map(i => (
                <div key={i} className="w-10 h-10 rounded-full bg-white/20 border-2 border-[#1a1a1a] flex items-center justify-center backdrop-blur-sm">
                  <User size={16} className="text-white/80" />
                </div>
              ))}
            </div>
            <div>
              <div className="flex items-center gap-1 mb-0.5">
                {[1,2,3,4,5].map(i => (
                  <svg key={i} className="w-3.5 h-3.5 text-[#eab308]" fill="currentColor" viewBox="0 0 20 20"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" /></svg>
                ))}
              </div>
              <p className="text-[13px] font-medium text-white/60">Trusted by 1,000+ construction teams</p>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
