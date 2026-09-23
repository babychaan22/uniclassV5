import { useEffect, useState } from 'react';
import { Check, Loader2, UserMinus, UserPlus, X } from 'lucide-react';
import { supabase } from '@/api/supabaseClient';
import ClayButton from '@/components/ClayButton';
import ClayCard from '@/components/ClayCard';
import ClayChip from '@/components/ClayChip';

export default function RepresentativeRosterRequests({ classroomId, members, onReviewed }) {
  const [requests, setRequests] = useState([]);
  const [savingId, setSavingId] = useState(null);
  const [supported, setSupported] = useState(true);
  const [reviewError, setReviewError] = useState("");

  async function load() {
    const { data, error } = await supabase.from('representative_roster_requests').select('*').eq('classroom_id', classroomId).eq('status', 'pending').order('created_date');
    if (error) { setSupported(false); return; }
    setRequests(data || []);
  }
  useEffect(() => { if (classroomId) load(); }, [classroomId]);
  async function review(requestId, approve) {
    setReviewError("");
    setSavingId(requestId);
    const { data, error } = await supabase.rpc('review_representative_roster_change', { p_request_id: requestId, p_approve: approve });
    setSavingId(null);
    if (error) { setReviewError(error.message || "This roster request could not be reviewed."); return; }
    if (data?.evidencePaths?.length) {
      const { error: cleanupError } = await supabase.storage.from('activity-evidence').remove(data.evidencePaths);
      if (cleanupError) setReviewError(`The roster was updated, but evidence cleanup failed: ${cleanupError.message || 'please retry later.'}`);
    }
    await load();
    onReviewed?.();
  }
  if (!supported || requests.length === 0) return null;
  return <ClayCard className="p-4 space-y-3"><div><h2 className="font-display font-bold">Representative roster requests</h2><p className="text-xs text-ink/60">Approve only after checking the group roster.</p></div>{reviewError && <p role="alert" className="rounded-lg border border-clay-coral/30 bg-clay-coral/10 px-3 py-2 text-xs font-display font-bold text-clay-coral">{reviewError}</p>}{requests.map((request) => { const member = members.find((item) => item.id === request.target_member_id); const title = request.request_type === 'add' ? `Add ${request.last_name}, ${request.first_name}` : `Remove ${member ? `${member.last_name}, ${member.first_name}` : 'a former member'}`; return <div key={request.id} className="flex flex-wrap items-center gap-2 rounded-xl border-2 border-ink/10 bg-cream p-2"><ClayChip color={request.request_type === 'add' ? 'lime' : 'coral'}>{request.request_type === 'add' ? <UserPlus className="h-3.5 w-3.5" /> : <UserMinus className="h-3.5 w-3.5" />}{request.request_type}</ClayChip><span className="flex-1 text-sm font-bold">{title}</span><ClayButton size="sm" color="lime" disabled={savingId === request.id} onClick={() => review(request.id, true)}>{savingId === request.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Approve</ClayButton><ClayButton size="sm" color="cream" disabled={savingId === request.id} onClick={() => review(request.id, false)}><X className="h-4 w-4" /> Reject</ClayButton></div>; })}</ClayCard>;
}
