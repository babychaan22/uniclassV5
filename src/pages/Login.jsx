import React, { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { supabase } from "@/api/supabaseClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LogIn, Mail, Lock, Loader2, Eye, EyeOff } from "lucide-react";
import AuthLayout from "@/components/AuthLayout";
import GoogleSignInButton from "@/components/GoogleSignInButton";

// Teachers and students hit these on flaky school Wi-Fi or after mistyping a
// password several times. Map Supabase's technical messages to plain language
// with the next step — no "check console for details" for a phone user.
export function friendlyLoginError(err) {
  const raw = String(err?.message || err || '');
  const lower = raw.toLowerCase();
  if (lower.includes('not confirmed') || lower.includes('confirm your email')) {
    return 'Please confirm your email first. Check your inbox (and spam folder) for the confirmation link.';
  }
  if (lower.includes('invalid login credentials')) {
    return 'Email or password is incorrect. Check the email you enrolled with, or ask your teacher to reset it.';
  }
  if (lower.includes('rate limit') || lower.includes('too many request') || err?.status === 429 || err?.code === 429) {
    return 'Too many attempts. Please wait a minute before trying again.';
  }
  if (lower.includes('failed to fetch') || lower.includes('fetch failed') || lower.includes('network')) {
    return 'No internet connection. Check your Wi-Fi or data, then try again.';
  }
  if (lower.includes('expired')) {
    return 'That link or session has expired. Request a new one.';
  }
  if (lower.includes('password login disabled') || lower.includes('signups not allowed')) {
    return 'This sign-in method is turned off for this class. Ask your teacher how to join.';
  }
  return raw || 'Could not log in. Please try again.';
}

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [searchParams] = useSearchParams();
  const returnUrl = searchParams.get("returnUrl");

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
      if (authError) throw authError;
      const safeReturn = returnUrl && returnUrl.startsWith("/") ? returnUrl : "/";
      window.location.href = safeReturn;
    } catch (err) {
      setError(friendlyLoginError(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout
      icon={LogIn}
      title="Welcome back"
      subtitle="Log in to your account"
      footer={
        <>
          Don't have an account?{" "}
          <Link to="/register" className="text-primary font-medium hover:underline">
            Create one
          </Link>
        </>
      }
    >
      {error && (
        <div className="mb-4 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
          {error}
        </div>
      )}

      <GoogleSignInButton onError={setError} disabled={loading} />
      <div className="my-5 flex items-center gap-3 text-xs text-ink/45" aria-hidden="true"><span className="h-px flex-1 bg-ink/10" />or use your email<span className="h-px flex-1 bg-ink/10" /></div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <div className="relative">
            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
            <Input
              id="email"
              type="email"
              autoComplete="email"
              autoFocus
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="pl-10 h-12"
              required
            />
          </div>
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="password">Password</Label>
            <Link to="/forgot-password" className="text-xs text-primary hover:underline">
              Forgot password?
            </Link>
          </div>
           <div className="relative">
             <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
             <Input
               id="password"
               type={showPassword ? "text" : "password"}
               autoComplete="current-password"
               placeholder="••••••••"
               value={password}
               onChange={(e) => setPassword(e.target.value)}
               className="pl-10 pr-10 h-12"
               required
             />
             <button
               type="button"
               tabIndex={-1}
               className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground hover:text-foreground cursor-pointer"
               onClick={() => setShowPassword(!showPassword)}
               aria-label={showPassword ? "Hide password" : "Show password"}
             >
               {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
             </button>
           </div>
        </div>
        <Button type="submit" className="w-full h-12 font-medium" disabled={loading}>
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Logging in...
            </>
          ) : (
            "Log in"
          )}
        </Button>
      </form>
    </AuthLayout>
  );
}
