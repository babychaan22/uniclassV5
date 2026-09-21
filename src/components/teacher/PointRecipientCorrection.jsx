import { useEffect, useMemo, useState } from 'react';
import { ArrowRightLeft, Loader2 } from 'lucide-react';
import ClayButton from '@/components/ClayButton';

export default function PointRecipientCorrection({ entry, members, onCancel, onSave }) {
  const [targetMemberId, setTargetMemberId] = useState(entry.group_member_id || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const groupMembers = useMemo(() => members.filter((member) => member.group_id === entry.group_id), [members, entry.group_id]);
  const recipientUnchanged = (targetMemberId || null) === (entry.group_member_id || null);

  useEffect(() => {
    setTargetMemberId(entry.group_member_id || '');
    setError('');
  }, [entry]);

  async function submit(event) {
    event.preventDefault();
    if (recipientUnchanged) return;
    setSaving(true);
    setError('');
    try {
      await onSave(entry.sourceLogId, targetMemberId || null);
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
      {recipientUnchanged && <p className="text-xs text-ink/60">This award is already assigned correctly. Choose another student or Whole Group only to move the points.</p>}
      {error && <p className="text-xs font-bold text-clay-coral">{error}</p>}
      <div className="flex gap-2"><ClayButton type="submit" size="sm" color="purple" disabled={saving || recipientUnchanged}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Move points'}</ClayButton><ClayButton type="button" size="sm" color="cream" onClick={onCancel} disabled={saving}>Cancel</ClayButton></div>
    </form>
  );
}
