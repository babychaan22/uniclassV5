
const db = globalThis.__B44_DB__;

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/AuthContext";
import { getTeacherClassroom, getClassroomGroups, getClassroomMembers, invalidateClassroomContext } from "@/lib/teacherClassroom";
import { removeRosterMember, setGroupRepresentative, transferStudentRecords } from "@/lib/secureActions";
import { supabase } from "@/api/supabaseClient";

import ClayButton from "@/components/ClayButton";
import ClayCard from "@/components/ClayCard";
import ClayChip from "@/components/ClayChip";
import GroupBadgeMarkers from "@/components/GroupBadgeMarkers";
import NovaMessage from "@/components/NovaMessage";
import UserAvatar from "@/components/visual/UserAvatar";
import { UIAsset } from "@/components/visual/UIAsset";
import { Save, Loader2, UserCog, Trash2, Crown, ArrowRightLeft, Check, Search } from "lucide-react";
import { ROUTES } from '@/lib/routes';
import RepresentativeRosterRequests from '@/components/teacher/RepresentativeRosterRequests';
import ClayConfirmDialog from "@/components/ClayConfirmDialog";
import FloatingNotice from "@/components/FloatingNotice";

export default function Roster() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [classroom, setClassroom] = useState(null);
  const [groups, setGroups] = useState([]);
  const [members, setMembers] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [badges, setBadges] = useState([]);
  const [badgeDefinitions, setBadgeDefinitions] = useState([]);
  const [edit, setEdit] = useState({});
  const [saving, setSaving] = useState(null);
  const [actionError, setActionError] = useState("");
  const [actionNotice, setActionNotice] = useState("");
  const [transferTarget, setTransferTarget] = useState(null);
  const [transferSourceIds, setTransferSourceIds] = useState([]);
  const [transferSearch, setTransferSearch] = useState("");
  const [transferNote, setTransferNote] = useState("");
  const [transferring, setTransferring] = useState(false);
  const [transferSummary, setTransferSummary] = useState("");
  const [transferNotice, setTransferNotice] = useState("");
  const [transferHistory, setTransferHistory] = useState([]);
  const [confirmation, setConfirmation] = useState(null);

  useEffect(() => { load(); }, [user]);

  async function load() {
    if (!user) return;
    const c = await getTeacherClassroom(user.id);
    if (!c) { navigate(ROUTES.TEACHER.ONBOARDING); return; }
    setClassroom(c);
    const [g, m, acc, badgeRows, definitions, transfers] = await Promise.all([
      getClassroomGroups(c.id),
      getClassroomMembers(c.id, { includeTransferred: true }),
      db.entities.GroupAccount.filter({ classroom_id: c.id }),
      db.entities.Badge.filter({ classroom_id: c.id }),
      db.entities.BadgeDefinition.filter({ classroom_id: c.id }),
      supabase.from('student_record_transfers').select('*').eq('classroom_id', c.id).order('created_at', { ascending: false }).limit(12),
    ]);
    setGroups(g.sort((a, b) => a.group_number - b.group_number));
    setMembers(m);
    setAccounts(acc);
    setBadges(badgeRows);
    setBadgeDefinitions(definitions);
    // Transfer history is auxiliary. A missing audit-table permission must not
    // hide the roster rows or the edit/transfer controls themselves.
    setTransferHistory(transfers?.data || []);
  }

  function startEdit(mem) { setEdit({ ...edit, [mem.id]: { last_name: mem.last_name, first_name: mem.first_name, group_id: mem.group_id } }); }
  function cancel(id) { const n = { ...edit }; delete n[id]; setEdit(n); }

  async function save(mem) {
    const v = edit[mem.id];
    setSaving(mem.id);
    await db.entities.GroupMember.update(mem.id, { last_name: v.last_name.toUpperCase(), first_name: v.first_name.toUpperCase(), group_id: v.group_id });
    invalidateClassroomContext();
    setSaving(null);
    cancel(mem.id);
    load();
  }

  async function removeMember(mem) {
    setSaving(mem.id); setActionError(""); setActionNotice("");
    try {
      const result = await removeRosterMember(mem.id);
      if (result?.evidencePaths?.length) {
        const { error } = await supabase.storage.from("activity-evidence").remove(result.evidencePaths);
        if (error) setActionError(`Roster member removed, but evidence-file cleanup needs attention: ${error.message}`);
      }
      invalidateClassroomContext();
      await load();
      setActionNotice(`${mem.last_name}, ${mem.first_name} was removed from this class.`);
    } catch (err) {
      setActionError(err.message || "This roster member could not be removed.");
    } finally { setSaving(null); }
  }

  async function makeRepresentative(account) {
    setSaving(account.group_member_id); setActionError(""); setActionNotice("");
    try {
      await setGroupRepresentative(account.id);
      invalidateClassroomContext();
      await load();
      setActionNotice(`${account.last_name}, ${account.first_name} is now the group representative.`);
    } catch (err) {
      setActionError(err.message || "Representative could not be changed.");
    } finally { setSaving(null); }
  }

  // A student who forgot to pick their name during onboarding ends up with an
  // empty second account while their points, attendance and badges sit on the
  // old one. A teacher can merge several duplicates into the same correct
  // learner without losing the individual audit records.
  async function runTransfer() {
    if (!transferTarget || transferSourceIds.length === 0) return false;
    const to = members.find((m) => m.id === transferTarget.id);
    const sources = members.filter((m) => transferSourceIds.includes(m.id));
    if (!to || sources.length === 0) return false;
    setTransferring(true);
    setActionError("");
    try {
      const totals = await transferStudentRecords(sources.map((source) => source.id), to.id, transferNote.trim() || null);
      invalidateClassroomContext();
      setTransferTarget(null);
      setTransferSourceIds([]);
      setTransferSearch("");
      setTransferNote("");
      setActionError("");
      const summary =
        `Merged ${sources.length} record${sources.length === 1 ? '' : 's'} into ${to.last_name}, ${to.first_name}: `
        + `${totals.moved_logs} point entr${totals.moved_logs === 1 ? 'y' : 'ies'}, `
        + `${totals.moved_attendance} attendance mark${totals.moved_attendance === 1 ? '' : 's'}, `
        + `${totals.moved_badges} badge${totals.moved_badges === 1 ? '' : 's'} and `
        + `${totals.moved_submissions} mission submission${totals.moved_submissions === 1 ? '' : 's'}.`;
      setTransferSummary(summary);
      setTransferNotice(summary);
      window.setTimeout(() => setTransferNotice(""), 8000);
      await load();
      return true;
    } catch (err) {
      setActionError(err.message || "That record could not be moved.");
      return false;
    } finally {
      setTransferring(false);
    }
  }

  if (!classroom) return <div className="flex items-center justify-center py-20"><div className="w-8 h-8 border-4 border-clay-purple border-t-transparent rounded-full animate-spin" /></div>;

  // Any active roster member can receive a transfer, whether they already have
  // a login or are waiting to create one.
  const candidates = transferTarget
    ? members
        .filter((m) => m.id !== transferTarget.id && !m.is_transferred)
        .map((m) => ({ ...m, account: accounts.find((a) => a.group_member_id === m.id) }))
    : [];
  const matchingCandidates = candidates.filter((member) => {
    const query = transferSearch.trim().toLowerCase();
    return !query || `${member.last_name} ${member.first_name}`.toLowerCase().includes(query);
  });
  const selectedSources = candidates.filter((member) => transferSourceIds.includes(member.id));
  const transferTargetName = transferTarget ? `${transferTarget.last_name}, ${transferTarget.first_name}` : "";

  function openTransfer(target) {
    setTransferTarget(target);
    setTransferSourceIds([]);
    setTransferSearch("");
    setTransferNote("");
  }

  function toggleTransferSource(memberId) {
    setTransferSourceIds((current) => current.includes(memberId)
      ? current.filter((id) => id !== memberId)
      : [...current, memberId]);
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5 sm:space-y-6">
      <section className="grid gap-4 lg:grid-cols-[1fr_minmax(280px,.75fr)] lg:items-center">
        <div>
          <p className="text-sm font-semibold text-[var(--uc-purple)]">Class management</p>
          <h1 className="uc-page-title mt-1 text-3xl sm:text-4xl">Student roster</h1>
          <p className="mt-1 text-sm leading-relaxed text-ink/60">Edit names, tidy duplicates, and choose the representative for each group.</p>
        </div>
        <NovaMessage variant="learning" tone="blue" title="A well-kept class helps everyone shine.">Review each group whenever learners join or change roles.</NovaMessage>
      </section>
      {transferSummary && <p className="rounded-xl border-2 border-ink bg-clay-lime/20 p-3 text-sm font-display font-bold text-ink">{transferSummary}</p>}
      {transferNotice && <div role="status" className="fixed bottom-20 right-4 z-[60] max-w-sm rounded-2xl border-2 border-clay-lime bg-white p-4 text-sm font-display font-bold text-ink shadow-[var(--uc-shadow-lg)] sm:bottom-5"><p className="text-clay-lime">Records moved</p><p className="mt-1 text-xs font-medium text-ink/70">{transferNotice}</p></div>}

      <RepresentativeRosterRequests classroomId={classroom.id} members={members} onReviewed={async () => {
        invalidateClassroomContext();
        await load();
      }} />

      {groups.map((g) => {
        const gm = members.filter((m) => m.group_id === g.id && !m.is_transferred);
        if (gm.length === 0) return null;
        return (
          <ClayCard key={g.id} className="p-4 sm:p-5">
            <h2 className="mb-4 flex items-center gap-3 font-display text-lg font-extrabold text-[var(--uc-navy-950)]">
              <UIAsset name="students" className="h-10 w-10" />
              <span className="inline-flex items-center gap-1">Group {g.group_number}{g.group_name ? ` — ${g.group_name}` : ""} <GroupBadgeMarkers groupId={g.id} badges={badges} definitions={badgeDefinitions} /></span> <ClayChip color="cream">{gm.length} members</ClayChip>
            </h2>
            <div className="space-y-2">
              {gm.map((mem) => {
                const v = edit[mem.id];
                const editing = !!v;
                const memberAccount = accounts.find((a) => a.group_member_id === mem.id);
                return (
                  <div key={mem.id} className="flex flex-wrap items-center gap-2 rounded-2xl border border-ink/5 bg-[var(--uc-bg)] p-3">
                    {editing ? (
                      <>
                        <input className="clay-input text-sm w-32" value={v.last_name} onChange={(e) => setEdit({ ...edit, [mem.id]: { ...v, last_name: e.target.value.toUpperCase() } })} placeholder="LAST" />
                        <input className="clay-input text-sm w-32" value={v.first_name} onChange={(e) => setEdit({ ...edit, [mem.id]: { ...v, first_name: e.target.value.toUpperCase() } })} placeholder="FIRST" />
                        <select className="clay-input text-sm w-28" value={v.group_id} onChange={(e) => setEdit({ ...edit, [mem.id]: { ...v, group_id: e.target.value } })}>
                          {groups.map((gg) => <option key={gg.id} value={gg.id}>G{gg.group_number}</option>)}
                        </select>
                        <ClayButton size="sm" color="lime" onClick={() => save(mem)} disabled={saving === mem.id}>
                          {saving === mem.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                        </ClayButton>
                        <ClayButton size="sm" color="cream" onClick={() => cancel(mem.id)}>✕</ClayButton>
                      </>
                    ) : (
                      <>
                        <UserAvatar name={`${mem.last_name}-${mem.first_name}`} size="sm" />
                        <span className="min-w-0 flex-1 font-display text-sm font-bold text-[var(--uc-navy-950)]">{mem.last_name}, {mem.first_name}</span>
                        {memberAccount?.is_representative && <ClayChip color="purple">Rep</ClayChip>}
                        {mem.is_account_holder && <ClayChip color="sky">Account</ClayChip>}
                        <ClayButton size="sm" color="sky" onClick={() => startEdit(mem)}><UserCog className="w-4 h-4" /> Edit</ClayButton>
                        <ClayButton
                          size="sm"
                          color="purple"
                          onClick={() => openTransfer(mem)}
                          title="Choose duplicate records to merge into this student's account"
                        >
                          <ArrowRightLeft className="w-4 h-4" /> Move records here
                        </ClayButton>
                        {memberAccount?.is_approved && !memberAccount.is_representative && <ClayButton size="sm" color="purple" onClick={() => setConfirmation({ type: "representative", account: memberAccount })} disabled={saving === mem.id}><Crown className="w-4 h-4" /> Make rep</ClayButton>}
                        <ClayButton size="sm" color="coral" onClick={() => setConfirmation({ type: "remove", member: mem })} disabled={saving === mem.id} title="Delete this student and their class-only record">
                          {saving === mem.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />} Delete student
                        </ClayButton>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </ClayCard>
        );
      })}

      <ClayCard className="p-4 sm:p-5">
        <div className="mb-3 flex items-center gap-3">
          <ArrowRightLeft className="h-6 w-6 text-clay-purple" />
          <div><h2 className="font-display text-lg font-extrabold text-[var(--uc-navy-950)]">Record transfer history</h2><p className="text-xs text-ink/60">Recent duplicate-record merges are kept as a teacher audit trail.</p></div>
        </div>
        {transferHistory.length === 0 ? <p className="rounded-xl bg-cream px-3 py-2 text-sm text-ink/60">No student records have been transferred in this class.</p> : <div className="space-y-2">
          {transferHistory.map((entry) => <div key={entry.id} className="rounded-xl border border-ink/10 bg-[var(--uc-bg)] p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-display font-bold">Record transfer completed</span><span className="text-xs text-ink/55">{entry.created_at ? new Date(entry.created_at).toLocaleString() : ''}</span></div>
            <p className="mt-1 text-xs text-ink/65">{entry.source_member_name && entry.target_member_name ? `${entry.source_member_name} → ${entry.target_member_name} · ` : ''}{entry.moved_logs || 0} point entries · {entry.moved_attendance || 0} attendance marks · {entry.moved_scores || 0} scores · {entry.moved_submissions || 0} missions moved</p>
            {entry.note && <p className="mt-1 text-xs text-ink/55">Note: {entry.note}</p>}
          </div>)}
        </div>}
      </ClayCard>

      {transferTarget && (
        /* This fixed dialog keeps the destination and selections visible while
           the teacher searches through a long roster. */
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
          <button
            type="button"
            aria-label="Close"
            className="absolute inset-0 cursor-default bg-ink/40"
            onClick={() => setTransferTarget(null)}
          />
          <ClayCard role="dialog" aria-modal="true" aria-labelledby="transfer-dialog-title" className="relative flex w-full max-w-lg max-h-[85vh] flex-col p-0 overflow-hidden">
            <div className="shrink-0 border-b border-ink/10 bg-[var(--uc-bg)] p-5 pb-4">
              <h3 id="transfer-dialog-title" className="font-display font-extrabold text-lg">Move records into</h3>
              <div className="mt-3 flex items-center gap-3 rounded-2xl border-2 border-clay-purple bg-clay-purple/10 p-3">
                <UserAvatar name={`${transferTarget.last_name}-${transferTarget.first_name}`} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="font-display font-extrabold text-sm text-[var(--uc-navy-950)]">{transferTargetName}</p>
                  <p className="text-xs text-ink/65">This is the account that stays active.</p>
                </div>
                <ClayChip color="purple">Destination</ClayChip>
              </div>
              <p className="mt-3 text-xs leading-relaxed text-ink/65">
                Select every duplicate student record below. Each old account is blocked, preserved in the audit trail, and its eligible class records are merged into this student.
              </p>
            </div>

            {candidates.length === 0 ? (
              <p className="m-5 rounded-xl border-2 border-ink/10 bg-cream/50 px-3 py-2 text-xs font-bold text-ink/55">
                There is no other student in this class to move the record onto.
              </p>
            ) : (
              <div className="min-h-0 flex-1 overflow-y-auto p-5 pt-4">
                <div className="sticky top-0 z-10 -mx-1 bg-[var(--uc-bg)] px-1 pb-3">
                  <label htmlFor="transfer-search" className="font-display font-bold text-xs">Select duplicate records</label>
                  <div className="relative mt-1.5">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink/45" />
                    <input id="transfer-search" className="clay-input w-full pl-9 text-sm" value={transferSearch} onChange={(event) => setTransferSearch(event.target.value)} placeholder="Find a student" />
                  </div>
                  <p className="mt-2 text-xs font-semibold text-clay-purple">{selectedSources.length} selected</p>
                </div>
                <div className="space-y-1.5">
                  {matchingCandidates.map((option) => {
                    const g = groups.find((gg) => gg.id === option.group_id);
                    const selected = transferSourceIds.includes(option.id);
                    return (
                      <button
                        key={option.id}
                        type="button"
                        onClick={() => toggleTransferSource(option.id)}
                        aria-pressed={selected}
                        className={`flex w-full items-center justify-between gap-2 rounded-lg border-2 px-3 py-2 text-left text-sm ${
                          selected
                            ? "border-clay-purple bg-clay-purple/10"
                            : "border-ink/10 bg-white hover:border-clay-purple/50"
                        }`}
                      >
                        <span className="flex min-w-0 items-center gap-2"><span className={`grid h-5 w-5 shrink-0 place-items-center rounded-md border-2 ${selected ? "border-clay-purple bg-clay-purple text-white" : "border-ink/25 bg-white"}`}>{selected && <Check className="h-3.5 w-3.5" />}</span><span className="font-display font-bold truncate">{option.last_name}, {option.first_name}</span></span>
                        <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide">
                          {g ? `Group ${g.group_number}` : "Unassigned"}
                          {option.account?.is_approved ? " · active account" : " · no active account"}
                        </span>
                      </button>
                    );
                  })}
                  {matchingCandidates.length === 0 && <p className="rounded-xl bg-cream px-3 py-3 text-sm text-ink/60">No active student matches that name.</p>}
                </div>
              </div>
            )}

            <div className="shrink-0 border-t border-ink/10 bg-[var(--uc-bg)] p-5 pt-3">
              <label htmlFor="transfer-note" className="font-display font-bold text-xs mb-1 block">
                Note
              </label>
              <input
                id="transfer-note"
                className="clay-input text-sm w-full"
                value={transferNote}
                onChange={(e) => setTransferNote(e.target.value)}
                placeholder="Forgot to select own name"
              />
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <ClayButton size="sm" color="purple" onClick={() => setConfirmation({ type: "transfer" })} disabled={transferSourceIds.length === 0 || transferring}>
                  {transferring ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRightLeft className="w-4 h-4" />}
                  {transferSourceIds.length > 0 ? `Move ${transferSourceIds.length} record${transferSourceIds.length === 1 ? '' : 's'}` : "Select records to move"}
                </ClayButton>
                <ClayButton size="sm" color="cream" onClick={() => setTransferTarget(null)}>Cancel</ClayButton>
              </div>
              {selectedSources.length > 0 && <div className="mt-3 flex max-h-16 flex-wrap gap-1 overflow-y-auto" aria-label="Selected source records">{selectedSources.map((member) => <ClayChip key={member.id} color="purple">{member.last_name}, {member.first_name}</ClayChip>)}</div>}
            </div>
          </ClayCard>
        </div>
      )}
      <ClayConfirmDialog
        open={Boolean(confirmation)}
        onOpenChange={(open) => { if (!open) setConfirmation(null); }}
        busy={Boolean(saving) || transferring}
        title={confirmation?.type === "remove" ? "Remove this student?" : confirmation?.type === "representative" ? "Make this student representative?" : "Move selected student records?"}
        description={confirmation?.type === "remove"
          ? `${confirmation.member.last_name}, ${confirmation.member.first_name}'s attendance, scores, evidence, points, badges, submissions, and class-only history will be removed from this classroom. Their sign-in and other classrooms stay intact.`
          : confirmation?.type === "representative"
            ? `Make ${confirmation.account.last_name}, ${confirmation.account.first_name} the representative? The current representative becomes a regular member.`
            : transferTarget && selectedSources.length > 0 ? `Move ${selectedSources.length} student record${selectedSources.length === 1 ? '' : 's'} to ${transferTargetName}. Each old class account will be blocked and kept in the transfer audit.${actionError ? ` ${actionError}` : ""}` : ""}
        confirmLabel={confirmation?.type === "remove" ? "Remove student" : confirmation?.type === "representative" ? "Make representative" : "Move records"}
        onConfirm={async () => {
          const next = confirmation;
          if (next?.type === "transfer") {
            const moved = await runTransfer();
            if (moved) setConfirmation(null);
            return;
          }
          setConfirmation(null);
          if (next?.type === "remove") await removeMember(next.member);
          else if (next?.type === "representative") await makeRepresentative(next.account);
        }}
      />
      <FloatingNotice notice={actionError ? { ok: false, text: actionError } : actionNotice ? { ok: true, text: actionNotice } : null} onDismiss={() => { setActionError(""); setActionNotice(""); }} />
    </div>
  );
}
