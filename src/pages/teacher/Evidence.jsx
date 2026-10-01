const db = globalThis.__B44_DB__;

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/api/supabaseClient';
import { getTeacherClassroom, getClassroomGroups, getClassroomMembers } from '@/lib/teacherClassroom';
import ClayCard from '@/components/ClayCard';
import ClayButton from '@/components/ClayButton';
import NovaEmptyState from '@/components/mascot/NovaEmptyState';
import NovaMessage from '@/components/NovaMessage';
import UserAvatar from '@/components/visual/UserAvatar';
import { UIAsset } from '@/components/visual/UIAsset';
import { ROUTES } from '@/lib/routes';
import { reviewActivityScoreEdit } from '@/lib/secureActions';

export default function TeacherEvidence() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [scoreEdits, setScoreEdits] = useState([]);
  const [reviewingEdit, setReviewingEdit] = useState(null);

  async function load(nextPage = 0) {
    if (!user) return;
    if (nextPage === 0) setLoading(true); else setLoadingMore(true);
    setError('');
    try {
      const classroom = await getTeacherClassroom(user.id);
      if (!classroom) { navigate(ROUTES.TEACHER.ONBOARDING); return; }
      const [evidenceResult, groups, members, activities, editsResult] = await Promise.all([
        supabase.from('activity_evidence').select('*').eq('classroom_id', classroom.id).order('created_at', { ascending: false }).range(nextPage * 40, (nextPage + 1) * 40 - 1),
        getClassroomGroups(classroom.id),
        getClassroomMembers(classroom.id),
        db.entities.Activity.filter({ classroom_id: classroom.id }, { orderBy: 'activity_number' }),
        supabase.from('activity_score_edit_requests').select('*').eq('classroom_id', classroom.id).eq('status', 'pending').order('created_at', { ascending: false }),
      ]);
      if (evidenceResult.error) throw evidenceResult.error;
      if (editsResult.error) throw editsResult.error;
      const evidence = evidenceResult.data || [];
      const groupMap = Object.fromEntries(groups.map((group) => [group.id, group.group_number]));
      const memberMap = Object.fromEntries(members.map((member) => [member.id, `${member.first_name || ''} ${member.last_name || ''}`.trim()]));
const activityMap = Object.fromEntries(activities.map((activity) => [activity.id, activity.title || `Activity ${activity.activity_number}`]));
      const evidenceById = Object.fromEntries(evidence.map((item) => [item.id, item]));
      // A request is only approvable with the fresh photo it was sent with, so
      // surface that proof inline instead of making the teacher go hunting.
      const signedById = Object.fromEntries(await Promise.all(
        (editsResult.data || [])
          .filter((request) => request.evidence_id && evidenceById[request.evidence_id])
          .map(async (request) => {
            const { data } = await supabase.storage.from('activity-evidence').createSignedUrl(evidenceById[request.evidence_id].storage_path, 600);
            return [request.id, data?.signedUrl || ''];
          }),
      ));
      setScoreEdits((editsResult.data || []).map((request) => ({
        ...request,
        memberLabel: memberMap[request.group_member_id] || 'Unknown student',
        groupLabel: groupMap[request.group_id] ? `Group ${groupMap[request.group_id]}` : 'Individual',
        activityLabel: activityMap[request.activity_id] || 'Activity',
        proofUrl: signedById[request.id] || '',
      })));
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

  async function reviewScoreEdit(request, approve) {
    setReviewingEdit(request.id);
    try {
      await reviewActivityScoreEdit(request.id, approve);
      await load();
    } catch (err) {
      setError(err?.message || 'Could not review the score edit.');
    } finally { setReviewingEdit(null); }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5 sm:space-y-6">
      <section className="grid gap-4 lg:grid-cols-[1fr_minmax(300px,.72fr)] lg:items-center">
        <div>
          <p className="text-sm font-semibold text-[var(--uc-purple)]">Score reliability</p>
          <h1 className="uc-page-title mt-1 text-3xl sm:text-4xl">Activity proof</h1>
          <p className="mt-1 text-sm leading-relaxed text-ink/60">Review images uploaded by students or representatives before scores are submitted.</p>
        </div>
        <NovaMessage variant="assessment" tone="violet" title="Every proof tells part of the story.">Open a tile to inspect the work at full size.</NovaMessage>
      </section>
      <div className="flex justify-end">
        <ClayButton onClick={load} color="white" className="shrink-0" aria-label="Refresh activity proof"><RefreshCw className="w-4 h-4" /></ClayButton>
      </div>
      {error && <ClayCard color="coral" className="p-4 text-sm">{error}</ClayCard>}
      {scoreEdits.length > 0 && <ClayCard color="sun" className="p-4 sm:p-5"><div className="mb-3"><h2 className="font-display font-bold text-base">Score edit requests</h2><p className="text-xs text-ink/60">Approve to replace the saved score, or decline to keep the current one.</p></div><div className="space-y-2">{scoreEdits.map((request) => <div key={request.id} className="flex flex-wrap items-center gap-2 rounded-xl border-2 border-ink/10 bg-cream p-3">
                  {request.proofUrl
                    ? <a href={request.proofUrl} target="_blank" rel="noreferrer" className="shrink-0"><img src={request.proofUrl} alt={`Fresh proof for ${request.memberLabel}`} className="h-14 w-14 rounded-lg border-2 border-ink/10 object-cover" loading="lazy" /></a>
                    : <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg border-2 border-dashed border-clay-coral/50 px-1 text-center text-[9px] font-bold text-clay-coral">No fresh proof</div>}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-display font-bold">{request.memberLabel} · {request.activityLabel}</p>
                    <p className="text-xs text-ink/60">{request.groupLabel} · {request.current_score} → {request.proposed_score}</p>
                    <p className="text-[10px] text-ink/50">{request.proofUrl ? 'Fresh proof attached with this request' : 'Sent without new proof — decline this request'}</p>
                  </div>
                  <ClayButton size="sm" color="lime" disabled={reviewingEdit === request.id || !request.proofUrl} onClick={() => reviewScoreEdit(request, true)}>{reviewingEdit === request.id ? 'Saving...' : 'Approve'}</ClayButton>
                  <ClayButton size="sm" color="coral" disabled={reviewingEdit === request.id} onClick={() => reviewScoreEdit(request, false)}>Decline</ClayButton>
                </div>)}</div></ClayCard>}
      {loading ? <div className="py-16 text-center text-ink/60">Loading activity proof…</div> : rows.length === 0 ? (
        <NovaEmptyState
          variant="teacher"
          title="No activity proof yet"
          description="Students will upload activity proof after they submit their scores. It will appear here for your review."
        />
      ) : (
        <div className="space-y-3">{Object.values(sections).map((section) => <ClayCard key={section.key} className="p-3 sm:p-4"><div className="mb-2 flex items-center justify-between gap-2"><div className="flex items-center gap-2"><UIAsset name="resources" className="h-8 w-8" /><div><p className="font-display text-sm font-extrabold text-[var(--uc-navy-950)]">{section.activityLabel}</p><p className="text-[11px] text-ink/55">{section.groupLabel} · {section.rows.length} proof{section.rows.length === 1 ? '' : 's'}</p></div></div></div><div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">{section.rows.map((row) => <a key={row.id} href={row.signedUrl || undefined} target="_blank" rel="noreferrer" className="group overflow-hidden rounded-xl border border-ink/5 bg-[var(--uc-bg)] transition-transform hover:-translate-y-0.5"><div className="h-20 bg-ink/5">{row.signedUrl ? <img src={row.signedUrl} alt={`${row.memberLabel} activity proof`} className="h-full w-full object-cover" loading="lazy" /> : <div className="flex h-full items-center justify-center text-xs text-ink/50">Unavailable</div>}</div><div className="flex items-center gap-1.5 p-1.5"><UserAvatar name={row.memberLabel} size="sm" /><p className="min-w-0 truncate text-[10px] font-display font-bold text-[var(--uc-navy-950)]">{row.memberLabel}</p></div></a>)}</div></ClayCard>)}</div>
      )}
      {!loading && hasMore && <ClayButton onClick={() => load(page + 1)} disabled={loadingMore} color="white" className="w-full">
        {loadingMore ? 'Loading…' : 'Load older proof'}
      </ClayButton>}
    </div>
  );
}
