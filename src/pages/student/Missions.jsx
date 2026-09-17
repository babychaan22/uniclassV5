
const db = globalThis.__B44_DB__;

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/AuthContext";
import { getActiveStudentAccount } from "@/lib/studentContext";

import ClayButton from "@/components/ClayButton";
import ClayCard from "@/components/ClayCard";
import ClayChip from "@/components/ClayChip";
import { Target, Zap, Loader2, Rocket } from "lucide-react";
import MissionAssessment from "@/components/student/MissionAssessment";
import { ROUTES } from '@/lib/routes';
import MascotWidget from "@/components/MascotWidget";
import { completeLearningReview, redeemMissionPoints } from '@/lib/secureActions';

export default function StudentMissions() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [redeemAmt, setRedeemAmt] = useState("");
  const [redeeming, setRedeeming] = useState(false);
  const [msg, setMsg] = useState(null);

  useEffect(() => { load(); }, [user]);

  async function load() {
    if (!user) return;
    const account = await getActiveStudentAccount(user.id);
    if (!account) { navigate(ROUTES.STUDENT.ONBOARDING); return; }
    const group = await db.entities.Group.get(account.group_id);
    const classroomId = group.classroom_id;
    const [missions, subs, members, logs, reviews] = await Promise.all([
      db.entities.Mission.filter({ is_active: true }),
      db.entities.MissionSubmission.filter({ classroom_id: classroomId, group_id: group.id }),
      db.entities.GroupMember.filter({ group_id: group.id }),
      db.entities.ParticipationLog.filter({ classroom_id: classroomId, group_id: group.id }),
      db.entities.LearningReview.filter({ user_id: user.id }, { orderBy: 'next_review_at', ascending: true, limit: 20 }),
    ]);
    const active = missions.filter((m) => m.classroom_id === classroomId || m.applies_to_all_classes);
    const earned = subs.reduce((s, x) => s + (x.xp_earned || 0), 0);
    const redeemed = logs.filter((l) => l.event_type === "mission_redemption").reduce((s, l) => s + (l.points_awarded || 0), 0);
    const available = Math.max(0, earned - redeemed);
    const dueReviews = reviews.filter((review) => new Date(review.next_review_at) <= new Date());
    setData({ account, group, missions, active, subs, members, earned, redeemed, available, dueReviews });
  }

  async function redeem(e) {
    e.preventDefault();
    const amt = Number(redeemAmt);
    if (!amt || amt <= 0 || amt > data.available) {
      setMsg({ ok: false, text: "Enter a valid XP amount up to your available balance." });
      return;
    }
    setRedeeming(true);
    setMsg(null);
    await redeemMissionPoints(amt);
    setRedeeming(false);
    setRedeemAmt("");
    setMsg({ ok: true, text: `Redeemed ${amt} XP into participation points!` });
    load();
    setTimeout(() => setMsg(null), 3000);
  }

  async function markReviewed(review, correct) {
    await completeLearningReview(review.id, correct);
    setData((current) => ({ ...current, dueReviews: current.dueReviews.filter((item) => item.id !== review.id) }));
  }

  if (!data) return <div className="flex items-center justify-center py-20"><div className="w-8 h-8 border-4 border-clay-purple border-t-transparent rounded-full animate-spin" /></div>;

  const { group, active, subs, earned, redeemed, available, dueReviews } = data;
  const gradedCount = active.filter((m) => subs.find((s) => s.mission_id === m.id)).length;

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      <div className="flex items-center gap-3">
        <MascotWidget state="quest" size="md" />
        <div>
        <h1 className="text-2xl font-display font-extrabold mb-1 flex items-center gap-2"><Target className="w-6 h-6" /> Group Missions</h1>
        <p className="text-ink/60 text-sm">Nova&apos;s quests earn XP, then turn it into participation points.</p>
        </div>
      </div>

      <ClayCard color="purple" className="p-5">
        <div className="flex items-center gap-4">
          <div className="clay-medallion bg-clay-sun w-16 h-16 flex items-center justify-center shrink-0">
            <Zap className="w-8 h-8 text-ink" />
          </div>
          <div className="flex-1 text-white">
            <p className="font-mono font-extrabold text-4xl leading-none">{available}</p>
            <p className="font-display font-bold text-sm">XP available to redeem</p>
            <p className="text-xs text-white/70">{`Earned ${earned} - Redeemed ${redeemed}`}</p>
          </div>
        </div>
        <form onSubmit={redeem} className="mt-4 flex gap-2">
          <input type="number" min="1" max={available} className="clay-input font-mono flex-1" placeholder="XP to redeem" value={redeemAmt} onChange={(e) => setRedeemAmt(e.target.value)} />
          <ClayButton type="submit" color="lime" size="md" disabled={redeeming || available <= 0}>
            {redeeming ? <Loader2 className="w-4 h-4 animate-spin" /> : "Redeem"}
          </ClayButton>
        </form>
        {available > 0 && (
          <button type="button" onClick={() => setRedeemAmt(String(available))} className="text-xs text-white/80 underline mt-1">{`Use all ${available} XP`}</button>
        )}
      </ClayCard>

      {msg && (
        <p className={`font-display font-bold text-sm text-center ${msg.ok ? "text-clay-lime" : "text-clay-coral"}`}>{msg.text}</p>
      )}

      {dueReviews?.length > 0 && (
        <ClayCard color="sky" className="p-4">
          <div className="flex items-center justify-between gap-3 mb-3">
            <div><p className="font-display font-bold">Review queue</p><p className="text-xs text-ink/60">Short practice helps the tricky parts stick.</p></div>
            <ClayChip color="sun">{dueReviews.length} due</ClayChip>
          </div>
          <div className="space-y-2">
            {dueReviews.slice(0, 5).map((review) => (
              <div key={review.id} className="rounded-xl border-2 border-ink/15 bg-cream p-3">
                <p className="text-sm font-display font-bold">{review.prompt_text}</p>
                <p className="text-[11px] text-ink/50 mt-1">{review.review_count ? `Reviewed ${review.review_count} time${review.review_count === 1 ? "" : "s"}` : "Needs a first review"}</p>
                <div className="flex gap-2 mt-2"><ClayButton size="sm" color="coral" onClick={() => markReviewed(review, false)}>Still tricky</ClayButton><ClayButton size="sm" color="lime" onClick={() => markReviewed(review, true)}>Got it</ClayButton></div>
              </div>
            ))}
          </div>
        </ClayCard>
      )}

      {active.length > 0 && (
        <ClayCard className="p-4">
          <div className="flex justify-between mb-2">
            <span className="font-display font-bold text-sm">Mission Progress</span>
            <span className="font-mono text-sm">{gradedCount}/{active.length} graded</span>
          </div>
          <div className="h-5 rounded-full border-2 border-ink bg-cream overflow-hidden">
            <div className="h-full bg-clay-lime" style={{ width: `${active.length ? (gradedCount / active.length) * 100 : 0}%` }} />
          </div>
          <p className="text-xs text-ink/60 mt-2">{gradedCount < active.length ? "Complete the remaining missions to earn more XP!" : "All active missions graded. Nice work!"}</p>
        </ClayCard>
      )}

      <div>
        <h2 className="font-display font-bold text-lg mb-2 flex items-center gap-2"><Rocket className="w-5 h-5" /> Active Missions</h2>
        {active.length === 0 ? (
          <div className="flex items-center gap-3 rounded-xl border-2 border-ink bg-clay-sky/30 p-3"><MascotWidget state="waiting" size="sm" /><p className="text-ink/60 text-sm">Nova is watching for the next quest. Check back when your teacher posts one.</p></div>
        ) : (
          <div className="space-y-3">
            {active.map((m) => {
              const sub = subs.find((s) => s.mission_id === m.id);
              const isAi = m.formative_type && m.formative_type !== "manual";
              const header = (
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-display font-bold">{m.title}</p>
                    {m.description && <p className="text-xs text-ink/60 mt-0.5">{m.description}</p>}
                    <div className="flex flex-wrap gap-2 mt-2">
                      <ClayChip color="sun">{`+${m.xp_reward} XP`}</ClayChip>
                      <ClayChip color="purple">{`/${m.max_score} max`}</ClayChip>
                      {m.deadline && <ClayChip color="sky">{`Due ${m.deadline}`}</ClayChip>}
                      {isAi && <ClayChip color="purple">{m.formative_type.replace("_", " ")}</ClayChip>}
                    </div>
                  </div>
                  {sub ? <ClayChip color="lime">{`${sub.score}/${m.max_score} -> ${sub.xp_earned} XP`}</ClayChip> : <ClayChip color="sun">To do</ClayChip>}
                </div>
              );
              if (isAi) {
                return (
                  <div key={m.id} className="space-y-2">
                    <ClayCard className="p-4"><div className="mb-3 flex items-center gap-2"><MascotWidget state="quest" size="sm" /><span className="text-xs font-display font-bold">Generated by UniClass AI Assistant</span></div>{m.image_url && <img src={m.image_url} alt={`${m.title} illustration`} className="mb-3 max-h-64 w-full rounded-xl border-2 border-ink object-cover" loading="lazy" />}{header}</ClayCard>
                    <MissionAssessment mission={m} group={group} userId={user.id} existing={sub} onDone={load} />
                  </div>
                );
              }
              return <ClayCard key={m.id} className="p-4">{header}</ClayCard>;
            })}
          </div>
        )}
      </div>
    </div>
  );
}
