
const db = globalThis.__B44_DB__;

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/AuthContext";
import { getTeacherClassroom, getClassroomGroups, getClassroomMembers, invalidateClassroomContext } from "@/lib/teacherClassroom";
import { removeRosterMember, setGroupRepresentative } from "@/lib/secureActions";
import { supabase } from "@/api/supabaseClient";

import ClayButton from "@/components/ClayButton";
import ClayCard from "@/components/ClayCard";
import ClayChip from "@/components/ClayChip";
import NovaMessage from "@/components/NovaMessage";
import UserAvatar from "@/components/visual/UserAvatar";
import { UIAsset } from "@/components/visual/UIAsset";
import { Save, Loader2, UserCog, Trash2, Crown } from "lucide-react";
import { ROUTES } from '@/lib/routes';
import RepresentativeRosterRequests from '@/components/teacher/RepresentativeRosterRequests';

export default function Roster() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [classroom, setClassroom] = useState(null);
  const [groups, setGroups] = useState([]);
  const [members, setMembers] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [edit, setEdit] = useState({});
  const [saving, setSaving] = useState(null);
  const [actionError, setActionError] = useState("");

  useEffect(() => { load(); }, [user]);

  async function load() {
    if (!user) return;
    const c = await getTeacherClassroom(user.id);
    if (!c) { navigate(ROUTES.TEACHER.ONBOARDING); return; }
    setClassroom(c);
    const [g, m, acc] = await Promise.all([
      getClassroomGroups(c.id),
      getClassroomMembers(c.id),
      db.entities.GroupAccount.filter({ classroom_id: c.id }),
    ]);
    setGroups(g.sort((a, b) => a.group_number - b.group_number));
    setMembers(m);
    setAccounts(acc);
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
              <span>Group {g.group_number}{g.group_name ? ` — ${g.group_name}` : ""}</span> <ClayChip color="cream">{gm.length} members</ClayChip>
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
    </div>
  );
}
