import { useEffect, useMemo, useState } from 'react';
import { ArrowRightLeft, Loader2 } from 'lucide-react';
import ClayButton from '@/components/ClayButton';

export default function PointRecipientCorrection({ entry, members, onCancel, onSave }) {
  const [targetMemberId, setTargetMemberId] = useState(entry.group_member_id || '');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const groupMembers = useMemo(() => members.filter((member) => member.group_id === entry.group_id), [members, entry.group_id]);

  useEffect(() => {
    setTargetMemberId(entry.group_member_id || '');
    setReason('');
    setError('');
  }, [entry]);

  async function submit(event) {
    event.preventDefault();
    if ((targetMemberId || null) === (entry.group_member_id || null)) {
      setError('Choose a different student or Whole Group.');
      return;
    }
    if (reason.trim().length < 3) {
      setError('Add a short reason for this correction.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await onSave(entry.sourceLogId, targetMemberId || null, reason.trim());
    } catch (err) {
      setError(err?.message || 'The point recipient could not be corrected.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-3 rounded-xl border-2 border-clay-purple/35 bg-clay-purple/10 p-3 space-y-3">
      <div className="flex items-start gap-2"><span className="rounded-lg bg-clay-purple p-1.5 text-white"><ArrowRightLeft className="h-4 w-4" /></span><div><p className="text-sm font-display font-bold">Correct point recipient</p><p className="text-xs text-ink/60">Moves {Math.abs(Number(entry.points || 0))} point{Math.abs(Number(entry.points || 0)) === 1 ? '' : 's'} without changing the group total.</p></div></div>
      <div>
        <label className="mb-1 block text-xs font-display font-bold">Correct recipient</label>
        <select className="clay-input text-sm" value={targetMemberId} onChange={(event) => setTargetMemberId(event.target.value)}>
          <option value="">WHOLE GROUP</option>
          {groupMembers.map((member) => <option key={member.id} value={member.id}>{member.last_name}, {member.first_name}</option>)}
        </select>
      </div>
      <div>
        <label className="mb-1 block text-xs font-display font-bold">Why is this being corrected?</label>
        <input className="clay-input text-sm" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="e.g. QR was scanned for the wrong student" required />
      </div>
      {error && <p className="text-xs font-bold text-clay-coral">{error}</p>}
      <div className="flex gap-2"><ClayButton type="submit" size="sm" color="purple" disabled={saving}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Move points'}</ClayButton><ClayButton type="button" size="sm" color="cream" onClick={onCancel} disabled={saving}>Cancel</ClayButton></div>
    </form>
  );
}
