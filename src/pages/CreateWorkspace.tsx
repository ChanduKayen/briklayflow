import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { IconCircleCheck, IconCircleX, IconLoader2 } from '@tabler/icons-react';
import { supabase } from '../lib/supabase';


type CreateWorkspaceResult = {
  success: boolean
  error: string | null
}

function nameToSlug(n: string): string {
  return n
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 48);
}

export default function CreateWorkspace({ session }: { session: Session }) {
  const navigate = useNavigate();

  const [name,          setName]          = useState('');
  const [slug,          setSlug]          = useState('');
  const [slugEdited,    setSlugEdited]    = useState(false);
  const [slugAvailable, setSlugAvailable] = useState<boolean | null>(null);
  const [checkingSlug,  setCheckingSlug]  = useState(false);
  const [submitting,    setSubmitting]    = useState(false);
  const [error,         setError]         = useState<string | null>(null);

  // Auto-generate slug from name while user hasn't manually edited it
  useEffect(() => {
    if (!slugEdited) {
      setSlug(nameToSlug(name));
    }
  }, [name, slugEdited]);

  // Debounced slug availability check
  useEffect(() => {
    if (slug.length < 4) {
      setSlugAvailable(null);
      return;
    }
    setSlugAvailable(null);
    const timer = setTimeout(async () => {
      setCheckingSlug(true);
      const { count } = await supabase
        .from('organizations')
        .select('*', { count: 'exact', head: true })
        .eq('slug', slug)
        .eq('status', 'active');
      setSlugAvailable(count === 0);
      setCheckingSlug(false);
    }, 600);
    return () => clearTimeout(timer);
  }, [slug]);

  const handleSubmit = async () => {
    if (!slugAvailable || submitting) return;
    setSubmitting(true);
    setError(null);

    const { data, error: rpcError } = await supabase
      .rpc('create_workspace', {
        p_user_id: session.user.id,
        p_name:    name,
        p_slug:    slug,
      })
      .single<CreateWorkspaceResult>();

    if (rpcError || !data?.success) {
      setError(data?.error ?? rpcError?.message ?? 'Something went wrong');
      setSubmitting(false);
      return;
    }

    localStorage.removeItem('briklay_membership_ctx');
    window.location.href = '/onboarding';
  };

  const canSubmit = name.trim().length >= 2 && slugAvailable === true && !submitting;

  return (
    <div className="flex items-center justify-center min-h-screen bg-background px-margin-mobile">
      <div className="w-full max-w-[360px] bg-surface-container-lowest p-8 rounded-2xl shadow-card-md border border-outline-variant/30">

        <div className="text-center mb-8">
          <h1 className="text-headline-lg font-headline-lg font-black text-primary mb-2">Briklay</h1>
        </div>

        <div className="text-center mb-6">
          <p className="text-[18px] font-medium text-on-surface mb-2">Create your workspace</p>
          <p className="text-[13px] text-on-surface-variant leading-[1.5]">
            This is where your team, projects and transactions will live.
          </p>
        </div>

        <div className="space-y-4">

          {/* Workspace name */}
          <div className="space-y-1.5">
            <label className="text-[11px] text-on-surface-variant uppercase tracking-wide block">
              Workspace name
            </label>
            <input
              className="bk-input"
              placeholder="e.g. Briklay Engineering"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          {/* Workspace URL — prefix + slug input */}
          <div className="space-y-1.5">
            <label className="text-[11px] text-on-surface-variant uppercase tracking-wide block">
              Workspace URL
            </label>
            <div
              className="flex items-stretch rounded-lg border border-outline-variant overflow-hidden focus-within:ring-2 focus-within:ring-primary focus-within:border-primary transition-all"
              style={{ height: '46px' }}
            >
              <span
                className="flex items-center px-3 text-[12px] text-on-surface-variant shrink-0 border-r border-outline-variant bg-surface-container-low select-none"
              >
                briklayflow.com/
              </span>
              <div className="relative flex-1 flex items-center">
                <input
                  className="w-full h-full px-3 text-[14px] bg-transparent outline-none text-on-surface pr-8"
                  value={slug}
                  placeholder="your-workspace"
                  onChange={(e) => {
                    setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''));
                    setSlugEdited(true);
                  }}
                />
                <div className="absolute right-2 flex items-center pointer-events-none">
                  {checkingSlug && (
                    <IconLoader2 size={15} className="text-on-surface-variant animate-spin" strokeWidth={2} />
                  )}
                  {!checkingSlug && slug.length >= 4 && slugAvailable === true && (
                    <IconCircleCheck size={15} className="text-green-600" strokeWidth={2} />
                  )}
                  {!checkingSlug && slug.length >= 4 && slugAvailable === false && (
                    <IconCircleX size={15} className="text-error" strokeWidth={2} />
                  )}
                </div>
              </div>
            </div>
            <p className={`text-[11px] ${
              slugAvailable === false ? 'text-error' :
              slugAvailable === true  ? 'text-green-600' :
              'text-on-surface-variant'
            }`}>
              {slugAvailable === false
                ? 'This URL is taken. Try another.'
                : slugAvailable === true
                ? 'Available.'
                : 'Lowercase letters, numbers and hyphens only.'}
            </p>
          </div>

        </div>

        {error && (
          <div className="mt-4 p-3 bg-error-container text-on-error-container rounded-lg text-[13px]">
            {error}
          </div>
        )}

        <button
          className="bk-btn w-full mt-6 flex items-center justify-center gap-2"
          style={{ height: '44px' }}
          disabled={!canSubmit}
          onClick={handleSubmit}
        >
          {submitting ? (
            <>
              <IconLoader2 size={15} className="animate-spin" strokeWidth={2} />
              Creating...
            </>
          ) : (
            'Create workspace →'
          )}
        </button>

        <p className="text-[11px] text-on-surface-variant text-center mt-6">
          Already have an invite?{' '}
          <Link to="/login" className="hover:text-on-surface transition-colors">
            Sign in with a different account
          </Link>
        </p>

      </div>
    </div>
  );
}
