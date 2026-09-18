const db = globalThis.__B44_DB__;
import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { getTeacherClassroom } from '@/lib/teacherClassroom';
import ClayCard from '@/components/ClayCard';
import ClayButton from '@/components/ClayButton';

export default function TeacherActivities() {
  const { user } = useAuth(); const [classroom,setClassroom]=useState(null); const [items,setItems]=useState([]); const [form,setForm]=useState({title:'',max_score:10,deadline:''});
  const load=async()=>{ if(!user)return; const c=await getTeacherClassroom(user.id); setClassroom(c); if(c) setItems(await db.entities.Activity.filter({classroom_id:c.id},{orderBy:'activity_number',ascending:false})); };
  useEffect(()=>{load(); const refresh=()=>load(); window.addEventListener('uniclass-teacher-class-changed',refresh); return()=>window.removeEventListener('uniclass-teacher-class-changed',refresh);},[user]);
  async function create(e){e.preventDefault(); const number=(items.reduce((max,item)=>Math.max(max,item.activity_number||0),0)+1); await db.entities.Activity.create({classroom_id:classroom.id,activity_number:number,title:form.title,max_score:Number(form.max_score),deadline:form.deadline||null,is_published:true}); setForm({title:'',max_score:10,deadline:''}); load();}
  return <div className="max-w-2xl mx-auto space-y-5"><div><h1 className="text-2xl font-display font-extrabold">Assigned Activities</h1><p className="text-sm text-ink/60">Create the activity students can submit scores and proof for.</p></div><ClayCard className="p-4"><form onSubmit={create} className="grid gap-3 sm:grid-cols-3"><input className="clay-input sm:col-span-3" required placeholder="Activity title" value={form.title} onChange={e=>setForm({...form,title:e.target.value})}/><input className="clay-input" required type="number" min="1" placeholder="Maximum score" value={form.max_score} onChange={e=>setForm({...form,max_score:e.target.value})}/><input className="clay-input sm:col-span-2" type="date" value={form.deadline} onChange={e=>setForm({...form,deadline:e.target.value})}/><ClayButton className="sm:col-span-3" color="purple">Assign activity</ClayButton></form></ClayCard><div className="space-y-2">{items.map(item=><ClayCard key={item.id} className="p-3 flex justify-between"><div><b>{item.title}</b><p className="text-xs text-ink/55">Maximum: {item.max_score}{item.deadline?` · Due ${item.deadline}`:''}</p></div><span className="text-xs font-mono">Activity {item.activity_number}</span></ClayCard>)}</div></div>;
}
