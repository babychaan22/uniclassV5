const db = globalThis.__B44_DB__;

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Image, RefreshCw } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/api/supabaseClient';
import { getTeacherClassroom, getClassroomGroups, getClassroomMembers } from '@/lib/teacherClassroom';
import ClayCard from '@/components/ClayCard';
import ClayButton from '@/components/ClayButton';
import { ROUTES } from '@/lib/routes';

export default function TeacherEvidence() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  async function load(nextPage = 0) {
    if (!user) return;
    if (nextPage === 0) setLoading(true); else setLoadingMore(true);
    setError('');
    try {
      const classroom = await getTeacherClassroom(user.id);
      if (!classroom) { navigate(ROUTES.TEACHER.ONBOARDING); return; }
      const [evidenceResult, groups, members, activities] = await Promise.all([
        supabase.from('activity_evidence').select('*').eq('classroom_id', classroom.id).order('created_at', { ascending: false }).range(nextPage * 40, (nextPage + 1) * 40 - 1),
        getClassroomGroups(classroom.id),
        getClassroomMembers(classroom.id),
        db.entities.Activity.filter({ classroom_id: classroom.id }, { orderBy: 'activity_number' }),
      ]);
      if (evidenceResult.error) throw evidenceResult.error;
      const evidence = evidenceResult.data || [];
      const groupMap = Object.fromEntries(groups.map((group) => [group.id, group.group_number]));
      const memberMap = Object.fromEntries(members.map((member) => [member.id, `${member.first_name || ''} ${member.last_name || ''}`.trim()]));
      const activityMap = Object.fromEntries(activities.map((activity) => [activity.id, activity.title || `Activity ${activity.activity_number}`]));
      const signed = await Promise.all(evidence.map(async (item) => {
        const { data } = await supabase.storage.from('activity-evidence').createSignedUrl(item.storage_path, 300);
        return { ...item, signedUrl: data?.signedUrl || '' };
      }));
      const nextRows = signed.map((item) => ({
        ...item,
        memberLabel: memberMap[item.group_member_id] || 'Unknown student',
        groupLabel: groupMap[item.group_id] ? `Group ${groupMap[item.group_id]}` : 'Individual',
        activityLabel: activityMap[item.activity_id] || 'Activity proof',
      }));
      setRows((current) => nextPage === 0 ? nextRows : [...current, ...nextRows]);
      setPage(nextPage);
      setHasMore(evidence.length === 40);
    } catch (err) {
      setError(err?.message || 'Unable to load activity proof.');
    } finally { setLoading(false); setLoadingMore(false); }
  }

  useEffect(() => {
    load();
    const refresh = () => load();
    window.addEventListener('uniclass-teacher-class-changed', refresh);
    return () => window.removeEventListener('uniclass-teacher-class-changed', refresh);
  }, [user]);

  const sections = rows.reduce((all, row) => {
    const key = `${row.activity_id}:${row.group_id}`;
    if (!all[key]) all[key] = { key, activityLabel: row.activityLabel, groupLabel: row.groupLabel, rows: [] };
    all[key].rows.push(row);
    return all;
  }, {});

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-display font-extrabold flex items-center gap-2"><Image className="w-6 h-6" /> Activity Proof</h1>
          <p className="text-ink/60 text-sm">Review the images students or representatives uploaded before scores were submitted.</p>
        </div>
        <ClayButton onClick={load} color="white" className="shrink-0" aria-label="Refresh activity proof"><RefreshCw className="w-4 h-4" /></ClayButton>
      </div>
      {error && <ClayCard color="coral" className="p-4 text-sm">{error}</ClayCard>}
      {loading ? <div className="py-16 text-center text-ink/60">Loading activity proof…</div> : rows.length === 0 ? (
        <ClayCard className="p-8 text-center text-ink/60">No activity proof has been uploaded yet.</ClayCard>
      ) : (
        <div className="space-y-4">{Object.values(sections).map((section) => <ClayCard key={section.key} className="p-3"><div className="flex items-center justify-between gap-2 mb-2"><div><p className="font-display font-extrabold text-sm">{section.activityLabel}</p><p className="text-xs text-ink/55">{section.groupLabel} · {section.rows.length} proof{section.rows.length === 1 ? '' : 's'}</p></div></div><div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{section.rows.map((row) => <a key={row.id} href={row.signedUrl || undefined} target="_blank" rel="noreferrer" className="rounded-lg border-2 border-ink/15 bg-cream overflow-hidden"><div className="h-20 bg-ink/5">{row.signedUrl ? <img src={row.signedUrl} alt={`${row.memberLabel} activity proof`} className="h-full w-full object-cover" loading="lazy" /> : <div className="h-full flex items-center justify-center text-xs text-ink/50">Unavailable</div>}</div><p className="p-2 text-xs font-display font-bold truncate">{row.memberLabel}</p></a>)}</div></ClayCard>)}</div>
      )}
      {!loading && hasMore && <ClayButton onClick={() => load(page + 1)} disabled={loadingMore} color="white" className="w-full">
        {loadingMore ? 'Loading…' : 'Load older proof'}
      </ClayButton>}
    </div>
  );
}
