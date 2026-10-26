
const db = globalThis.__B44_DB__;

import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/AuthContext";
import { getTeacherClassroom, getClassroomDataset, invalidateClassroomDataset } from "@/lib/teacherClassroom";
import { removeStudentFromClass } from "@/lib/secureActions";
import { invalidateReadCache, supabase } from "@/api/supabaseClient";

import ClayButton from "@/components/ClayButton";
import ClayCard from "@/components/ClayCard";
import ClayChip from "@/components/ClayChip";
import NovaMessage from "@/components/NovaMessage";
import UserAvatar from "@/components/visual/UserAvatar";
import { UIAsset } from "@/components/visual/UIAsset";
import { Check, Trash2, Loader2 } from "lucide-react";
import { ROUTES } from '@/lib/routes';
import ClayConfirmDialog from "@/components/ClayConfirmDialog";

export default function TeacherStudentManagement() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState([]);
  const [approvedCount, setApprovedCount] = useState(0);
  const [approved, setApproved] = useState([]);
  const [groups, setGroups] = useState([]);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [removeTarget, setRemoveTarget] = useState(null);
  const [pendingDeleteTarget, setPendingDeleteTarget] = useState(null);
  const loadSequence = useRef(0);

  useEffect(() => {
    void load();
    const refresh = () => { invalidateClassroomDataset(); invalidateReadCache('group_accounts'); void load(); };
    window.addEventListener('uniclass-teacher-class-changed', refresh);
    window.addEventListener('focus', refresh);
    window.addEventListener('uniclass-connection-restored', refresh);
    const unsubscribe = db.entities.GroupAccount.subscribe(refresh);
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, 15000);
    return () => { loadSequence.current += 1; window.removeEventListener('uniclass-teacher-class-changed', refresh); window.removeEventListener('focus', refresh); window.removeEventListener('uniclass-connection-restored', refresh); window.clearInterval(timer); unsubscribe(); };
  }, [user]);

  async function load() {
    if (!user) return;
    const sequence = ++loadSequence.current;
    try {
    const c = await getTeacherClassroom(user.id);
    if (!c) { if (sequence === loadSequence.current) navigate(ROUTES.TEACHER.ONBOARDING); return; }
    const ds = await getClassroomDataset(c.id, ['groups','groupAccounts']);
    if (sequence !== loadSequence.current) return;
    const accounts = ds.groupAccounts;
    setGroups(ds.groups);
    setPending(accounts.filter((a) => !a.is_approved && !a.transferred_at));
    const approvedAccounts = accounts.filter((a) => a.is_approved);
    setApproved(approvedAccounts);
    setApprovedCount(approvedAccounts.length);
    } catch (err) {
      if (sequence === loadSequence.current) setActionError(err?.message || 'Student requests could not load. Please try again.');
    } finally { if (sequence === loadSequence.current) setLoading(false); }
  }

  function gnum(a) { return groups.find((g) => g.id === a.group_id)?.group_number ?? "—"; }

  async function approve(a) {
    setBusy(true); setActionError('');
    try { await db.entities.GroupAccount.update(a.id, { is_approved: true }); invalidateClassroomDataset(); await load(); }
    catch (err) { setActionError(err?.message || 'The student could not be approved. Please try again.'); }
    finally { setBusy(false); }
  }
  async function deletePendingRequest(a) {
    await removeStudent(a);
  }
  async function bulkApprove() {
    setBusy(true); setActionError('');
    try { await db.entities.GroupAccount.bulkUpdate(pending.map((a) => ({ id: a.id, is_approved: true }))); }
    catch (err) { setActionError(err?.message || 'Some requests could not be approved. Review the list and try again.'); }
    finally { invalidateReadCache('group_accounts'); invalidateClassroomDataset(); await load(); setBusy(false); }
  }

  async function removeStudent(account) {
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
    <div className="mx-auto max-w-6xl space-y-5 sm:space-y-6">
      <section className="grid gap-4 lg:grid-cols-[1fr_minmax(300px,.72fr)] lg:items-center">
        <div>
          <p className="text-sm font-semibold text-[var(--uc-purple)]">Class accounts</p>
          <h1 className="uc-page-title mt-1 text-3xl sm:text-4xl">Student management</h1>
          <p className="mt-1 text-sm leading-relaxed text-ink/60">Approve learners, check their group role, or remove a student’s class data when needed.</p>
        </div>
        <NovaMessage variant="welcome" tone="blue" title="Every learner deserves a clear start.">Review requests before they become active in your classroom.</NovaMessage>
      </section>
      <div>
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
          <UIAsset name="profile" className="mx-auto mb-2 h-14 w-14" />
          <p className="text-ink/50 text-sm">No pending requests. All students are assigned.</p>
        </ClayCard>
      ) : (
        <div className="space-y-3">
          {pending.map((a) => (
            <ClayCard key={a.id} className="p-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3"><UserAvatar name={a.email || `${a.last_name}-${a.first_name}`} size="sm" /><div>
                <p className="font-display font-bold flex items-center gap-2">
                  {a.last_name}, {a.first_name}
                  {a.is_representative && <ClayChip color="purple">Rep</ClayChip>}
                </p>
                <p className="text-xs text-ink/60 font-mono">Group {gnum(a)} · Role: {a.is_representative ? "Representative" : "Member"}{a.email ? ` · ${a.email}` : ""}</p>
              </div></div>
              <div className="flex flex-wrap gap-2">
                <ClayButton size="sm" color="lime" onClick={() => approve(a)} disabled={busy}><Check className="w-4 h-4" /> Approve</ClayButton>
                <ClayButton size="sm" color="coral" onClick={() => setPendingDeleteTarget(a)} disabled={busy}><Trash2 className="w-4 h-4" /> Delete</ClayButton>
              </div>
            </ClayCard>
          ))}
        </div>
      )}

      {approved.length > 0 && (
        <ClayCard className="p-5">
          <div className="mb-3 flex items-center gap-3"><UIAsset name="students" className="h-10 w-10" /><h2 className="font-display text-xl font-extrabold text-[var(--uc-navy-950)]">Approved students</h2></div>
          <div className="space-y-2">
            {approved.map((a) => (
              <div key={a.id} className="flex items-center justify-between gap-3 rounded-xl border-2 border-ink/15 bg-cream p-3">
                <div className="flex min-w-0 items-center gap-3"><UserAvatar name={a.email || `${a.last_name}-${a.first_name}`} size="sm" /><div>
                  <p className="font-display font-bold">{a.last_name}, {a.first_name}</p>
                  <p className="text-xs text-ink/60 font-mono">Group {gnum(a)} · {a.is_representative ? "Representative" : "Member"}{a.email ? ` · ${a.email}` : ""}</p>
                </div></div>
                <ClayButton size="sm" color="coral" onClick={() => setRemoveTarget(a)} disabled={busy}><X className="w-4 h-4" /> Remove</ClayButton>
              </div>
            ))}
          </div>
        </ClayCard>
      )}
      <ClayConfirmDialog
        open={Boolean(removeTarget)}
        onOpenChange={(open) => { if (!open) setRemoveTarget(null); }}
        busy={busy}
        title="Remove this student?"
        description={removeTarget ? `${removeTarget.last_name}, ${removeTarget.first_name}'s roster record, scores, attendance, evidence, and class activity history will be removed. Their login and other classrooms stay intact.` : ""}
        confirmLabel="Remove student"
        onConfirm={async () => { const target = removeTarget; setRemoveTarget(null); if (target) await removeStudent(target); }}
      />
      <ClayConfirmDialog
        open={Boolean(pendingDeleteTarget)}
        onOpenChange={(open) => { if (!open) setPendingDeleteTarget(null); }}
        busy={busy}
        title="Delete this join request?"
        description={pendingDeleteTarget ? `Remove ${pendingDeleteTarget.last_name}, ${pendingDeleteTarget.first_name}'s pending class request and any empty class record created with it. Their sign-in account is not deleted, and they can submit a new request later.` : ""}
        confirmLabel="Delete request"
        onConfirm={async () => { const target = pendingDeleteTarget; setPendingDeleteTarget(null); if (target) await deletePendingRequest(target); }}
      />
    </div>
  );
}
