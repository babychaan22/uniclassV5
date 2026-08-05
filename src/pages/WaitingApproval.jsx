
const db = globalThis.__B44_DB__;

import { useAuth } from "@/lib/AuthContext";

import ClayCard from "@/components/ClayCard";
import { ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useEffect, useState, useRef } from "react";
import { ROUTES } from '@/lib/routes';
import { toast } from "@/components/ui/use-toast";
import MascotWidget from "@/components/MascotWidget";

export default function WaitingApproval() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [account, setAccount] = useState(null);
  const notifiedRef = useRef(false);
  const [mascotCheer, setMascotCheer] = useState(false);

  useEffect(() => {
    async function load() {
      if (!user) return;
      const accounts = await db.entities.GroupAccount.filter({ user_id: user.id });
      setAccount(accounts[0]);
    }
    load();
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
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
        <p className="text-ink/70 font-body">Your teacher needs to approve your group before you can start. Nova is keeping time and this page checks automatically every 5 seconds.</p>
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
