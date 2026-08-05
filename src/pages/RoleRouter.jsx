
const db = globalThis.__B44_DB__;

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { useAuth } from "@/lib/AuthContext";
import ClayButton from "@/components/ClayButton";
import ClayCard from "@/components/ClayCard";
import { GraduationCap, Users, Loader2, Sparkles } from "lucide-react";
import { ROUTES } from '@/lib/routes';

export default function RoleRouter() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [hasClassroom, setHasClassroom] = useState(false);
  const [hasAccount, setHasAccount] = useState(false);
  const [approved, setApproved] = useState(false);

  useEffect(() => {
    async function check() {
      if (!user) { setLoading(false); return; }
      try {
        const classrooms = await db.entities.Classroom.filter({ teacher_id: user.id });
        if (classrooms.length > 0) { setHasClassroom(true); setLoading(false); return; }
        const accounts = await db.entities.GroupAccount.filter({ user_id: user.id });
        if (accounts.length > 0) { setHasAccount(true); setApproved(accounts[0].is_approved); }
      } catch (e) { /* ignore */ }
      setLoading(false);
    }
    check();
  }, [user]);

  useEffect(() => {
    if (hasClassroom) navigate(ROUTES.TEACHER.DASHBOARD, { replace: true });
    else if (hasAccount && approved) navigate(ROUTES.STUDENT.DASHBOARD, { replace: true });
    else if (hasAccount && !approved) navigate(ROUTES.WAITING_APPROVAL, { replace: true });
  }, [hasClassroom, hasAccount, approved, navigate]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-cream">
        <Loader2 className="w-8 h-8 animate-spin text-clay-purple" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-cream flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex w-20 h-20 rounded-full bg-clay-pink border-[4px] border-ink shadow-[4px_4px_0_#17162B] items-center justify-center mb-4">
            <Sparkles className="w-10 h-10 text-ink" />
          </div>
          <h1 className="text-3xl font-display font-extrabold">UniClass</h1>
          <p className="text-ink/70 mt-2 font-body">Gamified classroom tracker with QR rewards & gacha capsules</p>
        </div>
        <ClayCard className="p-6">
          <p className="font-display font-bold text-lg mb-4 text-center">Choose your role to get started</p>
          <div className="flex flex-col gap-4">
            <ClayButton color="purple" size="lg" onClick={() => navigate(ROUTES.TEACHER.ONBOARDING)}>
              <GraduationCap className="w-6 h-6" />
              I'm a Teacher
            </ClayButton>
            <ClayButton color="sky" size="lg" onClick={() => navigate(ROUTES.STUDENT.ONBOARDING)}>
              <Users className="w-6 h-6" />
              I'm a Student
            </ClayButton>
          </div>
        </ClayCard>
      </div>
    </div>
  );
}

