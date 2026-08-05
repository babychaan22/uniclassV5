import React, { createContext, useState, useContext, useEffect } from 'react';
import { supabase } from '@/api/supabaseClient';

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  // Keep this flag for App.jsx compatibility — set to false immediately
  // since Supabase has no equivalent "app public settings" check.
  const [isLoadingPublicSettings] = useState(false);
  const [authError, setAuthError] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);

  useEffect(() => {
    // Hydrate from the existing session on mount
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        const u = normalizeUser(session.user);
        setUser(u);
        setIsAuthenticated(true);
      }
      setIsLoadingAuth(false);
      setAuthChecked(true);
    });

    // Subscribe to auth state changes (login, logout, token refresh)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        if (session?.user) {
          const u = normalizeUser(session.user);
          setUser(u);
          setIsAuthenticated(true);
          setAuthError(null);
        } else {
          setUser(null);
          setIsAuthenticated(false);
        }
        setIsLoadingAuth(false);
        setAuthChecked(true);
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  /** Re-check the current session (called by App.jsx's checkUserAuth). */
  const checkUserAuth = async () => {
    setIsLoadingAuth(true);
    try {
      const { data: { user: u }, error } = await supabase.auth.getUser();
      if (error || !u) throw error ?? new Error('Not authenticated');
      setUser(normalizeUser(u));
      setIsAuthenticated(true);
      setAuthError(null);
    } catch {
      setUser(null);
      setIsAuthenticated(false);
      setAuthError({ type: 'auth_required', message: 'Authentication required' });
    } finally {
      setIsLoadingAuth(false);
      setAuthChecked(true);
    }
  };

  /** Sign out. Optionally redirects after signing out. */
  const logout = async (shouldRedirect = true) => {
    await supabase.auth.signOut();
    setUser(null);
    setIsAuthenticated(false);
    if (shouldRedirect) {
      window.location.href = '/login';
    }
  };

  /** Navigate to the login page. */
  const navigateToLogin = () => {
    window.location.href = '/login';
  };

  /** No-op — kept for App.jsx backward compatibility. */
  const checkAppState = async () => {
    await checkUserAuth();
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated,
        isLoadingAuth,
        isLoadingPublicSettings,
        authError,
        appPublicSettings: null,
        authChecked,
        logout,
        navigateToLogin,
        checkUserAuth,
        checkAppState,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

// -------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------

/**
 * Normalise a Supabase auth user into the shape the rest of the app
 * expects: { id, email, role, ...user_metadata }.
 */
function normalizeUser(supabaseUser) {
  return {
    id: supabaseUser.id,
    email: supabaseUser.email,
    role: supabaseUser.user_metadata?.role ?? 'user',
    ...supabaseUser.user_metadata,
  };
}
