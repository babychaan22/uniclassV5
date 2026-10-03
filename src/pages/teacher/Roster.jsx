
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

  useEffect(() => { load(); }, [user]);

  async function load() {
    if (!user) return;
    const c = await getTeacherClassroom(user.id);
    if (!c) { navigate(ROUTES.TEACHER.ONBOARDING); return; }
    setClassroom(c);
    const [g, m, acc, badgeRows, definitions] = await Promise.all([
      getClassroomGroups(c.id),
      getClassroomMembers(c.id),
      db.entities.GroupAccount.filter({ classroom_id: c.id }),
      db.entities.Badge.filter({ classroom_id: c.id }),
      db.entities.BadgeDefinition.filter({ classroom_id: c.id }),
    ]);
    setGroups(g.sort((a, b) => a.group_number - b.group_number));
    setMembers(m);
    setAccounts(acc);
    setBadges(badgeRows);
    setBadgeDefinitions(definitions);
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
                        <ClayButton size="sm" color="coral" onClick={() => removeMember(mem)} disabled={saving === mem.id}>{saving === mem.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />} Remove</ClayButton>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </ClayCard>
        );
      })}

      {transfer && (
        <ClayCard color="purple" className="p-4">
          <h3 className="font-display font-bold text-sm mb-1">
            Move the record of {transfer.last_name}, {transfer.first_name} onto…
          </h3>
          <p className="text-[11px] text-ink/60 mb-3">
            Use this when a student signed up again instead of picking their existing name.
            Their points, attendance, activity scores, badges, missions and rewards all move across,
            and {transfer.last_name}, {transfer.first_name} is removed from the roster.
          </p>
          <div className="grid gap-2 sm:grid-cols-[2fr_2fr_auto] items-end">
            <div>
              <label className="font-display font-bold text-xs mb-1 block">Move it onto</label>
              <select className="clay-input text-sm" value={transferTo} onChange={(e) => setTransferTo(e.target.value)}>
                <option value="">Select the correct account</option>
                {members
                  .filter((m) => m.id !== transfer.id)
                  .map((m) => {
                    const g = groups.find((gg) => gg.id === m.group_id);
                    return (
                      <option key={m.id} value={m.id}>
                        {g ? `Group ${g.group_number}` : 'Unassigned'} · {m.last_name}, {m.first_name}
                      </option>
                    );
                  })}
              </select>
            </div>
            <div>
              <label className="font-display font-bold text-xs mb-1 block">Note</label>
              <input
                className="clay-input text-sm"
                value={transferNote}
                onChange={(e) => setTransferNote(e.target.value)}
                placeholder="Forgot to select own name"
              />
            </div>
            <ClayButton size="sm" color="purple" onClick={runTransfer} disabled={!transferTo || transferring}>
              {transferring ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRightLeft className="w-4 h-4" />} Move record
            </ClayButton>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <ClayButton size="sm" color="cream" onClick={() => setTransfer(null)}>Cancel</ClayButton>
          </div>
        </ClayCard>
      )}
    </div>
  );
}
