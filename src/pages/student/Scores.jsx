
const db = globalThis.__B44_DB__;

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/AuthContext";
import { getActiveStudentAccount } from "@/lib/studentContext";
import { supabase } from "@/api/supabaseClient";
import { ensureGroupActivity, recordActivityEvidence, requestActivityScoreEdit } from "@/lib/secureActions";

import ClayButton from "@/components/ClayButton";
import ClayCard from "@/components/ClayCard";
import NovaMessage from "@/components/NovaMessage";
import UserAvatar from "@/components/visual/UserAvatar";
import { UIAsset } from "@/components/visual/UIAsset";
import { Lock, AlertTriangle, Loader2 } from "lucide-react";

export default function StudentScores() {
  const { user } = useAuth();
  const [account, setAccount] = useState(null);
  const [members, setMembers] = useState([]);
  const [activityNum, setActivityNum] = useState(1);
  const [assignedActivities, setAssignedActivities] = useState([]);
  const [activity, setActivity] = useState(null);
  const [maxScore, setMaxScore] = useState(10);
  const [scores, setScores] = useState({});
  const [locked, setLocked] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [lockedActivities, setLockedActivities] = useState({});
  const [error, setError] = useState("");
  const [proofBusy, setProofBusy] = useState(false);
  const [proofMsg, setProofMsg] = useState("");
  const [groupProofs, setGroupProofs] = useState([]);
  // A fresh group proof supports every changed score in one request.
  const [editGroupProofId, setEditGroupProofId] = useState(null);
  const [existingScores, setExistingScores] = useState({});
  const [editRequests, setEditRequests] = useState({});
  const [requestingEdits, setRequestingEdits] = useState(false);

  useEffect(() => {
    async function load() {
      if (!user) return;
      const a = await getActiveStudentAccount(user.id);
      if (!a) return;
      setAccount(a);
      const [mem, allScores, activities] = await Promise.all([
        db.entities.GroupMember.filter({ group_id: a.group_id, is_transferred: false }),
        db.entities.ActivityScore.filter({ group_id: a.group_id }),
        db.entities.Activity.filter({ classroom_id: a.classroom_id }),
      ]);
      setMembers(mem);
      const assigned = activities.filter((item) => item.is_published !== false).sort((a,b) => b.activity_number-a.activity_number);
      setAssignedActivities(assigned);
      if (assigned[0]) setActivityNum(assigned[0].activity_number);
      const actIds = [...new Set(allScores.map((s) => s.activity_id))];
      const lockedMap = {};
      for (const act of activities) { if (actIds.includes(act.id)) lockedMap[act.activity_number] = true; }
      setLockedActivities(lockedMap);
    }
    load();
  }, [user]);

  useEffect(() => {
    async function loadActivity() {
      if (!account) return;
      const acts = await db.entities.Activity.filter({ classroom_id: account.classroom_id, activity_number: activityNum });
      if (acts.length > 0) {
        setActivity(acts[0]);
        setMaxScore(acts[0].max_score);
        const [existing, evidence, requests] = await Promise.all([
          db.entities.ActivityScore.filter({ activity_id: acts[0].id, group_id: account.group_id }),
          db.entities.ActivityEvidence.filter({ activity_id: acts[0].id, group_id: account.group_id }),
          supabase.from('activity_score_edit_requests').select('*').eq('activity_id', acts[0].id).eq('group_id', account.group_id).order('created_at', { ascending: false }),
        ]);
        setLocked(existing.length > 0);
        const saved = Object.fromEntries(existing.map((item) => [item.group_member_id, item]));
        setExistingScores(saved);
        setScores(Object.fromEntries(existing.map((item) => [item.group_member_id, item.score])));
        // Keep the newest request for each score so a representative can see
        // whether the teacher approved, declined, or still needs to decide.
        setEditRequests((requests.data || []).reduce((byScore, item) => (
          byScore[item.activity_score_id] ? byScore : { ...byScore, [item.activity_score_id]: item }
        ), {}));
        const groupRows = evidence.filter((item) => !item.group_member_id)
          .sort((left, right) => String(right.created_at || '').localeCompare(String(left.created_at || '')));
        const withPreviewUrls = await Promise.all(groupRows.map(async (item) => {
          const { data } = await supabase.storage.from('activity-evidence').createSignedUrl(item.storage_path, 600);
          return { ...item, previewUrl: data?.signedUrl || '' };
        }));
        setGroupProofs(withPreviewUrls);
        // Original proof cannot justify a later correction.
        setEditGroupProofId(null);
      } else {
        setActivity(null);
        setLocked(false);
        setGroupProofs([]);
        setEditGroupProofId(null);
        setExistingScores({});
        setEditRequests({});
      }
      if (!acts.length) setScores({});
    }
    loadActivity();
  }, [activityNum, account]);

  const canEdit = !!account?.is_representative;

  async function getOrCreateActivity() {
    if (activity) return activity;
    const next = await ensureGroupActivity(account.classroom_id, account.group_id, activityNum, Number(maxScore));
    setActivity(next);
    return next;
  }

  async function uploadGroupProofs(fileList, forScoreEdit = false) {
    const files = Array.from(fileList || []);
    if (!files.length || !account) return;
    const invalid = files.find((file) => file.type && !/^image\/(jpeg|png|webp)$/i.test(file.type));
    if (invalid) { setProofMsg("Use JPG, PNG, or WebP images for activity proof."); return; }
    setProofBusy(true); setProofMsg("");
    const uploaded = [];
    const failed = [];
    try {
      const act = await getOrCreateActivity();
      for (const [index, file] of files.entries()) {
        let uploadedPath = "";
        try {
          const compressed = await compressImage(file);
          const path = `${account.group_id}/${act.id}/group-proof-${Date.now()}-${index}.webp`;
          uploadedPath = path;
          const { error: uploadError } = await supabase.storage.from("activity-evidence").upload(path, compressed, { contentType: "image/webp", upsert: false });
          if (uploadError) throw uploadError;
          const evidence = await recordActivityEvidence(act.id, null, path, file.name, compressed.size);
          const { data } = await supabase.storage.from('activity-evidence').createSignedUrl(path, 600);
          uploaded.push({ id: evidence.id, storage_path: path, created_at: evidence.created_at, original_name: file.name, previewUrl: data?.signedUrl || '' });
        } catch {
          if (uploadedPath) await supabase.storage.from("activity-evidence").remove([uploadedPath]).catch(() => {});
          failed.push(file.name || 'image');
        }
      }
      if (uploaded.length) {
        setGroupProofs((current) => [...uploaded, ...current].sort((left, right) => String(right.created_at || '').localeCompare(String(left.created_at || ''))));
        if (forScoreEdit) setEditGroupProofId(uploaded[uploaded.length - 1].id);
        setProofMsg(`${uploaded.length} group proof image${uploaded.length === 1 ? '' : 's'} uploaded${failed.length ? `; ${failed.length} could not be uploaded` : ''}.`);
      } else {
        setProofMsg(`No group proof images were uploaded. ${failed[0] || 'Please try again.'}`);
      }
    } catch (err) {
      setProofMsg(err?.message || "Proof upload failed.");
    } finally { setProofBusy(false); }
  }

  function setScore(memberId, val) {
    if (!canEdit) return;
    const num = Math.max(0, Math.min(Number(val) || 0, maxScore));
    setScores({ ...scores, [memberId]: num });
  }

  async function confirmSave() {
    if (!canEdit) return;
    const scoredMembers = members.filter((member) => Number(scores[member.id] || 0) > 0);
    if (!scoredMembers.length) {
      setError("Enter at least one score above zero. Students without a score will remain unsubmitted for this activity.");
      return;
    }
    if (!groupProofs.length) {
      setError("Upload at least one clear group proof image before submitting scores.");
      return;
    }
    setSaving(true);
    setError("");
    let act;
    try {
      act = await getOrCreateActivity();
    } catch (err) {
      setError("Failed to prepare this activity: " + (err.message || "try again"));
      setSaving(false);
      return;
    }
    const records = scoredMembers.map((m) => ({
      group_member_id: m.id, activity_id: act.id, classroom_id: account.classroom_id, group_id: account.group_id,
      score: Number(scores[m.id]), encoded_by: user.id,
    }));
    try {
      await db.entities.ActivityScore.bulkCreate(records);
      setLocked(true);
      setLockedActivities({ ...lockedActivities, [activityNum]: true });
      setShowConfirm(false);
    } catch (err) {
      setError("Failed to save: " + (err.message || "some scores may already exist"));
    }
    setSaving(false);
  }

  async function requestEdits() {
    const changed = Object.values(existingScores).filter((saved) => (
      Number(scores[saved.group_member_id]) !== Number(saved.score)
      && editRequests[saved.id]?.status !== 'pending'
    ));
    if (!changed.length) { setError("Change a saved score before requesting teacher approval."); return; }
    if (!editGroupProofId) {
      setError("Upload one new group proof before requesting approval. A score change cannot be sent without fresh proof.");
      return;
    }
    setRequestingEdits(true); setError("");
    try {
      const outcomes = await Promise.allSettled(changed.map((saved) =>
        requestActivityScoreEdit(saved.id, Number(scores[saved.group_member_id]), editGroupProofId),
      ));
      const successful = outcomes
        .map((outcome, index) => ({ outcome, saved: changed[index] }))
        .filter(({ outcome }) => outcome.status === 'fulfilled');
      if (successful.length) {
        setEditRequests((current) => ({ ...current, ...Object.fromEntries(successful.map(({ saved, outcome }) => [saved.id, outcome.value || { status: 'pending' }])) }));
      }
      const failed = outcomes.filter((outcome) => outcome.status === 'rejected');
      if (!failed.length) setEditGroupProofId(null);
      if (failed.length) {
        setError(`${successful.length} request${successful.length === 1 ? '' : 's'} sent. ${failed.length} still need attention: ${failed[0].reason?.message || 'please try again'}`);
      } else {
        setProofMsg(`${successful.length} score edit request${successful.length === 1 ? '' : 's'} sent to your teacher for approval.`);
      }
    } catch (err) {
      setError(err?.message || "Could not request the score edit.");
    } finally { setRequestingEdits(false); }
  }

  if (!account) return <div className="flex items-center justify-center py-20"><div className="w-8 h-8 border-4 border-clay-purple border-t-transparent rounded-full animate-spin" /></div>;

  return (
    <div className="mx-auto max-w-5xl space-y-5 sm:space-y-6">
      <section className="grid gap-4 lg:grid-cols-[1fr_minmax(290px,.75fr)] lg:items-center">
        <div>
          <p className="text-sm font-semibold text-[var(--uc-purple)]">Activity submission</p>
          <h1 className="uc-page-title mt-1 text-3xl sm:text-4xl">Activity scores</h1>
          <p className="mt-1 text-sm leading-relaxed text-ink/60">Upload one clear group proof, record the group’s scores carefully, then submit once.</p>
        </div>
        <NovaMessage variant="learning" tone="blue" title="Proof first, then scores.">A clear photo keeps your group’s work easy to review.</NovaMessage>
      </section>

      {!canEdit && (
        <ClayCard color="sun" className="p-4 flex items-center gap-3">
          <Lock className="w-5 h-5 shrink-0" />
          <p className="text-sm font-display font-bold">Only your group representative can submit activity scores. You're viewing saved scores.</p>
        </ClayCard>
      )}

      <ClayCard className="p-4 sm:p-5">
        <div className="mb-3 flex items-center gap-3"><UIAsset name="activities" className="h-11 w-11" /><div><label className="block font-display text-lg font-extrabold text-[var(--uc-navy-950)]">Choose an activity</label><p className="text-xs text-ink/60">The newest activities appear first.</p></div></div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {assignedActivities.map((assigned) => { const n = assigned.activity_number;
            const isLocked = lockedActivities[n];
            const isSelected = activityNum === n;
            return (
              <button key={n} onClick={() => setActivityNum(n)}
                title={assigned.title || `Activity ${n}`}
                className={`clay-btn h-16 w-full justify-center px-3 text-sm relative truncate ${isSelected ? "bg-clay-purple text-white" : isLocked ? "bg-ink/10 text-ink/40" : "bg-white text-ink"}`}>
                {isLocked && <Lock className="w-3 h-3 absolute top-0.5 right-0.5" />}
                {assigned.title || `Activity ${n}`}
              </button>
            );
          })}
        </div>
      </ClayCard>

      {activity && <GroupProofHistory proofs={groupProofs} />}

      {locked ? (
        <>
          <ClayCard color="coral" className="p-5 text-center">
            <Lock className="w-9 h-9 mx-auto mb-2" />
            <p className="font-display font-bold text-lg">Activity {activityNum} is submitted</p>
            <p className="text-white/80 text-sm">Saved scores stay protected. Representatives may request a correction for teacher approval.</p>
          </ClayCard>
          {canEdit && (
            <ClayCard color="sky" className="p-4">
              <p className="font-display font-bold">New group proof for this edit</p>
              <p className="mt-1 text-xs text-ink/60">Select one or more current photos of the group’s work. The newest image supports every changed score in this request.</p>
              <label className={`clay-btn mt-3 w-full justify-center bg-clay-sky text-ink ${proofBusy ? "pointer-events-none opacity-60" : "cursor-pointer"}`}>
                {proofBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : editGroupProofId ? "New group proof ready" : "Add new group proof images"}
                <input type="file" accept="image/jpeg,image/png,image/webp" multiple className="hidden" disabled={proofBusy} onChange={(e) => { uploadGroupProofs(e.target.files, true); e.target.value = ""; }} />
              </label>
            </ClayCard>
          )}
          <div className="space-y-2">
            {members.filter((member) => existingScores[member.id]).map((member) => {
              const saved = existingScores[member.id]; const request = editRequests[saved.id]; const pendingRequest = request?.status === 'pending';
              return (
                <ClayCard key={member.id} className="p-3 flex flex-wrap items-center gap-3">
                  <UserAvatar name={`${member.last_name}-${member.first_name}`} size="sm" />
                  <p className="min-w-0 flex-1 truncate font-display font-bold text-sm">{member.last_name}, {member.first_name}</p>
                  <input aria-label={`Proposed score for ${member.first_name}`} type="number" min="0" max={maxScore} disabled={!canEdit || !!pendingRequest} className="clay-input w-20 py-1.5 text-center font-mono" value={scores[member.id] ?? ""} onChange={(event) => setScore(member.id, event.target.value)} />
                  <span className="text-xs font-mono text-ink/50">/ {maxScore}</span>
                  {pendingRequest && <span className="text-[10px] font-display font-bold text-clay-purple">Teacher review pending</span>}
                  {request?.status === 'approved' && <span className="text-[10px] font-display font-bold text-clay-lime">Approved</span>}
                  {request?.status === 'rejected' && <span className="text-[10px] font-display font-bold text-clay-coral">Not approved — revise and send fresh proof</span>}
                </ClayCard>
              );
            })}
          </div>
          {canEdit && (
            <>
              {proofMsg && <p className={`text-sm font-display font-bold ${proofMsg.includes("uploaded") ? "text-clay-lime" : "text-clay-coral"}`}>{proofMsg}</p>}
              {error && <p className="text-clay-coral font-display font-bold text-sm">{error}</p>}
              <ClayButton color="purple" size="md" className="w-full" disabled={requestingEdits} onClick={requestEdits}>{requestingEdits ? "Sending request..." : "Request score edit"}</ClayButton>
              <p className="text-xs text-ink/55">One new group proof supports every changed score. Pending scores stay protected until your teacher approves or declines them.</p>
            </>
          )}
        </>
      ) : !canEdit ? (
        <ClayCard className="p-6 text-center">
          <p className="text-ink/60 text-sm">No scores submitted yet for Activity {activityNum}.</p>
        </ClayCard>
      ) : (
        <>
          {!activity && (
            <ClayCard className="p-4">
              <label className="font-display font-bold text-sm mb-1 block">Max Score for Activity {activityNum}</label>
              <input type="number" min="1" className="clay-input" value={maxScore} onChange={(e) => setMaxScore(Number(e.target.value))} />
            </ClayCard>
          )}
          <ClayCard color="sky" className="p-4">
            <p className="font-display font-bold">Proof images for the whole group</p>
            <p className="mt-1 text-xs text-ink/60">Select one or more clear photos of the group’s completed work, then enter each member’s score below.</p>
            <label className={`clay-btn mt-3 w-full justify-center bg-clay-sky text-ink ${proofBusy ? "pointer-events-none opacity-60" : "cursor-pointer"}`}>
              {proofBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : groupProofs.length ? `Add more images (${groupProofs.length})` : "Upload group proof images"}
              <input type="file" accept="image/jpeg,image/png,image/webp" multiple className="hidden" disabled={proofBusy} onChange={(e) => { uploadGroupProofs(e.target.files); e.target.value = ""; }} />
            </label>
          </ClayCard>
          <div className="space-y-3">
            {members.map((m) => (
              <ClayCard key={m.id} className="p-4 flex items-center gap-3">
                <UserAvatar name={`${m.last_name}-${m.first_name}`} size="sm" />
                <div className="flex-1"><p className="font-display font-bold">{m.last_name}, {m.first_name}</p><p className="text-xs font-bold text-ink/55">Covered by the group proof</p></div>
                <div className="flex items-center gap-2">
                  <input type="number" min="0" max={maxScore} className="clay-input w-20 text-center font-mono text-lg" value={scores[m.id] ?? ""} onChange={(e) => setScore(m.id, e.target.value)} />
                  <span className="font-mono text-ink/50">/ {maxScore}</span>
                </div>
              </ClayCard>
            ))}
          </div>
          {proofMsg && <p className={`text-sm font-display font-bold ${proofMsg.includes("uploaded") ? "text-clay-lime" : "text-clay-coral"}`}>{proofMsg}</p>}
          {error && <p className="text-clay-coral font-display font-bold text-sm">{error}</p>}
          <ClayButton color="pink" size="lg" className="w-full" onClick={() => setShowConfirm(true)}>Submit Scores</ClayButton>
        </>
      )}

      {showConfirm && (
        <div className="fixed inset-0 z-50 bg-ink/50 flex items-center justify-center p-4" onClick={() => setShowConfirm(false)}>
          <ClayCard className="p-6 max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
            <div className="text-center">
              <div className="inline-flex w-14 h-14 rounded-full bg-clay-coral border-[3px] border-ink items-center justify-center mb-3">
                <AlertTriangle className="w-7 h-7 text-white" />
              </div>
              <h2 className="font-display font-bold text-lg">Are you sure?</h2>
              <p className="text-ink/70 text-sm mt-1">Only members with a score above zero will be submitted. Scores can later be corrected only after teacher approval.</p>
            </div>
            <div className="flex gap-3 mt-5">
              <ClayButton color="cream" className="flex-1" onClick={() => setShowConfirm(false)}>Cancel</ClayButton>
              <ClayButton color="coral" className="flex-1" onClick={confirmSave} disabled={saving}>{saving ? "Saving..." : "Confirm & Lock"}</ClayButton>
            </div>
          </ClayCard>
        </div>
      )}
    </div>
  );
}

