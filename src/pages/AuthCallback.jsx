import { useEffect, useRef, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { supabase } from "@/api/supabaseClient";
import { ROUTES } from "@/lib/routes";
import ClayButton from '@/components/ClayButton';
import { AlertCircle, LogIn } from 'lucide-react';

export default function AuthCallback() {
  const navigate = useNavigate();
  const location = useLocation();
  const started = useRef(false);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    async function exchangeCode() {
      try {
        const params = new URLSearchParams(location.search);
        const code = params.get('code');
        let session = null;
        if (code) {
          const { data, error } = await supabase.auth.exchangeCodeForSession(location.search);
          if (error) throw error;
          session = data.session;
        }
        if (!session) {
          const { data, error } = await supabase.auth.getSession();
          if (error) throw error;
          session = data.session;
        }
        if (!session) throw new Error('Your sign-in link has expired. Please choose your Google account again.');
        // New Google accounts have no classroom role yet. The home route
        // deliberately sends them through UniClass role and class setup. A
        // full return prevents an OAuth callback route from retaining an old
        // error-boundary state during a first-time account setup.
        window.location.replace(ROUTES.HOME);
      } catch (error) {
        console.error("Auth callback error:", error);
        setErrorMessage(error?.message || 'Google sign-in could not finish. Please try again.');
      }
    }

    if (started.current) return;
    started.current = true;
    exchangeCode();
  }, [location, navigate]);

  if (errorMessage) {
    return <div className="fixed inset-0 flex items-center justify-center bg-cream px-4"><div className="clay-card w-full max-w-sm p-6 text-center"><div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-clay-coral/15 text-clay-coral"><AlertCircle className="h-6 w-6" /></div><h1 className="mt-3 font-display text-xl font-extrabold text-ink">Google sign-in needs another try</h1><p className="mt-2 text-sm leading-relaxed text-ink/65">{errorMessage}</p><ClayButton className="mt-5 w-full" color="purple" onClick={() => navigate(ROUTES.LOGIN, { replace: true })}><LogIn className="h-4 w-4" /> Back to sign in</ClayButton></div></div>;
  }

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-cream">
      <div className="flex items-center gap-3 text-ink">
        <div className="w-5 h-5 border-2 border-clay-purple/30 border-t-clay-purple rounded-full animate-spin"></div>
        <span className="font-display font-bold">Signing you in…</span>
      </div>
    </div>
  );
}
