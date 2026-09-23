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

export default function TeacherBadges() {
  const { user } = useAuth();
  const [classroom, setClassroom] = useState(null);
  const [badges, setBadges] = useState([]);
  const [form, setForm] = useState({ title: "", description: "", icon: "🏅", badge_scope: "group", points: 10 });
  const [saving, setSaving] = useState(false);
  const [requests, setRequests] = useState([]);
  const [groups, setGroups] = useState([]);
  const [reviewing, setReviewing] = useState(null);
  async function load() {
    const c = await getTeacherClassroom(user.id); setClassroom(c);
    if (c) {
      const [definitions, ds] = await Promise.all([
        db.entities.BadgeDefinition.filter({ created_by: user.id }, { orderBy: "created_at", ascending: false }),
        getClassroomDataset(c.id, ['groups', 'badges']),
      ]);
      setBadges(definitions);
      setGroups(ds.groups || []);
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
    try { await reviewBadgeClaim(request.id, approve); invalidateClassroomDataset(); await load(); }
    finally { setReviewing(null); }
  }
  if (!classroom) return <div className="py-20 text-center">Loading…</div>;
  return <div className="mx-auto max-w-5xl space-y-5 sm:space-y-6">
    <section className="grid gap-4 lg:grid-cols-[1fr_minmax(300px,.72fr)] lg:items-center"><div><p className="text-sm font-semibold text-[var(--uc-purple)]">Weekly recognition</p><h1 className="uc-page-title mt-1 text-3xl sm:text-4xl">Badges</h1><p className="mt-1 text-sm leading-relaxed text-ink/60">Create meaningful achievements and approve group requests before points are awarded.</p></div><NovaMessage variant="achievement" tone="yellow" title="Small wins deserve to be seen.">Keep badge criteria clear and celebrate progress together.</NovaMessage></section>
    <ClayCard className="p-5"><div className="mb-4 flex items-center gap-3"><UIAsset name="assessment" className="h-11 w-11" /><div><h2 className="font-display text-xl font-extrabold text-[var(--uc-navy-950)]">Create badge</h2><p className="text-sm text-ink/60">Badges can be shared across your classes.</p></div></div><form onSubmit={create} className="space-y-3">
      <input className="clay-input" placeholder="Badge title" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} required />
      <textarea className="clay-input" rows={2} placeholder="What should students celebrate?" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
      <div className="grid grid-cols-3 gap-2"><input className="clay-input" placeholder="🏅" value={form.icon} onChange={e => setForm({ ...form, icon: e.target.value })} /><select className="clay-input" value={form.badge_scope} onChange={e => setForm({ ...form, badge_scope: e.target.value })}><option value="group">Group badge</option><option value="personal">Personal badge</option></select><input className="clay-input" type="number" min="0" value={form.points} onChange={e => setForm({ ...form, points: e.target.value })} /></div>
      <ClayButton type="submit" color="purple" disabled={saving}><Plus className="w-4 h-4" /> Create badge</ClayButton>
    </form></ClayCard>
    {requests.length > 0 && <ClayCard color="sun" className="p-5"><h2 className="font-display font-bold text-sm mb-1">Badge requests</h2><p className="text-xs text-ink/60 mb-3">Approve to add the badge points. Declining gives no points.</p><div className="space-y-2">{requests.map((request) => { const group = groups.find((item) => item.id === request.group_id); const definition = badges.find((item) => item.id === request.badge_definition_id); const label = definition?.title || request.badge_type.replaceAll('_', ' '); return <div key={request.id} className="rounded-xl border-2 border-ink bg-cream p-3 flex flex-wrap items-center gap-2"><div className="min-w-0 flex-1"><p className="font-display font-bold text-sm capitalize">{label}</p><p className="text-xs text-ink/60">Group {group?.group_number || '—'} · {request.points_awarded} points</p></div><ClayButton size="sm" color="lime" disabled={reviewing === request.id} onClick={() => reviewRequest(request, true)}>{reviewing === request.id ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Approve'}</ClayButton><ClayButton size="sm" color="coral" disabled={reviewing === request.id} onClick={() => reviewRequest(request, false)}>Decline</ClayButton></div>; })}</div></ClayCard>}
    <div className="space-y-3">{badges.filter(b => b.is_active).map(b => <ClayCard key={b.id} className="p-4 flex items-center gap-3"><span className="text-3xl">{b.icon}</span><div className="flex-1"><p className="font-display font-bold">{b.title}</p><p className="text-xs text-ink/60">{b.description || "Weekend badge"} · {b.badge_scope} · +{b.points} pts</p></div><button type="button" onClick={() => remove(b.id)} className="clay-btn bg-cream p-2"><Trash2 className="w-4 h-4" /></button></ClayCard>)}</div>
  </div>;
}
