
const db = globalThis.__B44_DB__;

import { useAuth } from "@/lib/AuthContext";

import ClayCard from "@/components/ClayCard";
import { ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useEffect, useState, useRef } from "react";
import { ROUTES } from '@/lib/routes';
import { toast } from "@/components/ui/use-toast";
import MascotWidget from "@/components/MascotWidget";
import { supabase } from "@/api/supabaseClient";

export default function WaitingApproval() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [account, setAccount] = useState(null);
  const notifiedRef = useRef(false);
  const [mascotCheer, setMascotCheer] = useState(false);

  useEffect(() => {
    let active = true;
    async function load() {
      if (!user) return;
      const accounts = await db.entities.GroupAccount.filter({ user_id: user.id });
      if (active) setAccount(accounts[0] || null);
    }
    void load();

    // Approval normally arrives instantly through Realtime. Keep an infrequent
    // fallback check for disconnected devices rather than polling every five
    // seconds while a student waits.
    const channel = supabase
      .channel(`waiting-approval-${user.id}`)
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'group_accounts', filter: `user_id=eq.${user.id}`,
      }, (payload) => {
        if (active) setAccount(payload.new);
      })
      .subscribe();
    const fallback = window.setInterval(() => { void load(); }, 60_000);
    return () => {
      active = false;
      window.clearInterval(fallback);
      supabase.removeChannel(channel);
    };
  }, [user]);

  useEffect(() => {
    if (account?.is_approved) {
      if (!notifiedRef.current) {
        notifiedRef.current = true;
        toast({ title: "You’re approved!", description: "Your teacher approved your account. Welcome to UniClass!" });
        setTimeout(() => navigate(ROUTES.STUDENT.DASHBOARD, { replace: true }), 900);
      }
    }
  }, [account, navigate]);

  return (
    <div className="min-h-screen bg-cream flex items-center justify-center p-4">
      <ClayCard className="p-8 max-w-md w-full text-center">
        <div className="mb-5"><MascotWidget state={mascotCheer ? "excited" : "waiting"} size="lg" interactive onClick={() => { setMascotCheer(true); setTimeout(() => setMascotCheer(false), 1000); }} /></div>
        <h1 className="text-2xl font-display font-extrabold mb-2">Waiting for approval</h1>
        <p className="text-ink/70 font-body mb-1">Hi {account?.first_name || "there"}! Your account has been registered.</p>
        <p className="text-ink/70 font-body">Your teacher needs to approve your group before you can start. This page updates automatically when they do.</p>
        <p className="text-xs text-ink/50 mt-3">Tap Nova for a little encouragement.</p>
        <div className="mt-6">
          <button onClick={() => logout(true)} className="clay-btn bg-clay-coral text-white px-5 py-2.5 text-sm">
            <ArrowLeft className="w-4 h-4" /> Log out
          </button>
        </div>
      </ClayCard>
    </div>
  );
}