function GroupProofHistory({ proofs }) {
  return (
    <ClayCard color="cream" className="p-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div><p className="font-display font-bold">Group proof history</p><p className="mt-1 text-xs text-ink/60">Shared with every group member. Open an image to inspect it.</p></div>
        <span className="rounded-full bg-white px-2.5 py-1 text-xs font-display font-bold text-ink/65">{proofs.length} image{proofs.length === 1 ? '' : 's'}</span>
      </div>
      {proofs.length === 0 ? (
        <p className="mt-3 rounded-xl border border-dashed border-ink/15 bg-white/60 px-3 py-3 text-xs text-ink/55">No group proof images have been uploaded for this activity yet.</p>
      ) : (
        <div className="mt-3 grid w-fit max-w-full grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
          {proofs.map((proof) => <a key={proof.id} href={proof.previewUrl || undefined} target="_blank" rel="noreferrer" className="group w-20 overflow-hidden rounded-xl border border-ink/10 bg-white transition-transform hover:-translate-y-0.5 sm:w-24">
            <div className="aspect-square bg-ink/5">{proof.previewUrl ? <img src={proof.previewUrl} alt={proof.original_name || 'Group activity proof'} className="h-full w-full object-cover" loading="lazy" /> : <div className="flex h-full items-center justify-center px-2 text-center text-[10px] text-ink/50">Preview unavailable</div>}</div>
            <div className="p-1.5"><p className="truncate text-[10px] font-display font-bold text-ink">{proof.original_name || 'Group proof'}</p><p className="mt-0.5 text-[9px] text-ink/50">{proof.created_at ? new Date(proof.created_at).toLocaleString() : 'Just uploaded'}</p></div>
          </a>)}
        </div>
      )}
    </ClayCard>
  );
}

function compressImage(file) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);
    image.onload = () => {
      const max = 1280;
      const scale = Math.min(1, max / Math.max(image.width, image.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => { URL.revokeObjectURL(url); blob ? resolve(blob) : reject(new Error("Could not compress image")); }, "image/webp", 0.72);
    };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Could not read image")); };
    image.src = url;
  });
}
