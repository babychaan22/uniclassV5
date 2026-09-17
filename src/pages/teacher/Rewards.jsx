
const db = globalThis.__B44_DB__;

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/AuthContext";
import { getTeacherClassroom, invalidateClassroomDataset } from "@/lib/teacherClassroom";

import ClayButton from "@/components/ClayButton";
import ClayCard from "@/components/ClayCard";
import ClayChip from "@/components/ClayChip";
import { Switch } from "@/components/ui/switch";
import { Gift, Plus, Trash2, Loader2 } from "lucide-react";
import { ROUTES } from '@/lib/routes';

export default function TeacherRewards() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [classroom, setClassroom] = useState(null);
  const [rewards, setRewards] = useState([]);
  const [form, setForm] = useState({ title: "", description: "", emoji: "🎁", cost_points: 50 });
  const [creating, setCreating] = useState(false);

  useEffect(() => { load(); }, [user]);

  async function load() {
    if (!user) return;
    const c = await getTeacherClassroom(user.id);
    if (!c) { navigate(ROUTES.TEACHER.ONBOARDING); return; }
    setClassroom(c);
    const catalog = await db.entities.Reward.filter({ created_by: user.id });
    setRewards([...catalog].sort((a, b) => (b.created_date || "").localeCompare(a.created_date || "")));
  }

  async function createReward(e) {
    e.preventDefault();
    setCreating(true);
    await db.entities.Reward.create({
      classroom_id: classroom.id,
      title: form.title,
      description: form.description,
      emoji: form.emoji || "🎁",
      cost_points: Number(form.cost_points),
      is_active: true,
      created_by: user.id,
      applies_to_all_classes: true,
    });
    setForm({ title: "", description: "", emoji: "🎁", cost_points: 50 });
    setCreating(false);
    invalidateClassroomDataset();
    load();
  }

  async function toggleActive(r) {
    await db.entities.Reward.update(r.id, { is_active: !r.is_active });
    invalidateClassroomDataset();
    load();
  }

  async function removeReward(id) {
    await db.entities.Reward.delete(id);
    invalidateClassroomDataset();
    load();
  }

  if (!classroom) return <div className="flex items-center justify-center py-20"><div className="w-8 h-8 border-4 border-clay-purple border-t-transparent rounded-full animate-spin" /></div>;

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      <div>
        <h1 className="text-2xl font-display font-extrabold mb-1 flex items-center gap-2"><Gift className="w-6 h-6" /> Rewards Shop</h1>
        <p className="text-ink/60 text-sm">Define rewards students can claim with participation points in any of your classes.</p>
      </div>

      <ClayCard className="p-5">
        <h2 className="font-display font-bold text-sm mb-3">New Reward</h2>
        <form onSubmit={createReward} className="space-y-3">
          <div className="grid grid-cols-[64px_1fr] gap-3">
            <div>
              <label className="font-display font-bold text-xs mb-1 block">Emoji</label>
              <input className="clay-input text-center text-xl" maxLength={2} value={form.emoji} onChange={(e) => setForm({ ...form, emoji: e.target.value })} />
            </div>
            <div>
              <label className="font-display font-bold text-xs mb-1 block">Title</label>
              <input className="clay-input" placeholder="e.g. Homework Pass" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
            </div>
          </div>
          <div>
            <label className="font-display font-bold text-xs mb-1 block">Description</label>
            <input className="clay-input" placeholder="What the reward grants" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>
          <div>
            <label className="font-display font-bold text-xs mb-1 block">Cost (participation points)</label>
            <input type="number" min="1" className="clay-input font-mono" value={form.cost_points} onChange={(e) => setForm({ ...form, cost_points: e.target.value })} required />
          </div>
          <ClayButton type="submit" color="purple" size="md" className="w-full" disabled={creating}>
            {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Plus className="w-4 h-4" /> Add Reward</>}
          </ClayButton>
        </form>
      </ClayCard>

      {rewards.length === 0 && <p className="text-ink/50 text-sm text-center">No rewards defined yet.</p>}

      {rewards.map((r) => (
        <ClayCard key={r.id} className="p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex items-start gap-3">
              <span className="text-3xl">{r.emoji || "🎁"}</span>
              <div>
                <p className="font-display font-bold">{r.title}</p>
                {r.description && <p className="text-xs text-ink/60 mt-0.5">{r.description}</p>}
                <div className="flex flex-wrap gap-2 mt-2">
                  <ClayChip color="sun">{r.cost_points} pts</ClayChip>
                  <ClayChip color="sky">All your classes</ClayChip>
                  <ClayChip color={r.is_active ? "lime" : "cream"}>{r.is_active ? "Available" : "Hidden"}</ClayChip>
                </div>
              </div>
            </div>
            <div className="flex flex-col items-end gap-2 shrink-0">
              <div className="flex items-center gap-2">
                <span className="text-xs font-display font-bold">{r.is_active ? "On" : "Off"}</span>
                <Switch checked={r.is_active} onCheckedChange={() => toggleActive(r)} />
              </div>
              <button onClick={() => removeReward(r.id)} className="clay-btn bg-clay-coral text-white px-2 py-2"><Trash2 className="w-4 h-4" /></button>
            </div>
          </div>
        </ClayCard>
      ))}
    </div>
  );
}
