
const db = globalThis.__B44_DB__;

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/AuthContext";
import { getActiveStudentAccount } from "@/lib/studentContext";
import { supabase } from "@/api/supabaseClient";

import ClayButton from "@/components/ClayButton";
import ClayCard from "@/components/ClayCard";
import { FileText, Lock, AlertTriangle, ImagePlus, Loader2 } from "lucide-react";

export default function StudentScores() {
  const { user } = useAuth();
  const [account, setAccount] = useState(null);
  const [members, setMembers] = useState([]);
  const [activityNum, setActivityNum] = useState(1);
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
  const [proofMemberId, setProofMemberId] = useState("");
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
      setProofMemberId(a.group_member_id || mem[0]?.id || "");
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

  async function uploadProof(file, targetMemberId = proofMemberId) {
    if (!file || !account) return;
    setProofBusy(true); setProofMsg("");
    let uploadedPath = "";
    try {
      const compressed = await compressImage(file);
      let act = activity;
      if (!act) {
        act = await db.entities.Activity.create({ classroom_id: account.classroom_id, activity_number: activityNum, title: `Activity ${activityNum}`, max_score: Number(maxScore) });
        setActivity(act);
      }
      const memberForProof = targetMemberId || account.group_member_id || user.id;
      const path = `${account.group_id}/${act.id}/${memberForProof}-${Date.now()}.webp`;
      uploadedPath = path;
      const { error: uploadError } = await supabase.storage.from("activity-evidence").upload(path, compressed, { contentType: "image/webp", upsert: false });
      if (uploadError) throw uploadError;
      const { error: rowError } = await supabase.from("activity_evidence").insert({
        classroom_id: account.classroom_id, group_id: account.group_id, group_member_id: memberForProof,
        activity_id: act.id, uploaded_by: user.id, storage_path: path, original_name: file.name,
        file_size: compressed.size, mime_type: "image/webp",
      });
      if (rowError) throw rowError;
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
    let act = activity;
    if (!act) {
      act = await db.entities.Activity.create({
        classroom_id: account.classroom_id, activity_number: activityNum, title: `Activity ${activityNum}`, max_score: Number(maxScore),
      });
      setActivity(act);
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
    <div className="max-w-lg mx-auto space-y-5">
      <div>
        <h1 className="text-2xl font-display font-extrabold mb-1 flex items-center gap-2"><FileText className="w-6 h-6" /> Activity Scores</h1>
        <p className="text-ink/60">Scores are permanent once saved — no edits after.</p>
      </div>

      {!canEdit && (
        <ClayCard color="sun" className="p-4 flex items-center gap-3">
          <Lock className="w-5 h-5 shrink-0" />
          <p className="text-sm font-display font-bold">Only your group representative can submit activity scores. You're viewing saved scores.</p>
        </ClayCard>
      )}

      <ClayCard className="p-4">
        <label className="font-display font-bold text-sm mb-2 block">Activity Number</label>
        <div className="grid grid-cols-5 sm:grid-cols-10 gap-2">
          {Array.from({ length: 20 }, (_, i) => i + 1).map((n) => {
            const isLocked = lockedActivities[n];
            const isSelected = activityNum === n;
            return (
              <button key={n} onClick={() => setActivityNum(n)}
                className={`clay-btn px-1 py-2 text-sm relative ${isSelected ? "bg-clay-pink text-white" : isLocked ? "bg-ink/10 text-ink/40" : "bg-cream text-ink"}`}>
                {isLocked && <Lock className="w-3 h-3 absolute top-0.5 right-0.5" />}
                {n}
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
                <div className="flex-1"><p className="font-display font-bold">{m.last_name}, {m.first_name}</p><p className={`text-xs font-bold ${evidenceByMember[m.id] ? "text-clay-lime" : "text-clay-coral"}`}>{evidenceByMember[m.id] ? "Proof uploaded" : "Proof required"}</p></div>
                {(canEdit || m.id === account.group_member_id) && <label className="clay-btn bg-clay-sky text-ink px-2 py-2 text-xs cursor-pointer">Upload proof<input type="file" accept="image/*" className="hidden" disabled={proofBusy} onChange={(e) => { uploadProof(e.target.files?.[0], m.id); e.target.value = ""; }} /></label>}
                <div className="flex items-center gap-2">
                  <input type="number" min="0" max={maxScore} className="clay-input w-20 text-center font-mono text-lg" value={scores[m.id] ?? ""} onChange={(e) => setScore(m.id, e.target.value)} />
                  <span className="font-mono text-ink/50">/ {maxScore}</span>
                </div>
              </ClayCard>
            ))}
          </div>
          {error && <p className="text-clay-coral font-display font-bold text-sm">{error}</p>}
          <ClayButton color="pink" size="lg" className="w-full" onClick={() => setShowConfirm(true)}>Submit Scores</ClayButton>
        </>
      )}

      {(activity || canEdit) && (
        <ClayCard className="p-4">
          <div className="flex items-center gap-2 mb-1"><ImagePlus className="w-5 h-5" /><p className="font-display font-bold">Activity proof</p></div>
          <p className="text-xs text-ink/60 mb-3">Upload a photo of the completed activity. Images are automatically resized and converted to a small WebP file.</p>
          {canEdit && <div className="mb-3"><label className="font-display font-bold text-xs mb-1 block">Proof belongs to</label><select className="clay-input" value={proofMemberId} onChange={(e) => setProofMemberId(e.target.value)}>{members.map((m) => <option key={m.id} value={m.id}>{m.last_name}, {m.first_name}</option>)}</select></div>}
          <label className={`clay-btn bg-clay-sky text-ink w-full justify-center cursor-pointer ${proofBusy ? "opacity-60 pointer-events-none" : ""}`}>
            {proofBusy ? <><Loader2 className="w-4 h-4 animate-spin" /> Compressing…</> : <><ImagePlus className="w-4 h-4" /> Upload image</>}
            <input type="file" accept="image/*" className="hidden" disabled={proofBusy} onChange={(e) => { uploadProof(e.target.files?.[0]); e.target.value = ""; }} />
          </label>
          {proofMsg && <p className="mt-2 text-xs font-bold text-ink/70">{proofMsg}</p>}
        </ClayCard>
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
