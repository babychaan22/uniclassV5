
const db = globalThis.__B44_DB__;

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/AuthContext";
import { getTeacherClassroom, getClassroomGroups, getClassroomMembers, invalidateClassroomContext } from "@/lib/teacherClassroom";
import { removeRosterMember, setGroupRepresentative, transferStudentRecord } from "@/lib/secureActions";
import { supabase } from "@/api/supabaseClient";

import ClayButton from "@/components/ClayButton";
import ClayCard from "@/components/ClayCard";
import ClayChip from "@/components/ClayChip";
import GroupBadgeMarkers from "@/components/GroupBadgeMarkers";
import NovaMessage from "@/components/NovaMessage";
import UserAvatar from "@/components/visual/UserAvatar";
import { UIAsset } from "@/components/visual/UIAsset";
import { Save, Loader2, UserCog, Trash2, Crown, ArrowRightLeft } from "lucide-react";
import { ROUTES } from '@/lib/routes';
import RepresentativeRosterRequests from '@/components/teacher/RepresentativeRosterRequests';

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
  const [transfer, setTransfer] = useState(null);
  const [transferTo, setTransferTo] = useState("");
  const [transferNote, setTransferNote] = useState("");
  const [transferring, setTransferring] = useState(false);
  const [transferSummary, setTransferSummary] = useState("");
  const [transferHistory, setTransferHistory] = useState([]);

  useEffect(() => { load(); }, [user]);

  async function load() {
    if (!user) return;
    const c = await getTeacherClassroom(user.id);
    if (!c) { navigate(ROUTES.TEACHER.ONBOARDING); return; }
    setClassroom(c);
    const [g, m, acc, badgeRows, definitions, transfers] = await Promise.all([
      getClassroomGroups(c.id),
      getClassroomMembers(c.id),
      db.entities.GroupAccount.filter({ classroom_id: c.id }),
      db.entities.Badge.filter({ classroom_id: c.id }),
      db.entities.BadgeDefinition.filter({ classroom_id: c.id }),
      db.entities.StudentRecordTransfer.filter({ classroom_id: c.id }, { orderBy: 'created_at', ascending: false, limit: 12 }),
    ]);
    setGroups(g.sort((a, b) => a.group_number - b.group_number));
    setMembers(m);
    setAccounts(acc);
    setBadges(badgeRows);
    setBadgeDefinitions(definitions);
    setTransferHistory(transfers || []);
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
    if (!window.confirm(`Remove ${mem.last_name}, ${mem.first_name} from this roster? Their class data and activity proof will be removed.`)) return;
    setSaving(mem.id); setActionError("");
    try {
      const result = await removeRosterMember(mem.id);
      if (result?.evidencePaths?.length) {
        const { error } = await supabase.storage.from("activity-evidence").remove(result.evidencePaths);
        if (error) setActionError(`Roster member removed, but evidence-file cleanup needs attention: ${error.message}`);
      }
      invalidateClassroomContext();
      await load();
    } catch (err) {
      setActionError(err.message || "This roster member could not be removed.");
    } finally { setSaving(null); }
  }

  async function makeRepresentative(account) {
    if (!window.confirm(`Make ${account.last_name}, ${account.first_name} this group's representative? The current representative will become a regular member.`)) return;
    setSaving(account.group_member_id); setActionError("");
    try {
      await setGroupRepresentative(account.id);
      invalidateClassroomContext();
      await load();
    } catch (err) {
      setActionError(err.message || "Representative could not be changed.");
    } finally { setSaving(null); }
  }

  // A student who forgot to pick their name during onboarding ends up with an
  // empty second account while their points, attendance and badges sit on the
  // old one. This puts the record where it belongs and removes the duplicate.
  async function runTransfer() {
    if (!transferTo) return;
    const from = members.find((m) => m.id === transfer.id);
    const to = members.find((m) => m.id === transferTo);
    if (!from || !to) return;
    const ok = window.confirm(
      `Move the record of ${from.last_name}, ${from.first_name} onto ${to.last_name}, ${to.first_name}?\n\n`
      + `Points, attendance, activity scores, badges, missions and rewards move across. `
      + `${from.last_name}, ${from.first_name} is then removed from the roster. This cannot be undone.`,
    );
    if (!ok) return;

    setTransferring(true);
    setActionError("");
    try {
      const result = await transferStudentRecord(transfer.id, transferTo, transferNote.trim() || null);
      invalidateClassroomContext();
      setTransfer(null);
      setTransferTo("");
      setTransferNote("");
      setActionError("");
      setTransferSummary(
        `Moved ${result.moved_logs} points entr${result.moved_logs === 1 ? 'y' : 'ies'}, `
        + `${result.moved_attendance} attendance mark${result.moved_attendance === 1 ? '' : 's'}, `
        + `${result.moved_badges} badge${result.moved_badges === 1 ? '' : 's'} and `
        + `${result.moved_submissions} mission submission${result.moved_submissions === 1 ? '' : 's'} `
        + `onto ${to.last_name}, ${to.first_name}.`,
      );
      await load();
    } catch (err) {
      setActionError(err.message || "That record could not be moved.");
    } finally {
      setTransferring(false);
    }
  }

  if (!classroom) return <div className="flex items-center justify-center py-20"><div className="w-8 h-8 border-4 border-clay-purple border-t-transparent rounded-full animate-spin" /></div>;

  // Everyone the record could move onto. A student who is already signed in
  // cannot be a target: the database refuses that merge, so they are listed but
  // disabled rather than failing after the teacher has committed to it.
  const candidates = transfer
    ? members
        .filter((m) => m.id !== transfer.id)
        .map((m) => ({ ...m, account: accounts.find((a) => a.group_member_id === m.id) }))
    : [];

  const chosen = candidates.find((m) => m.id === transferTo);
  const selectedName = chosen ? `${chosen.last_name}, ${chosen.first_name}` : "";

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
      <div>
        {actionError && <p className="mt-2 rounded-xl border-2 border-ink bg-clay-coral/20 p-3 text-sm font-display font-bold text-clay-coral">{actionError}</p>}
      </div>
      {transferSummary && <p className="rounded-xl border-2 border-ink bg-clay-lime/20 p-3 text-sm font-display font-bold text-ink">{transferSummary}</p>}

      <RepresentativeRosterRequests classroomId={classroom.id} members={members} onReviewed={async () => {
        invalidateClassroomContext();
        await load();
      }} />

      {groups.map((g) => {
        const gm = members.filter((m) => m.group_id === g.id);
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
                          onClick={() => { setTransfer(transfer?.id === mem.id ? null : mem); setTransferTo(""); setTransferNote(""); }}
                          title="This is a duplicate account: move its points, attendance and badges onto the right student"
                        >
                          <ArrowRightLeft className="w-4 h-4" /> Move record
                        </ClayButton>
                        {memberAccount?.is_approved && !memberAccount.is_representative && <ClayButton size="sm" color="purple" onClick={() => makeRepresentative(memberAccount)} disabled={saving === mem.id}><Crown className="w-4 h-4" /> Make rep</ClayButton>}
                        <ClayButton size="sm" color="coral" onClick={() => removeMember(mem)} disabled={saving === mem.id} title="Delete this student and their class-only record">
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
            <p className="mt-1 text-xs text-ink/65">{entry.moved_logs || 0} point entries · {entry.moved_attendance || 0} attendance marks · {entry.moved_scores || 0} scores · {entry.moved_submissions || 0} missions moved</p>
            {entry.note && <p className="mt-1 text-xs text-ink/55">Note: {entry.note}</p>}
          </div>)}
        </div>}
      </ClayCard>

      {transfer && (
        /* A dialog, not a panel at the foot of the page: the button sits on a
           student row near the top, and a panel below every group card looked
           like nothing had happened. */
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
          <button
            type="button"
            aria-label="Close"
            className="absolute inset-0 cursor-default bg-ink/40"
            onClick={() => setTransfer(null)}
          />
          <ClayCard className="relative w-full max-w-lg max-h-[85vh] overflow-y-auto p-5">
            <h3 className="font-display font-bold text-sm mb-1">
              Move {transfer.last_name}, {transfer.first_name}&rsquo;s record onto&hellip;
            </h3>
            <p className="text-[11px] text-ink/60 mb-3">
              Their points, attendance, activity scores, badges, missions and rewards move across,
              and {transfer.last_name}, {transfer.first_name} is then removed from the roster.
            </p>

            {candidates.length === 0 ? (
              <p className="rounded-xl border-2 border-ink/10 bg-cream/50 px-3 py-2 text-xs font-bold text-ink/55">
                There is no other student in this class to move the record onto.
              </p>
            ) : (
              <>
                <p className="font-display font-bold text-xs mb-1" id="transfer-target-label">
                  Choose the correct student
                </p>
                <div className="max-h-64 space-y-1.5 overflow-y-auto rounded-xl border-2 border-ink/10 p-2">
                  {candidates.map((option) => {
                    const g = groups.find((gg) => gg.id === option.group_id);
                    const taken = Boolean(option.account);
                    const chosen = transferTo === option.id;
                    return (
                      <button
                        key={option.id}
                        type="button"
                        disabled={taken}
                        onClick={() => setTransferTo(option.id)}
                        className={`flex w-full items-center justify-between gap-2 rounded-lg border-2 px-3 py-2 text-left text-sm ${
                          chosen
                            ? "border-clay-purple bg-clay-purple/10"
                            : taken
                              ? "cursor-not-allowed border-ink/5 bg-cream/40 text-ink/40"
                              : "border-ink/10 bg-white hover:border-clay-purple/50"
                        }`}
                      >
                        <span className="font-display font-bold">
                          {option.last_name}, {option.first_name}
                        </span>
                        <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide">
                          {g ? `Group ${g.group_number}` : "Unassigned"}
                          {taken ? " · already signed in" : ""}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </>
            )}

            <div className="mt-3">
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
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <ClayButton size="sm" color="purple" onClick={runTransfer} disabled={!transferTo || transferring}>
                {transferring ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRightLeft className="w-4 h-4" />}
                {transferTo ? `Move to ${selectedName}` : "Move record"}
              </ClayButton>
              <ClayButton size="sm" color="cream" onClick={() => setTransfer(null)}>Cancel</ClayButton>
            </div>
          </ClayCard>
        </div>
      )}
    </div>
  );
}
