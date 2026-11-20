import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { CheckCheck, HandHelping, HelpCircle, HeartHandshake } from 'lucide-react';
import AuthLayout from '@/components/AuthLayout';
import ClayButton from '@/components/ClayButton';
import { supabase } from '@/api/supabaseClient';

// Standing guardian page — openable without a UniClass account. Unlike the
// per-period /family-reply page, this link works all term: guardians scan it
// once (QR printed by the teacher) and keep it on their phone. It shows only
// the learner's display name and class, and posts a lightweight reply that
// lands on the current week's Family summaries inbox entry.

const REACTIONS = [
  { value: 'acknowledged', label: 'I read the update', tone: 'bg-clay-lime', icon: CheckCheck },
  { value: 'needs_help', label: 'My child needs help', tone: 'bg-clay-coral', icon: HandHelping },
  { value: 'question', label: 'I have a question', tone: 'bg-clay-sky', icon: HelpCircle },
];

export default function FamilyStandingReply() {
  const { token } = useParams();
  const [invite, setInvite] = useState(null);
  const [reaction, setReaction] = useState('');
  const [guardianName, setGuardianName] = useState('');
  const [note, setNote] = useState('');
  const [status, setStatus] = useState(null); // null | 'sent' | error message
  const [sending, setSending] = useState(false);

  useEffect(() => {
    let active = true;
    supabase
      .rpc('read_family_member_link', { p_share_token: token })
      .then(({ data, error }) => {
        if (!active) return;
        if (error) setStatus(error.message);
        else setInvite(data);
      })
      .catch((err) => active && setStatus(err.message));
    return () => { active = false; };
  }, [token]);

  // A standing link can be reused, so after one reply let the guardian send
  // another without reloading (they may want to add a question later).
  function resetForm() {
    setReaction('');
    setNote('');
    setStatus(null);
  }

  async function sendReply(e) {
    e.preventDefault();
    if (!reaction) { setStatus('Choose one reply option first.'); return; }
    if (note.length > 500) { setStatus('Notes are limited to 500 characters.'); return; }
    setSending(true);
    setStatus(null);
    const { error } = await supabase.rpc('submit_family_standing_reply', {
      p_share_token: token,
      p_guardian_name: guardianName,
      p_reaction: reaction,
      p_note: note,
    });
    setSending(false);
    if (error) { setStatus(error.message); return; }
    setStatus('sent');
  }

  if (status && status !== 'sent' && !invite) {
    return (
      <AuthLayout icon={HeartHandshake} title="Family link is not valid" subtitle="This standing family link could not be opened">
        <p className="text-center text-sm text-ink/60">{status} Ask the teacher to share the family QR again.</p>
      </AuthLayout>
    );
  }

  if (!invite) {
    return <div className="flex justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-4 border-clay-purple border-t-transparent" /></div>;
  }

  if (status === 'sent') {
    return (
      <AuthLayout icon={CheckCheck} title="Thank you!" subtitle="Your reply was sent to the teacher.">
        <div className="space-y-3 text-center">
          <p className="text-sm text-ink/60">
            {reaction === 'needs_help'
              ? 'The teacher will follow up about the help your child needs.'
              : reaction === 'question'
                ? 'The teacher will read your question and get back to you.'
                : 'The teacher will see that you have read the update.'}
          </p>
          <ClayButton type="button" color="cream" size="sm" onClick={resetForm}>Send another reply</ClayButton>
          <p className="text-[10px] text-ink/45">Save this page — it works all term for {invite.studentName}'s class updates.</p>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout icon={HeartHandshake} title={`${invite.studentName}'s family page`} subtitle={`${invite.className || 'Class'} · works all term`}>
      <form onSubmit={sendReply} className="space-y-4">
        <p className="text-sm text-ink/70">You do not need an account. When the teacher shares an update, reply here so the teacher knows it reached your family — or ask for help at any time.</p>
        <div className="grid gap-2">
          {REACTIONS.map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              type="button"
              onClick={() => setReaction(value)}
              className={`flex items-center gap-2 rounded-xl border-2 px-3 py-2.5 text-left text-sm font-display font-bold transition ${reaction === value ? 'border-clay-purple bg-clay-purple/10' : 'border-ink/10 bg-white'}`}
            >
              <Icon className="h-4 w-4 shrink-0 text-clay-purple" /> {label}
            </button>
          ))}
        </div>
        <label className="block text-sm font-display font-bold">
          Your name <span className="font-normal text-ink/50">(optional)</span>
          <input className="clay-input mt-1.5 w-full" value={guardianName} maxLength={80} onChange={(e) => setGuardianName(e.target.value)} placeholder="e.g. Maria S." />
        </label>
        <label className="block text-sm font-display font-bold">
          Short note <span className="font-normal text-ink/50">(optional)</span>
          <textarea
            className="clay-input mt-1.5 w-full resize-none"
            rows={3}
            maxLength={500}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="A short message for the teacher…"
          />
          <span className="mt-0.5 block text-right text-[10px] text-ink/45">{note.length}/500</span>
        </label>
        {status && status !== 'sent' && <p className="rounded-lg bg-clay-coral/15 px-3 py-2 text-xs text-clay-coral">{status}</p>}
        <ClayButton type="submit" color="purple" className="w-full justify-center" disabled={sending || !reaction}>
          {sending ? 'Sending…' : 'Send reply'}
        </ClayButton>
        <p className="text-center text-[10px] leading-relaxed text-ink/45">
          This reply goes only to the class teacher. No student records, scores, or other learners' information are shared here.
        </p>
      </form>
    </AuthLayout>
  );
}
