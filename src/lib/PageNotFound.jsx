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

          {isFetched && authData?.isAuthenticated && authData.user?.role === 'admin' && (
            <div className="mt-8 p-4 bg-cream rounded-lg border-2 border-ink/15">
              <div className="flex items-start space-x-3">
                <div className="flex-shrink-0 w-5 h-5 rounded-full bg-clay-sun/30 flex items-center justify-center mt-0.5">
                  <div className="w-2 h-2 rounded-full bg-clay-sun"></div>
                </div>
                <div className="text-left space-y-1">
                  <p className="text-sm font-display font-bold text-ink/80">Admin Note</p>
                  <p className="text-sm text-ink/60 leading-relaxed">
                    This page has not been implemented yet.
                  </p>
                </div>
              </div>
            </div>
          )}

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
