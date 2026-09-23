
const db = globalThis.__B44_DB__;

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/AuthContext";
import { getActiveStudentAccount } from "@/lib/studentContext";
import { supabase } from "@/api/supabaseClient";
import { ensureGroupActivity, recordActivityEvidence } from "@/lib/secureActions";

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
  const [evidenceByMember, setEvidenceByMember] = useState({});

  useEffect(() => {
    async function load() {
      if (!user) return;
      const a = await getActiveStudentAccount(user.id);
      if (!a) return;
      setAccount(a);
      const [mem, allScores, activities] = await Promise.all([
        db.entities.GroupMember.filter({ group_id: a.group_id }),
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
        const [existing, evidence] = await Promise.all([
          db.entities.ActivityScore.filter({ activity_id: acts[0].id, group_id: account.group_id }),
          db.entities.ActivityEvidence.filter({ activity_id: acts[0].id, group_id: account.group_id }),
        ]);
        setLocked(existing.length > 0);
        setEvidenceByMember(Object.fromEntries(evidence.map((item) => [item.group_member_id, item])));
      } else {
        setActivity(null);
        setLocked(false);
        setEvidenceByMember({});
      }
      setScores({});
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

  async function uploadProof(file, targetMemberId) {
    if (!file || !account || !targetMemberId) return;
    if (file.type && !/^image\/(jpeg|png|webp)$/i.test(file.type)) {
      setProofMsg("Use a JPG, PNG, or WebP image for activity proof.");
      return;
    }
    setProofBusy(true); setProofMsg("");
    let uploadedPath = "";
    try {
      const compressed = await compressImage(file);
      const act = await getOrCreateActivity();
      const memberForProof = targetMemberId;
      const path = `${account.group_id}/${act.id}/${memberForProof}-${Date.now()}.webp`;
      uploadedPath = path;
      const { error: uploadError } = await supabase.storage.from("activity-evidence").upload(path, compressed, { contentType: "image/webp", upsert: false });
      if (uploadError) throw uploadError;
      await recordActivityEvidence(act.id, memberForProof, path, file.name, compressed.size);
      setEvidenceByMember((current) => ({ ...current, [memberForProof]: { storage_path: path } }));
      setProofMsg(`Proof uploaded and compressed to ${Math.round(compressed.size / 1024)} KB.`);
    } catch (err) {
      if (uploadedPath) {
        await supabase.storage.from("activity-evidence").remove([uploadedPath]).catch(() => {});
      }
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
    const missingProofs = members.filter((m) => !evidenceByMember[m.id]);
    if (missingProofs.length > 0) {
      setError(`Upload activity proof for ${missingProofs.length} member${missingProofs.length === 1 ? "" : "s"} before submitting scores.`);
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
    const records = members.map((m) => ({
      group_member_id: m.id, activity_id: act.id, classroom_id: account.classroom_id, group_id: account.group_id,
      score: scores[m.id] || 0, encoded_by: user.id,
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

  if (!account) return <div className="flex items-center justify-center py-20"><div className="w-8 h-8 border-4 border-clay-purple border-t-transparent rounded-full animate-spin" /></div>;

  return (
    <div className="mx-auto max-w-5xl space-y-5 sm:space-y-6">
      <section className="grid gap-4 lg:grid-cols-[1fr_minmax(290px,.75fr)] lg:items-center">
        <div>
          <p className="text-sm font-semibold text-[var(--uc-purple)]">Activity submission</p>
          <h1 className="uc-page-title mt-1 text-3xl sm:text-4xl">Activity scores</h1>
          <p className="mt-1 text-sm leading-relaxed text-ink/60">Upload proof for every group member, record scores carefully, then submit once.</p>
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
        <div className="mb-3 flex items-center gap-3"><UIAsset name="assessment" className="h-11 w-11" /><div><label className="block font-display text-lg font-extrabold text-[var(--uc-navy-950)]">Choose an activity</label><p className="text-xs text-ink/60">The newest activities appear first.</p></div></div>
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

      {locked ? (
        <ClayCard color="coral" className="p-6 text-center">
          <Lock className="w-10 h-10 mx-auto mb-2" />
          <p className="font-display font-bold text-lg">Activity {activityNum} is locked</p>
          <p className="text-white/80 text-sm">This activity has already been submitted and cannot be edited.</p>
        </ClayCard>
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
          <div className="space-y-3">
            {members.map((m) => (
              <ClayCard key={m.id} className="p-4 flex items-center gap-3">
                <UserAvatar name={`${m.last_name}-${m.first_name}`} size="sm" />
                <div className="flex-1"><p className="font-display font-bold">{m.last_name}, {m.first_name}</p><p className={`text-xs font-bold ${evidenceByMember[m.id] ? "text-clay-lime" : "text-clay-coral"}`}>{evidenceByMember[m.id] ? "Proof uploaded" : "Proof required"}</p></div>
                <label className={`clay-btn bg-clay-sky text-ink px-2 py-2 text-xs cursor-pointer ${proofBusy ? "opacity-60 pointer-events-none" : ""}`}>{proofBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Upload proof"}<input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" disabled={proofBusy} onChange={(e) => { uploadProof(e.target.files?.[0], m.id); e.target.value = ""; }} /></label>
                <div className="flex items-center gap-2">
                  <input type="number" min="0" max={maxScore} className="clay-input w-20 text-center font-mono text-lg" value={scores[m.id] ?? ""} onChange={(e) => setScore(m.id, e.target.value)} />
                  <span className="font-mono text-ink/50">/ {maxScore}</span>
                </div>
              </ClayCard>
            ))}
          </div>
          {proofMsg && <p className={`text-sm font-display font-bold ${proofMsg.startsWith("Proof uploaded") ? "text-clay-lime" : "text-clay-coral"}`}>{proofMsg}</p>}
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
              <p className="text-ink/70 text-sm mt-1">Activity {activityNum} scores <strong>cannot be edited</strong> after you submit. Double-check every score.</p>
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
