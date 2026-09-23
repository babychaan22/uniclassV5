
const db = globalThis.__B44_DB__;

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/AuthContext";
import { getTeacherClassroom, getClassroomDataset, invalidateClassroomDataset } from "@/lib/teacherClassroom";

import ClayButton from "@/components/ClayButton";
import ClayCard from "@/components/ClayCard";
import ClayChip from "@/components/ClayChip";
import NovaMessage from "@/components/NovaMessage";
import { UIAsset } from "@/components/visual/UIAsset";
import { Plus, Trash2, Loader2, Pin, PinOff } from "lucide-react";
import { ROUTES } from '@/lib/routes';

export default function TeacherAnnouncements() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [classroom, setClassroom] = useState(null);
  const [items, setItems] = useState([]);
  const [form, setForm] = useState({ title: "", body: "" });
  const [creating, setCreating] = useState(false);

  useEffect(() => { load(); }, [user]);

  async function load() {
    if (!user) return;
    const c = await getTeacherClassroom(user.id);
    if (!c) { navigate(ROUTES.TEACHER.ONBOARDING); return; }
    setClassroom(c);
    const ds = await getClassroomDataset(c.id, ['announcements']);
    setItems([...ds.announcements].sort((x, y) => (y.created_date || "").localeCompare(x.created_date || "")));
  }

  async function create(e) {
    e.preventDefault();
    setCreating(true);
    await db.entities.Announcement.create({
      classroom_id: classroom.id,
      title: form.title,
      body: form.body,
      is_pinned: true,
      created_by: user.id,
    });
    setForm({ title: "", body: "" });
    setCreating(false);
    invalidateClassroomDataset();
    load();
  }

  async function togglePin(a) {
    await db.entities.Announcement.update(a.id, { is_pinned: !a.is_pinned });
    invalidateClassroomDataset();
    load();
  }
  async function remove(id) {
    await db.entities.Announcement.delete(id);
    invalidateClassroomDataset();
    load();
  }

  if (!classroom) return <div className="flex items-center justify-center py-20"><div className="w-8 h-8 border-4 border-clay-purple border-t-transparent rounded-full animate-spin" /></div>;

  return (
    <div className="mx-auto max-w-5xl space-y-5 sm:space-y-6">
      <section className="grid gap-4 lg:grid-cols-[1fr_minmax(300px,.72fr)] lg:items-center"><div><p className="text-sm font-semibold text-[var(--uc-purple)]">Class communication</p><h1 className="uc-page-title mt-1 text-3xl sm:text-4xl">Announcements</h1><p className="mt-1 text-sm leading-relaxed text-ink/60">Post the updates your students need to see on their dashboard.</p></div><NovaMessage variant="notification" tone="pink" title="Keep everyone in the loop.">Pinned updates are easier for every learner to find.</NovaMessage></section>

      <ClayCard className="p-5">
        <div className="mb-4 flex items-center gap-3"><UIAsset name="notifications" className="h-11 w-11" /><div><h2 className="font-display text-xl font-extrabold text-[var(--uc-navy-950)]">New announcement</h2><p className="text-sm text-ink/60">Write a concise update for your class.</p></div></div>
        <form onSubmit={create} className="space-y-3">
          <div>
            <label className="font-display font-bold text-xs mb-1 block">Title</label>
            <input className="clay-input" placeholder="e.g. Quiz moved to Friday" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
          </div>
          <div>
            <label className="font-display font-bold text-xs mb-1 block">Message</label>
            <textarea className="clay-input min-h-[80px]" placeholder="Write your announcement..." value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} required />
          </div>
          <ClayButton type="submit" color="purple" size="md" disabled={creating}>
            {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Plus className="w-4 h-4" /> Post &amp; Pin</>}
          </ClayButton>
        </form>
      </ClayCard>

      {items.length === 0 && <p className="text-ink/50 text-sm text-center">No announcements yet.</p>}

      <div className="space-y-3">
        {items.map((a) => (
          <ClayCard key={a.id} className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="font-display font-bold">{a.title}</p>
                  {a.is_pinned ? <ClayChip color="sun"><Pin className="w-3 h-3" /> Pinned</ClayChip> : <ClayChip color="cream">Unpinned</ClayChip>}
                </div>
                <p className="text-sm text-ink/70 mt-1 whitespace-pre-wrap">{a.body}</p>
                <p className="text-[10px] text-ink/40 font-mono mt-2">{a.created_date ? new Date(a.created_date).toLocaleString() : ""}</p>
              </div>
              <div className="flex flex-col gap-2 shrink-0">
                <button onClick={() => togglePin(a)} className="clay-btn bg-clay-sun text-ink px-2 py-2" title={a.is_pinned ? "Unpin" : "Pin"}>
                  {a.is_pinned ? <PinOff className="w-4 h-4" /> : <Pin className="w-4 h-4" />}
                </button>
                <button onClick={() => remove(a.id)} className="clay-btn bg-clay-coral text-white px-2 py-2"><Trash2 className="w-4 h-4" /></button>
              </div>
            </div>
          </ClayCard>
        ))}
      </div>
    </div>
  );
}
