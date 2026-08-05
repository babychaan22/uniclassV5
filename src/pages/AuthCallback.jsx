import { useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { supabase } from "@/api/supabaseClient";
import { ROUTES } from "@/lib/routes";

export default function AuthCallback() {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    async function exchangeCode() {
      const { error } = await supabase.auth.exchangeCodeForSession(location.search);

      if (error) {
        console.error("Auth callback error:", error);
        navigate(ROUTES.LOGIN, { replace: true });
      } else {
        navigate(ROUTES.HOME, { replace: true });
      }
    }

    exchangeCode();
  }, [location, navigate]);

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-cream">
      <div className="flex items-center gap-3 text-ink">
        <div className="w-5 h-5 border-2 border-clay-purple/30 border-t-clay-purple rounded-full animate-spin"></div>
        <span className="font-display font-bold">Signing you in…</span>
      </div>
    </div>
  );
}
