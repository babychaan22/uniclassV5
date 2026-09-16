const db = globalThis.__B44_DB__;
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/AuthContext";
import { getTeacherClassroom } from "@/lib/teacherClassroom";
import ClayButton from "@/components/ClayButton";
import ClayCard from "@/components/ClayCard";
import { Award, Plus, Trash2 } from "lucide-react";

export default function TeacherBadges() {
  const { user } = useAuth();
  const [classroom, setClassroom] = useState(null);
  const [badges, setBadges] = useState([]);
  const [form, setForm] = useState({ title: "", description: "", icon: "🏅", badge_scope: "group", points: 10 });
  const [saving, setSaving] = useState(false);
  async function load() {
    const c = await getTeacherClassroom(user.id); setClassroom(c);
    if (c) setBadges(await db.entities.BadgeDefinition.filter({ classroom_id: c.id }, { orderBy: "created_at", ascending: false }));
  }
  useEffect(() => { if (user) load(); }, [user]);
  async function create(e) {
    e.preventDefault(); setSaving(true);
    await db.entities.BadgeDefinition.create({ ...form, points: Number(form.points), classroom_id: classroom.id, created_by: user.id });
    setForm({ title: "", description: "", icon: "🏅", badge_scope: "group", points: 10 }); setSaving(false); load();
  }
  async function remove(id) { await db.entities.BadgeDefinition.update(id, { is_active: false }); load(); }
  if (!classroom) return <div className="py-20 text-center">Loading…</div>;
  return <div className="max-w-2xl mx-auto space-y-5">
    <div><h1 className="text-2xl font-display font-extrabold flex items-center gap-2"><Award className="w-6 h-6" /> Badges</h1><p className="text-ink/60 text-sm">Create extra weekend badges for groups or individual students.</p></div>
    <ClayCard className="p-5"><form onSubmit={create} className="space-y-3">
      <input className="clay-input" placeholder="Badge title" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} required />
      <textarea className="clay-input" rows={2} placeholder="What should students celebrate?" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
      <div className="grid grid-cols-3 gap-2"><input className="clay-input" placeholder="🏅" value={form.icon} onChange={e => setForm({ ...form, icon: e.target.value })} /><select className="clay-input" value={form.badge_scope} onChange={e => setForm({ ...form, badge_scope: e.target.value })}><option value="group">Group badge</option><option value="personal">Personal badge</option></select><input className="clay-input" type="number" min="0" value={form.points} onChange={e => setForm({ ...form, points: e.target.value })} /></div>
      <ClayButton type="submit" color="purple" disabled={saving}><Plus className="w-4 h-4" /> Create optional badge</ClayButton>
    </form></ClayCard>
    <div className="space-y-3">{badges.filter(b => b.is_active).map(b => <ClayCard key={b.id} className="p-4 flex items-center gap-3"><span className="text-3xl">{b.icon}</span><div className="flex-1"><p className="font-display font-bold">{b.title}</p><p className="text-xs text-ink/60">{b.description || "Weekend badge"} · {b.badge_scope} · +{b.points} pts</p></div><button type="button" onClick={() => remove(b.id)} className="clay-btn bg-cream p-2"><Trash2 className="w-4 h-4" /></button></ClayCard>)}</div>
  </div>;
}
