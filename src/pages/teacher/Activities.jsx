const db = globalThis.__B44_DB__;
import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { getTeacherClassroom } from '@/lib/teacherClassroom';
import ClayCard from '@/components/ClayCard';
import ClayButton from '@/components/ClayButton';
import NovaMessage from '@/components/NovaMessage';
import { UIAsset } from '@/components/visual/UIAsset';

export default function TeacherActivities() {
  const { user } = useAuth(); const [classroom,setClassroom]=useState(null); const [items,setItems]=useState([]); const [form,setForm]=useState({title:'',max_score:10,deadline:''});
  const load=async()=>{ if(!user)return; const c=await getTeacherClassroom(user.id); setClassroom(c); if(c) setItems(await db.entities.Activity.filter({classroom_id:c.id},{orderBy:'activity_number',ascending:false})); };
  useEffect(()=>{load(); const refresh=()=>load(); window.addEventListener('uniclass-teacher-class-changed',refresh); return()=>window.removeEventListener('uniclass-teacher-class-changed',refresh);},[user]);
  async function create(e){e.preventDefault(); const number=(items.reduce((max,item)=>Math.max(max,item.activity_number||0),0)+1); await db.entities.Activity.create({classroom_id:classroom.id,activity_number:number,title:form.title,max_score:Number(form.max_score),deadline:form.deadline||null,is_published:true}); setForm({title:'',max_score:10,deadline:''}); load();}
  return (
    <div className="mx-auto max-w-5xl space-y-5 sm:space-y-6">
      <section className="grid gap-4 lg:grid-cols-[1fr_minmax(290px,.75fr)] lg:items-center">
        <div>
          <p className="text-sm font-semibold text-[var(--uc-purple)]">Class activities</p>
          <h1 className="uc-page-title mt-1 text-3xl sm:text-4xl">Assign an activity</h1>
          <p className="mt-1 text-sm leading-relaxed text-ink/60">Give learners one clear place to see the task, maximum score, due date, and evidence requirement.</p>
        </div>
        <NovaMessage variant="assessment" tone="violet" title="Clear tasks make confident learners.">Name the activity, set its score, then share it with your classroom.</NovaMessage>
      </section>

      <ClayCard className="p-4 sm:p-5">
        <div className="mb-4 flex items-center gap-3"><UIAsset name="assessment" className="h-12 w-12" /><div><h2 className="font-display text-xl font-extrabold text-[var(--uc-navy-950)]">New activity</h2><p className="text-sm text-ink/60">This will appear as the current activity for students.</p></div></div>
        <form onSubmit={create} className="grid gap-3 sm:grid-cols-3">
          <div className="sm:col-span-3"><label className="mb-1 block text-xs font-bold text-ink/60">Activity title</label><input className="clay-input" required placeholder="e.g. Coordinate plane practice" value={form.title} onChange={e=>setForm({...form,title:e.target.value})}/></div>
          <div><label className="mb-1 block text-xs font-bold text-ink/60">Maximum score</label><input className="clay-input" required type="number" min="1" placeholder="10" value={form.max_score} onChange={e=>setForm({...form,max_score:e.target.value})}/></div>
          <div className="sm:col-span-2"><label className="mb-1 block text-xs font-bold text-ink/60">Deadline (optional)</label><input className="clay-input" type="date" value={form.deadline} onChange={e=>setForm({...form,deadline:e.target.value})}/></div>
          <ClayButton className="sm:col-span-3 sm:justify-self-start" color="purple"><UIAsset name="assessment" className="h-5 w-5" />Assign activity</ClayButton>
        </form>
      </ClayCard>

      <section>
        <div className="mb-3 flex items-center justify-between gap-3"><div><h2 className="font-display text-xl font-extrabold text-[var(--uc-navy-950)]">Current activities</h2><p className="text-sm text-ink/60">Students see the newest assignment first.</p></div><span className="rounded-full bg-[var(--uc-blue-soft)] px-3 py-1 text-xs font-bold text-[var(--uc-navy-950)]">{items.length} total</span></div>
        {items.length ? <div className="grid gap-3 sm:grid-cols-2">{items.map(item=><ClayCard key={item.id} className="flex min-h-28 items-start justify-between gap-3 p-4"><div className="flex min-w-0 gap-3"><UIAsset name="resources" className="h-10 w-10 shrink-0" /><div className="min-w-0"><b className="block truncate font-display text-base text-[var(--uc-navy-950)]">{item.title}</b><p className="mt-1 text-xs text-ink/55">Maximum score: {item.max_score}{item.deadline?` · Due ${item.deadline}`:''}</p></div></div><span className="shrink-0 rounded-lg bg-[var(--uc-purple-soft)] px-2 py-1 font-mono text-xs font-bold text-[var(--uc-purple)]">#{item.activity_number}</span></ClayCard>)}</div> : <ClayCard className="p-8 text-center"><UIAsset name="assessment" className="mx-auto h-16 w-16" /><p className="mt-2 font-display font-bold">No activity assigned yet</p><p className="mt-1 text-sm text-ink/60">Create the first activity above when your class is ready.</p></ClayCard>}
      </section>
    </div>
  );
}
