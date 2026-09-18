
const db = globalThis.__B44_DB__;

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/AuthContext";
import { getTeacherClassroom, getClassroomDataset, invalidateClassroomDataset } from "@/lib/teacherClassroom";
import { removeStudentFromClass } from "@/lib/secureActions";
import { supabase } from "@/api/supabaseClient";

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
  const [approved, setApproved] = useState([]);
  const [groups, setGroups] = useState([]);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");

  useEffect(() => { load(); }, [user]);

  async function load() {
    if (!user) return;
    const c = await getTeacherClassroom(user.id);
    if (!c) { navigate(ROUTES.TEACHER.ONBOARDING); return; }
    setClassroom(c);
    const ds = await getClassroomDataset(c.id, ['groups','groupAccounts']);
    const accounts = ds.groupAccounts;
    setGroups(ds.groups);
    setPending(accounts.filter((a) => !a.is_approved));
    const approvedAccounts = accounts.filter((a) => a.is_approved);
    setApproved(approvedAccounts);
    setApprovedCount(approvedAccounts.length);
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

  async function removeStudent(account) {
    if (!window.confirm(`Remove ${account.last_name}, ${account.first_name} from this class? Their roster record, class scores, attendance, evidence, and personal activity history will be deleted. Their login and other class memberships stay intact.`)) return;
    setBusy(true);
    setActionError("");
    try {
      const result = await removeStudentFromClass(account.id);
      if (result?.evidencePaths?.length) {
        const { error: storageError } = await supabase.storage.from("activity-evidence").remove(result.evidencePaths);
        if (storageError) setActionError(`Student removed, but evidence-file cleanup needs attention: ${storageError.message}`);
      }
      invalidateClassroomDataset();
      await load();
    } catch (err) {
      setActionError(err.message || "Student could not be removed. No changes were saved.");
    } finally { setBusy(false); }
  }

  if (loading) return <div className="flex items-center justify-center py-20"><div className="w-8 h-8 border-4 border-clay-purple border-t-transparent rounded-full animate-spin" /></div>;

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      <div>
        <h1 className="text-2xl font-display font-extrabold mb-1 flex items-center gap-2"><UserCheck className="w-6 h-6" /> Account Management</h1>
        <p className="text-ink/60 text-sm">Review and assign pending students to their groups.</p>
        {actionError && <p className="mt-2 rounded-xl border-2 border-ink bg-clay-coral/20 p-3 text-sm font-display font-bold text-clay-coral">{actionError}</p>}
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
                <p className="text-xs text-ink/60 font-mono">Group {gnum(a)} · Role: {a.is_representative ? "Representative" : "Member"}{a.email ? ` · ${a.email}` : ""}</p>
              </div>
              <div className="flex gap-2">
                <ClayButton size="sm" color="lime" onClick={() => approve(a)}><Check className="w-4 h-4" /> Approve</ClayButton>
                <ClayButton size="sm" color="coral" onClick={() => reject(a)}><X className="w-4 h-4" /> Reject</ClayButton>
              </div>
            </ClayCard>
          ))}
        </div>
      )}

      {approved.length > 0 && (
        <ClayCard className="p-5">
          <h2 className="font-display font-bold text-base mb-3">Approved students</h2>
          <div className="space-y-2">
            {approved.map((a) => (
              <div key={a.id} className="flex items-center justify-between gap-3 rounded-xl border-2 border-ink/15 bg-cream p-3">
                <div>
                  <p className="font-display font-bold">{a.last_name}, {a.first_name}</p>
                  <p className="text-xs text-ink/60 font-mono">Group {gnum(a)} · {a.is_representative ? "Representative" : "Member"}{a.email ? ` · ${a.email}` : ""}</p>
                </div>
                <ClayButton size="sm" color="coral" onClick={() => removeStudent(a)} disabled={busy}><X className="w-4 h-4" /> Remove</ClayButton>
              </div>
            ))}
          </div>
        </ClayCard>
      )}
    </div>
  );
}
