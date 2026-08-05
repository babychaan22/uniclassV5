
const db = globalThis.__B44_DB__;

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/AuthContext";
import { getTeacherClassroom, getClassroomDataset, invalidateClassroomDataset } from "@/lib/teacherClassroom";

import ClayButton from "@/components/ClayButton";
import ClayCard from "@/components/ClayCard";
import ClayChip from "@/components/ClayChip";
import { UserCheck, Check, X, Loader2, Users } from "lucide-react";
import { ROUTES } from '@/lib/routes';

export default function TeacherStudentManagement() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [classroom, setClassroom] = useState(null);
  const [pending, setPending] = useState([]);
  const [approvedCount, setApprovedCount] = useState(0);
  const [groups, setGroups] = useState([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => { load(); }, [user]);

  async function load() {
    if (!user) return;
    const c = await getTeacherClassroom(user.id);
    if (!c) { navigate(ROUTES.TEACHER.ONBOARDING); return; }
    setClassroom(c);
    const ds = await getClassroomDataset(c.id);
    const accounts = ds.groupAccounts;
    setGroups(ds.groups);
    setPending(accounts.filter((a) => !a.is_approved));
    setApprovedCount(accounts.filter((a) => a.is_approved).length);
    setLoading(false);
  }

  function gnum(a) { return groups.find((g) => g.id === a.group_id)?.group_number ?? "—"; }

  async function approve(a) {
    await db.entities.GroupAccount.update(a.id, { is_approved: true });
    invalidateClassroomDataset();
    load();
  }
  async function reject(a) {
    await db.entities.GroupAccount.delete(a.id);
    invalidateClassroomDataset();
    load();
  }
  async function bulkApprove() {
    setBusy(true);
    await db.entities.GroupAccount.bulkUpdate(
      pending.map((a) => ({ id: a.id, is_approved: true }))
    );
    setBusy(false);
    invalidateClassroomDataset();
    load();
  }

  if (loading) return <div className="flex items-center justify-center py-20"><div className="w-8 h-8 border-4 border-clay-purple border-t-transparent rounded-full animate-spin" /></div>;

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      <div>
        <h1 className="text-2xl font-display font-extrabold mb-1 flex items-center gap-2"><UserCheck className="w-6 h-6" /> Account Management</h1>
        <p className="text-ink/60 text-sm">Review and assign pending students to their groups.</p>
      </div>

      <div className="flex gap-3">
        <ClayChip color="sun">{pending.length} pending</ClayChip>
        <ClayChip color="lime">{approvedCount} approved</ClayChip>
        {pending.length > 0 && (
          <ClayButton size="sm" color="lime" onClick={bulkApprove} disabled={busy} className="ml-auto">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Check className="w-4 h-4" /> Approve All</>}
          </ClayButton>
        )}
      </div>

      {pending.length === 0 ? (
        <ClayCard className="p-6 text-center">
          <Users className="w-8 h-8 mx-auto text-ink/30 mb-2" />
          <p className="text-ink/50 text-sm">No pending requests. All students are assigned.</p>
        </ClayCard>
      ) : (
        <div className="space-y-3">
          {pending.map((a) => (
            <ClayCard key={a.id} className="p-4 flex items-center justify-between gap-3">
              <div>
                <p className="font-display font-bold flex items-center gap-2">
                  {a.last_name}, {a.first_name}
                  {a.is_representative && <ClayChip color="purple">Rep</ClayChip>}
                </p>
                <p className="text-xs text-ink/60 font-mono">Group {gnum(a)}{a.email ? ` · ${a.email}` : ""}</p>
              </div>
              <div className="flex gap-2">
                <ClayButton size="sm" color="lime" onClick={() => approve(a)}><Check className="w-4 h-4" /> Approve</ClayButton>
                <ClayButton size="sm" color="coral" onClick={() => reject(a)}><X className="w-4 h-4" /> Reject</ClayButton>
              </div>
            </ClayCard>
          ))}
        </div>
      )}
    </div>
  );
}

