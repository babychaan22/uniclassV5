import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { supabase } from '@/api/supabaseClient';
import { ROUTES } from '@/lib/routes';

function GoogleMark() {
  return <svg aria-hidden="true" className="h-5 w-5" viewBox="0 0 24 24">
    <path fill="#4285F4" d="M21.8 12.2c0-.7-.1-1.3-.2-1.9H12v3.6h5.5a4.7 4.7 0 0 1-2 3.1v2.4h3.2c1.9-1.7 3.1-4.2 3.1-7.2Z" />
    <path fill="#34A853" d="M12 22c2.8 0 5.1-.9 6.8-2.5L15.6 17a6 6 0 0 1-8.9-3.1H3.4v2.5A10 10 0 0 0 12 22Z" />
    <path fill="#FBBC05" d="M6.7 13.9a6 6 0 0 1 0-3.8V7.6H3.4a10 10 0 0 0 0 8.8l3.3-2.5Z" />
    <path fill="#EA4335" d="M12 6a5.5 5.5 0 0 1 3.9 1.5l2.9-2.8A9.9 9.9 0 0 0 3.4 7.6l3.3 2.5A6 6 0 0 1 12 6Z" />
  </svg>;
}

export default function GoogleSignInButton({ onError, disabled = false }) {
  const [loading, setLoading] = useState(false);

  async function continueWithGoogle() {
    onError?.('');
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}${ROUTES.AUTH_CALLBACK}`,
          // School devices are often shared. Let the learner or teacher
          // deliberately choose the Google account every time.
          queryParams: { prompt: 'select_account' },
        },
      });
      if (error) throw error;
    } catch (error) {
      setLoading(false);
      onError?.(error?.message || 'Google sign-in could not start. Please try again.');
    }
  }

  return <button
    type="button"
    onClick={continueWithGoogle}
    disabled={disabled || loading}
    className="clay-btn flex h-12 w-full items-center justify-center gap-3 bg-white px-4 text-sm font-display font-bold text-ink disabled:cursor-not-allowed disabled:opacity-60"
  >
    {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <GoogleMark />}
    {loading ? 'Opening Google…' : 'Continue with Google'}
  </button>;
}
