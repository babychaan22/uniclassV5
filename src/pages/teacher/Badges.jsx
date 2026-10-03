const db = globalThis.__B44_DB__;
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/AuthContext";
import { getTeacherClassroom, getClassroomDataset, invalidateClassroomDataset } from "@/lib/teacherClassroom";
import ClayButton from "@/components/ClayButton";
import ClayCard from "@/components/ClayCard";
import NovaMessage from "@/components/NovaMessage";
import { UIAsset } from "@/components/visual/UIAsset";
import { Plus, Trash2, Loader2 } from "lucide-react";
import { reviewBadgeClaim } from '@/lib/secureActions';
import { notifyGroupBadgesUpdated } from "@/components/GroupBadgeContext";

export default function TeacherBadges() {
  const { user } = useAuth();
  const [classroom, setClassroom] = useState(null);
  const [badges, setBadges] = useState([]);
  const [form, setForm] = useState({ title: "", description: "", icon: "🏅", badge_scope: "group", points: 10 });
  const [saving, setSaving] = useState(false);
  const [requests, setRequests] = useState([]);
  const [groups, setGroups] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [reviewing, setReviewing] = useState(null);
  async function load() {
    const c = await getTeacherClassroom(user.id); setClassroom(c);
    if (c) {
      const [definitions, ds] = await Promise.all([
        db.entities.BadgeDefinition.filter({ created_by: user.id }, { orderBy: "created_at", ascending: false }),
        getClassroomDataset(c.id, ['groups', 'badges', 'groupAccounts']),
      ]);
      setBadges(definitions);
      setGroups(ds.groups || []);
      setAccounts(ds.groupAccounts || []);
      setRequests((ds.badges || []).filter((request) => request.approval_status === 'pending'));
    }
  }
  useEffect(() => { if (user) load(); }, [user]);
  async function create(e) {
    e.preventDefault(); setSaving(true);
    await db.entities.BadgeDefinition.create({ ...form, points: Number(form.points), classroom_id: classroom.id, created_by: user.id, applies_to_all_classes: true });
    setForm({ title: "", description: "", icon: "🏅", badge_scope: "group", points: 10 }); setSaving(false); load();
  }
  async function remove(id) { await db.entities.BadgeDefinition.update(id, { is_active: false }); load(); }
  async function reviewRequest(request, approve) {
    setReviewing(request.id);
    try { await reviewBadgeClaim(request.id, approve); notifyGroupBadgesUpdated(); invalidateClassroomDataset(); await load(); }
    finally { setReviewing(null); }
  }
  if (!classroom) return <div className="py-20 text-center">Loading…</div>;
  return <div className="mx-auto max-w-5xl space-y-5 sm:space-y-6">
    <section className="grid gap-4 lg:grid-cols-[1fr_minmax(300px,.72fr)] lg:items-center"><div><p className="text-sm font-semibold text-[var(--uc-purple)]">Weekly recognition</p><h1 className="uc-page-title mt-1 text-3xl sm:text-4xl">Badges</h1><p className="mt-1 text-sm leading-relaxed text-ink/60">Create meaningful achievements and approve group requests before points are awarded.</p></div><NovaMessage variant="achievement" tone="yellow" title="Small wins deserve to be seen.">Keep badge criteria clear and celebrate progress together.</NovaMessage></section>
    <ClayCard className="p-5"><div className="mb-4 flex items-center gap-3"><UIAsset name="assessment" className="h-11 w-11" /><div><h2 className="font-display text-xl font-extrabold text-[var(--uc-navy-950)]">Create badge</h2><p className="text-sm text-ink/60">Badges can be shared across your classes.</p></div></div><form onSubmit={create} className="space-y-3">
      <input className="clay-input" placeholder="Badge title" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} required />
      <textarea className="clay-input" rows={2} placeholder="What should students celebrate?" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
      <div className="grid grid-cols-3 gap-2"><input className="clay-input" placeholder="🏅" value={form.icon} onChange={e => setForm({ ...form, icon: e.target.value })} /><select className="clay-input" value={form.badge_scope} onChange={e => setForm({ ...form, badge_scope: e.target.value })}><option value="group">Group badge</option><option value="personal">Personal badge</option></select><input aria-label="Badge points" className="clay-input" type="number" min="1" max="10" value={form.points} onChange={e => setForm({ ...form, points: Math.min(10, Math.max(1, Number(e.target.value) || 1)) })} /></div>
      <ClayButton type="submit" color="purple" disabled={saving}><Plus className="w-4 h-4" /> Create badge</ClayButton>
    </form></ClayCard>
    {requests.length > 0 && <ClayCard color="sun" className="p-5"><h2 className="font-display font-bold text-sm mb-1">Badge requests</h2><p className="text-xs text-ink/60 mb-3">Approve to add the badge points. Declining gives no points. Each request shows who asked and the stats they had at that moment.</p><div className="space-y-2">{requests.map((request) => {
      const group = groups.find((item) => item.id === request.group_id);
      const definition = badges.find((item) => item.id === request.badge_definition_id);
      const label = definition?.title || request.badge_type.replaceAll('_', ' ');
      const requester = accounts.find((item) => item.user_id === request.redeemed_by);
      const requesterName = requester ? `${requester.last_name}, ${requester.first_name}` : 'Unknown student';
      const snap = request.request_snapshot || null;
      const facts = [];
      if (snap) {
        facts.push(`${fmt(snap.points_week)} pts that week`);
        facts.push(`group ${fmt(snap.group_points_week)} pts`);
        facts.push(`attendance ${snap.attendance_present}/${snap.attendance_marked}`);
        if (snap.activity_pct != null) facts.push(`activity ${snap.activity_pct}%`);
        if (snap.group_activity_pct != null) facts.push(`group activity ${snap.group_activity_pct}%`);
      }
      return <div key={request.id} className="rounded-xl border-2 border-ink bg-cream p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="min-w-0 flex-1"><p className="font-display font-bold text-sm capitalize">{label}</p><p className="text-xs text-ink/60">Group {group?.group_number || '—'} · {request.points_awarded} points</p></div>
          <ClayButton size="sm" color="lime" disabled={reviewing === request.id} onClick={() => reviewRequest(request, true)}>{reviewing === request.id ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Approve'}</ClayButton>
          <ClayButton size="sm" color="coral" disabled={reviewing === request.id} onClick={() => reviewRequest(request, false)}>Decline</ClayButton>
        </div>
        <p className="mt-2 text-[11px] font-bold uppercase tracking-wide text-ink/50">Requested by {requesterName}{requester?.is_representative ? ' (representative)' : ''}</p>
        {facts.length > 0
          ? <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] font-mono text-ink/70">{facts.map((fact) => <li key={fact}>{fact}</li>)}</ul>
          : <p className="mt-1 text-[11px] text-ink/50">No stats were recorded for this request.</p>}
      </div>;
    })}</div></ClayCard>}
    <div className="space-y-3">{badges.filter(b => b.is_active).map(b => <ClayCard key={b.id} className="p-4 flex items-center gap-3"><span className="text-3xl">{b.icon}</span><div className="flex-1"><p className="font-display font-bold">{b.title}</p><p className="text-xs text-ink/60">{b.description || "Weekend badge"} · {b.badge_scope} · +{b.points} pts</p></div><button type="button" onClick={() => remove(b.id)} className="clay-btn bg-cream p-2"><Trash2 className="w-4 h-4" /></button></ClayCard>)}</div>
  </div>;
}

function fmt(value) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(Number(value || 0));
}
