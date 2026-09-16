import { useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { db } from '@/api/supabaseClient';

export default function PageNotFound() {
  const location = useLocation();
  const pageName = location.pathname.substring(1);

  const { data: authData, isFetched } = useQuery({
    queryKey: ['user'],
    queryFn: async () => {
      try {
        const user = await db.auth.me();
        return { user, isAuthenticated: true };
      } catch {
        return { user: null, isAuthenticated: false };
      }
    }
  });

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-cream">
      <div className="max-w-md w-full">
        <div className="text-center space-y-6">
          <div className="space-y-2">
            <h1 className="text-7xl font-display font-extrabold text-ink/20">404</h1>
            <div className="h-0.5 w-16 bg-ink/20 mx-auto"></div>
          </div>

          <div className="space-y-3">
            <h2 className="text-2xl font-display font-extrabold text-ink">
              Page Not Found
            </h2>
            <p className="text-ink/60 leading-relaxed">
              The page <span className="font-medium text-ink/80">"{pageName}"</span> could not be found in this application.
            </p>
          </div>

          <div className="pt-6">
            <button
              onClick={() => window.location.href = '/'}
              className="clay-btn bg-clay-purple text-white px-5 py-2.5 text-sm font-medium"
            >
              Go Home
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
