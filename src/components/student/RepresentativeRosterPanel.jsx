import { useEffect, useState } from 'react';
import { Loader2, UserMinus, UserPlus, UsersRound } from 'lucide-react';
import { supabase } from '@/api/supabaseClient';
import ClayButton from '@/components/ClayButton';
import ClayCard from '@/components/ClayCard';
import ClayChip from '@/components/ClayChip';

export default function RepresentativeRosterPanel({ account, members, onRequested }) {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [requests, setRequests] = useState([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [supported, setSupported] = useState(true);

  async function loadRequests() {
    const { data, error } = await supabase
      .from('representative_roster_requests')
      .select('*')
      .eq('requested_by', account.id)
      .order('created_date', { ascending: false })
      .limit(8);
    if (error) {
      setSupported(false);
      return;
    }
    setRequests(data || []);
  }

  useEffect(() => { if (account?.is_representative) loadRequests(); }, [account?.id, account?.is_representative]);

  async function requestChange(type, memberId = null) {
    setSaving(true);
    setMessage('');
    const { error } = await supabase.rpc('request_representative_roster_change', {
      p_request_type: type,
      p_target_member_id: memberId,
      p_first_name: type === 'add' ? firstName : null,
      p_last_name: type === 'add' ? lastName : null,
      p_classroom_id: account.classroom_id,
    });
    setSaving(false);
    if (error) { setMessage(error.message); return; }
    setFirstName(''); setLastName('');
    setMessage('Sent to your teacher for approval.');
    await loadRequests();
    onRequested?.();
  }

  if (!account?.is_representative) return null;
  if (!supported) return (
    <ClayCard className="p-4">
      <p className="font-display font-bold text-sm">Representative roster review</p>
      <p className="mt-1 text-xs text-ink/60">This classroom needs the roster-approval update before representatives can send roster requests.</p>
    </ClayCard>
  );

  return (
    <ClayCard className="p-4 space-y-3">
      <div className="flex items-start gap-2">
        <span className="rounded-lg bg-clay-purple p-2 text-white"><UsersRound className="h-4 w-4" /></span>
        <div><h2 className="font-display font-bold">Manage your group roster</h2><p className="text-xs text-ink/60">Requests stay pending until your teacher checks and approves them.</p></div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <input className="clay-input text-sm" value={lastName} onChange={(event) => setLastName(event.target.value)} placeholder="Last name" />
        <input className="clay-input text-sm" value={firstName} onChange={(event) => setFirstName(event.target.value)} placeholder="First name" />
      </div>
      <ClayButton color="purple" size="sm" className="w-full" disabled={saving || !firstName.trim() || !lastName.trim()} onClick={() => requestChange('add')}>
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />} Request to add member
      </ClayButton>
      <div className="space-y-2 border-t-2 border-ink/10 pt-3">
        <p className="text-xs font-display font-bold">Current members</p>
        {members.filter((member) => member.id !== account.group_member_id).map((member) => (
          <div key={member.id} className="flex items-center gap-2 rounded-lg bg-cream px-2 py-1.5">
            <span className="min-w-0 flex-1 truncate text-sm font-bold">{member.last_name}, {member.first_name}</span>
            <ClayButton size="sm" color="cream" disabled={saving} onClick={() => requestChange('remove', member.id)}><UserMinus className="h-3.5 w-3.5" /> Request removal</ClayButton>
          </div>
        ))}
      </div>
      {message && <p className="rounded-lg bg-clay-sky/15 px-2 py-1.5 text-xs font-bold text-ink">{message}</p>}
      {requests.length > 0 && <div className="border-t-2 border-ink/10 pt-3"><p className="mb-2 text-xs font-display font-bold">Recent requests</p><div className="flex flex-wrap gap-2">{requests.map((request) => <ClayChip key={request.id} color={request.status === 'approved' ? 'lime' : request.status === 'rejected' ? 'coral' : 'sun'}>{request.request_type === 'add' ? `Add ${request.last_name}, ${request.first_name}` : 'Remove member'} · {request.status}</ClayChip>)}</div></div>}
    </ClayCard>
  );
}
