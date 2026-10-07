
const db = globalThis.__B44_DB__;

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/AuthContext";
import { getTeacherClassroom, getClassroomDataset, invalidateClassroomDataset } from "@/lib/teacherClassroom";

import ClayButton from "@/components/ClayButton";
import ClayCard from "@/components/ClayCard";
import ClayChip from "@/components/ClayChip";
import { Switch } from "@/components/ui/switch";
import { Gift, Plus, Trash2, Loader2 } from "lucide-react";
import { ROUTES } from '@/lib/routes';
import { reviewRewardRedemption } from '@/lib/secureActions';
import PanelSkeleton from "@/components/PanelSkeleton";

const GROUP_GOAL_TEMPLATES = [
  { title: "Brain Break", description: "A short class game or movement break.", emoji: "🧠", cost_points: 50 },
  { title: "Class DJ", description: "Choose the clean-up or transition playlist.", emoji: "🎵", cost_points: 75 },
  { title: "Choose a Warm-up", description: "Pick from the teacher's warm-up options.", emoji: "☀️", cost_points: 60 },
];

export default function TeacherRewards() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [classroom, setClassroom] = useState(null);
  const [rewards, setRewards] = useState([]);
  const [form, setForm] = useState({ title: "", description: "", emoji: "🎁", cost_points: 50 });
  const [creating, setCreating] = useState(false);
  const [requests, setRequests] = useState([]);
  const [groups, setGroups] = useState([]);
  const [reviewing, setReviewing] = useState(null);

  useEffect(() => { load(); }, [user]);

  async function load() {
    if (!user) return;
    const c = await getTeacherClassroom(user.id);
    if (!c) { navigate(ROUTES.TEACHER.ONBOARDING); return; }
    setClassroom(c);
    const catalog = await db.entities.Reward.filter({ created_by: user.id });
    const ds = await getClassroomDataset(c.id, ['groups', 'redemptions']);
    setRewards([...catalog].sort((a, b) => (b.created_date || "").localeCompare(a.created_date || "")));
    setGroups(ds.groups || []);
    setRequests((ds.redemptions || []).filter((request) => request.approval_status === 'pending'));
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
    if (!window.confirm("Archive this group goal? Students will no longer be able to request it, but its past requests will stay in your records.")) return;
    await db.entities.Reward.update(id, { is_active: false });
    invalidateClassroomDataset();
    load();
  }

  async function reviewRequest(request, approve) {
    setReviewing(request.id);
    try { await reviewRewardRedemption(request.id, approve); invalidateClassroomDataset(); await load(); }
    finally { setReviewing(null); }
  }

  if (!classroom) return <PanelSkeleton cards={2} />;

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      <div>
        <h1 className="text-2xl font-display font-extrabold mb-1 flex items-center gap-2"><Gift className="w-6 h-6" /> Group unlock catalog</h1>
        <p className="text-ink/60 text-sm">Create shared class goals. Points are a progress threshold—not a currency students lose when a goal is approved.</p>
      </div>

      <ClayCard className="p-5">
        <h2 className="font-display font-bold text-sm mb-3">New Reward</h2>
        <div className="mb-4"><p className="mb-2 text-xs font-display font-bold text-ink/60">Start with a template</p><div className="flex flex-wrap gap-2">{GROUP_GOAL_TEMPLATES.map((template) => <button key={template.title} type="button" className="rounded-full border-2 border-clay-purple/20 bg-clay-purple/5 px-3 py-1.5 text-xs font-display font-bold text-clay-purple hover:bg-clay-purple/10" onClick={() => setForm(template)}>{template.emoji} {template.title}</button>)}</div></div>
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
            <label className="font-display font-bold text-xs mb-1 block">Points threshold (not deducted)</label>
            <input type="number" min="1" className="clay-input font-mono" value={form.cost_points} onChange={(e) => setForm({ ...form, cost_points: e.target.value })} required />
          </div>
          <ClayButton type="submit" color="purple" size="md" className="w-full" disabled={creating}>
            {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Plus className="w-4 h-4" /> Add Reward</>}
          </ClayButton>
        </form>
      </ClayCard>

      {requests.length > 0 && <ClayCard color="sun" className="p-5">
        <h2 className="font-display font-bold text-sm mb-1">Reward requests</h2>
        <p className="text-xs text-ink/60 mb-3">A group must reach the threshold to request a reward. Approval never deducts its earned points.</p>
        <div className="space-y-2">{requests.map((request) => {
          const group = groups.find((item) => item.id === request.group_id);
          return <div key={request.id} className="rounded-xl border-2 border-ink bg-cream p-3 flex flex-wrap items-center gap-2"><div className="min-w-0 flex-1"><p className="font-display font-bold text-sm">{request.reward_title}</p><p className="text-xs text-ink/60">Group {group?.group_number || '—'} · threshold met</p></div><ClayButton size="sm" color="lime" disabled={reviewing === request.id} onClick={() => reviewRequest(request, true)}>{reviewing === request.id ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Approve'}</ClayButton><ClayButton size="sm" color="coral" disabled={reviewing === request.id} onClick={() => reviewRequest(request, false)}>Decline</ClayButton></div>;
        })}</div>
      </ClayCard>}

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
                  <ClayChip color="sun">{r.cost_points} pts threshold</ClayChip>
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
