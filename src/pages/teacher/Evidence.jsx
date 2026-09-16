const db = globalThis.__B44_DB__;

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Image, ExternalLink, RefreshCw } from 'lucide-react';
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
      const [evidence, groups, members, activities] = await Promise.all([
        db.entities.ActivityEvidence.filter({ classroom_id: classroom.id }, { orderBy: 'created_at', ascending: false, limit: 40, offset: nextPage * 40 }),
        getClassroomGroups(classroom.id),
        getClassroomMembers(classroom.id),
        db.entities.Activity.filter({ classroom_id: classroom.id }, { orderBy: 'activity_number' }),
      ]);
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

  useEffect(() => { load(); }, [user]);

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
        <div className="grid gap-4 sm:grid-cols-2">
          {rows.map((row) => (
            <ClayCard key={row.id} className="overflow-hidden">
              {row.signedUrl ? <a href={row.signedUrl} target="_blank" rel="noreferrer" className="block bg-ink/5"><img src={row.signedUrl} alt={`${row.memberLabel} activity proof`} className="h-48 w-full object-contain" loading="lazy" /></a> : <div className="h-48 flex items-center justify-center text-ink/50">Preview unavailable</div>}
              <div className="p-4 space-y-1 text-sm">
                <div className="font-display font-extrabold">{row.memberLabel}</div>
                <div>{row.activityLabel} · {row.groupLabel}</div>
                <div className="text-ink/55">Uploaded {row.created_at ? new Date(row.created_at).toLocaleString() : 'recently'}</div>
                {row.signedUrl && <a href={row.signedUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 pt-2 font-display font-bold text-clay-purple">Open full image <ExternalLink className="w-4 h-4" /></a>}
              </div>
            </ClayCard>
          ))}
        </div>
      )}
      {!loading && hasMore && <ClayButton onClick={() => load(page + 1)} disabled={loadingMore} color="white" className="w-full">
        {loadingMore ? 'Loading…' : 'Load older proof'}
      </ClayButton>}
    </div>
  );
}
