const db = globalThis.__B44_DB__;

import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { getTeacherClassroom } from '@/lib/teacherClassroom';
import ClayCard from '@/components/ClayCard';
import ClayButton from '@/components/ClayButton';
import NovaMessage from '@/components/NovaMessage';
import { UIAsset } from '@/components/visual/UIAsset';

const scoreKey = (activityId, memberId) => `${activityId}:${memberId}`;

export default function TeacherActivities() {
  const { user } = useAuth();
  const [classroom, setClassroom] = useState(null);
  const [items, setItems] = useState([]);
  const [groups, setGroups] = useState([]);
  const [members, setMembers] = useState([]);
  const [scores, setScores] = useState({});
  const [drafts, setDrafts] = useState({});
  const [form, setForm] = useState({ title: '', max_score: 10, deadline: '' });
  const [saving, setSaving] = useState('');
  const [error, setError] = useState('');

  const load = async () => {
    if (!user) return;
    setError('');
    try {
      const c = await getTeacherClassroom(user.id);
      setClassroom(c);
      if (!c) return;
      const [activities, classGroups, classMembers, activityScores] = await Promise.all([
        db.entities.Activity.filter({ classroom_id: c.id }, { orderBy: 'activity_number' }),
        db.entities.Group.filter({ classroom_id: c.id }, { orderBy: 'group_number' }),
        db.entities.GroupMember.filter({ classroom_id: c.id }),
        db.entities.ActivityScore.filter({ classroom_id: c.id }),
      ]);
      setItems(activities);
      setGroups(classGroups);
      setMembers(classMembers);
      setScores(Object.fromEntries(activityScores.map((score) => [scoreKey(score.activity_id, score.group_member_id), score])));
      setDrafts({});
    } catch (err) {
      setError(err?.message || 'Unable to load the class activities.');
    }
  };

  useEffect(() => {
    load();
    const refresh = () => load();
    window.addEventListener('uniclass-teacher-class-changed', refresh);
    return () => window.removeEventListener('uniclass-teacher-class-changed', refresh);
  }, [user]);

  const roster = useMemo(() => groups.flatMap((group) =>
    members.filter((member) => member.group_id === group.id)
      .sort((a, b) => `${a.last_name} ${a.first_name}`.localeCompare(`${b.last_name} ${b.first_name}`))
      .map((member) => ({ group, member })),
  ), [groups, members]);

  async function create(event) {
    event.preventDefault();
    if (!classroom) return;
    setError('');
    try {
      const number = items.reduce((max, item) => Math.max(max, item.activity_number || 0), 0) + 1;
      await db.entities.Activity.create({ classroom_id: classroom.id, activity_number: number, title: form.title, max_score: Number(form.max_score), deadline: form.deadline || null, is_published: true });
      setForm({ title: '', max_score: 10, deadline: '' });
      await load();
    } catch (err) { setError(err?.message || 'Unable to create this activity.'); }
  }

  function draftScore(activity, member, value) {
    const numeric = value === '' ? '' : Math.max(0, Math.min(Number(value) || 0, Number(activity.max_score) || 0));
    setDrafts((current) => ({ ...current, [scoreKey(activity.id, member.id)]: numeric }));
  }

  function displayedScore(activity, member) {
    const key = scoreKey(activity.id, member.id);
    return Object.hasOwn(drafts, key) ? drafts[key] : (scores[key]?.score ?? '');
  }

  async function saveScore(activity, group, member) {
    const key = scoreKey(activity.id, member.id);
    if (!Object.hasOwn(drafts, key) || drafts[key] === '') return;
    setSaving(key); setError('');
    try {
      const current = scores[key];
      const saved = current
        ? await db.entities.ActivityScore.update(current.id, { score: Number(drafts[key]), encoded_by: user.id })
        : await db.entities.ActivityScore.create({ classroom_id: classroom.id, group_id: group.id, group_member_id: member.id, activity_id: activity.id, score: Number(drafts[key]), encoded_by: user.id });
      setScores((currentScores) => ({ ...currentScores, [key]: saved }));
      setDrafts((currentDrafts) => { const { [key]: unused, ...rest } = currentDrafts; return rest; });
    } catch (err) { setError(err?.message || 'Unable to save that score.'); } finally { setSaving(''); }
  }

  return <div className="mx-auto max-w-7xl space-y-5 sm:space-y-6">
    <section className="grid gap-4 lg:grid-cols-[1fr_minmax(290px,.75fr)] lg:items-center"><div><p className="text-sm font-semibold text-[var(--uc-purple)]">Class activities</p><h1 className="uc-page-title mt-1 text-3xl sm:text-4xl">Assign and score activities</h1><p className="mt-1 text-sm leading-relaxed text-ink/60">Create class activities, then review every group member’s scores and percentage in one place.</p></div><NovaMessage variant="assessment" tone="violet" title="Clear tasks make confident learners.">Create an activity, then keep its class score table up to date here.</NovaMessage></section>
    <ClayCard className="p-4 sm:p-5"><div className="mb-4 flex items-center gap-3"><UIAsset name="assessment" className="h-12 w-12" /><div><h2 className="font-display text-xl font-extrabold text-[var(--uc-navy-950)]">New activity</h2><p className="text-sm text-ink/60">This appears in the student activity list immediately.</p></div></div><form onSubmit={create} className="grid gap-3 sm:grid-cols-3"><div className="sm:col-span-3"><label className="mb-1 block text-xs font-bold text-ink/60">Activity title</label><input className="clay-input" required placeholder="e.g. Coordinate plane practice" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} /></div><div><label className="mb-1 block text-xs font-bold text-ink/60">Maximum score</label><input className="clay-input" required type="number" min="1" value={form.max_score} onChange={(event) => setForm({ ...form, max_score: event.target.value })} /></div><div className="sm:col-span-2"><label className="mb-1 block text-xs font-bold text-ink/60">Deadline (optional)</label><input className="clay-input" type="date" value={form.deadline} onChange={(event) => setForm({ ...form, deadline: event.target.value })} /></div><ClayButton className="sm:col-span-3 sm:justify-self-start" color="purple"><UIAsset name="activities" className="h-5 w-5" />Assign activity</ClayButton></form></ClayCard>
    {error && <ClayCard color="coral" className="p-4 text-sm">{error}</ClayCard>}
    <section><div className="mb-3 flex items-center justify-between gap-3"><div><h2 className="font-display text-xl font-extrabold text-[var(--uc-navy-950)]">Activity score table</h2><p className="text-sm text-ink/60">Each cell is editable by the teacher. Save a changed score directly from its activity column.</p></div><span className="rounded-full bg-[var(--uc-blue-soft)] px-3 py-1 text-xs font-bold text-[var(--uc-navy-950)]">{items.length} activities</span></div>{items.length ? <ClayCard className="overflow-x-auto p-0"><table className="min-w-full border-collapse text-left text-sm"><thead className="bg-[var(--uc-purple-soft)]"><tr><th className="sticky left-0 z-10 min-w-40 bg-[var(--uc-purple-soft)] p-3 font-display">Group / student</th>{items.map((activity) => <th key={activity.id} className="min-w-44 p-3 font-display"><span className="block truncate">Activity {activity.activity_number}: {activity.title}</span><span className="text-[10px] font-normal text-ink/60">out of {activity.max_score}</span></th>)}<th className="min-w-28 p-3 font-display">Total</th><th className="min-w-28 p-3 font-display">Percentage</th></tr></thead><tbody>{roster.map(({ group, member }) => { const rowScores = items.map((activity) => Number(scores[scoreKey(activity.id, member.id)]?.score || 0)); const total = rowScores.reduce((sum, value) => sum + value, 0); const maximum = items.reduce((sum, activity) => sum + Number(activity.max_score || 0), 0); const percentage = maximum ? Math.round((total / maximum) * 100) : 0; return <tr key={member.id} className="border-t border-ink/10"><td className="sticky left-0 z-10 bg-white p-3"><span className="block text-[10px] font-bold text-[var(--uc-purple)]">Group {group.group_number}</span><span className="font-display font-bold">{member.last_name}, {member.first_name}</span></td>{items.map((activity) => { const key = scoreKey(activity.id, member.id); const changed = Object.hasOwn(drafts, key); return <td key={activity.id} className="p-3"><div className="flex items-center gap-1"><input aria-label={`Score for ${member.first_name} in ${activity.title}`} type="number" min="0" max={activity.max_score} value={displayedScore(activity, member)} onChange={(event) => draftScore(activity, member, event.target.value)} className="clay-input h-9 w-16 min-h-0 px-2 py-1 text-center font-mono" /><span className="text-xs text-ink/50">/ {activity.max_score}</span>{changed && <button type="button" onClick={() => saveScore(activity, group, member)} disabled={saving === key} className="clay-btn bg-clay-lime px-2 py-1 text-[10px]">{saving === key ? '…' : 'Save'}</button>}</div></td>; })}<td className="p-3 font-mono font-bold">{total}/{maximum}</td><td className="p-3 font-mono font-bold">{percentage}%</td></tr>; })}</tbody></table></ClayCard> : <ClayCard className="p-8 text-center"><UIAsset name="missions" className="mx-auto h-16 w-16" /><p className="mt-2 font-display font-bold">No activity assigned yet</p><p className="mt-1 text-sm text-ink/60">Create the first activity above when your class is ready.</p></ClayCard>}</section>
  </div>;
}
