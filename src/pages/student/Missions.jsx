
const db = globalThis.__B44_DB__;

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/AuthContext";
import { ACTIVE_CLASS_CHANGED_EVENT, getActiveStudentAccount } from "@/lib/studentContext";
import { getClassroomDataset } from '@/lib/teacherClassroom';
import { supabase } from '@/api/supabaseClient';
import { computeClassification } from '@/lib/classification';
import { computeActivityPct, computeAttendanceRate, computeCategoryPct, computeParticipationPoints } from '@/lib/stats';

import ClayButton from "@/components/ClayButton";
import ClayCard from "@/components/ClayCard";
import ClayChip from "@/components/ClayChip";
import { Target, Zap, Loader2, Rocket, History } from "lucide-react";
import MissionAssessment from "@/components/student/MissionAssessment";
import { ROUTES } from '@/lib/routes';
import MascotWidget from "@/components/MascotWidget";
import { completeLearningReview, redeemMissionPoints } from '@/lib/secureActions';
import { missionTargetsClass } from '@/lib/missionAudience';

export default function StudentMissions() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [redeemAmt, setRedeemAmt] = useState("");
  const [redeeming, setRedeeming] = useState(false);
  const [msg, setMsg] = useState(null);
  const [historyMissionId, setHistoryMissionId] = useState(null);

  useEffect(() => {
    load();
    const refresh = () => load();
    window.addEventListener(ACTIVE_CLASS_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(ACTIVE_CLASS_CHANGED_EVENT, refresh);
  }, [user]);

  async function load() {
    if (!user) return;
    const account = await getActiveStudentAccount(user.id);
    if (!account) { navigate(ROUTES.STUDENT.ONBOARDING); return; }
    const group = await db.entities.Group.get(account.group_id);
    const classroomId = group.classroom_id;
    const [missionResult, subs, members, logs, reviews, classData] = await Promise.all([
      supabase.rpc('get_student_missions', { p_classroom_id: classroomId }),
      db.entities.MissionSubmission.filter({ classroom_id: classroomId, group_member_id: account.group_member_id }),
      db.entities.GroupMember.filter({ group_id: group.id }),
      db.entities.ParticipationLog.filter({ classroom_id: classroomId, group_id: group.id, group_member_id: account.group_member_id }),
      db.entities.LearningReview.filter({ user_id: user.id }, { orderBy: 'next_review_at', ascending: true, limit: 20 }),
      getClassroomDataset(classroomId, ['members', 'settings', 'terms', 'attendance', 'scores', 'activities', 'assessments', 'logs']),
    ]);
    if (missionResult.error) throw missionResult.error;
    const missions = missionResult.data || [];
    const currentMember = classData.members.find((member) => member.id === account.group_member_id);
    const term = classData.terms.find((item) => item.is_active) || classData.terms[0];
    const pointTotals = classData.members.map((member) => computeParticipationPoints(member.id, classData.logs));
    const maxPoints = Math.max(...pointTotals, 1);
    const attendance = currentMember ? computeAttendanceRate(currentMember.id, classData.attendance, term) : { rate: 0, count: 0 };
    const activity = currentMember ? computeActivityPct(currentMember.id, classData.scores, classData.activities) : { pct: 0, count: 0 };
    const quiz = currentMember ? computeCategoryPct(currentMember.id, classData.assessments, 'quiz', term) : { pct: 0, count: 0 };
    const exam = currentMember ? computeCategoryPct(currentMember.id, classData.assessments, 'major_exam', term) : { pct: 0, count: 0 };
    const performance = currentMember ? computeCategoryPct(currentMember.id, classData.assessments, 'performance_task', term) : { pct: 0, count: 0 };
    const points = currentMember ? computeParticipationPoints(currentMember.id, classData.logs) : 0;
    const classification = computeClassification([
      { key: 'attendance_rate', value: attendance.rate, count: attendance.count },
      { key: 'activity_score_pct', value: activity.pct, count: activity.count },
      { key: 'quiz_pct', value: quiz.pct, count: quiz.count },
      { key: 'major_exam_pct', value: exam.pct, count: exam.count },
      { key: 'performance_task_pct', value: performance.pct, count: performance.count },
      { key: 'participation_normalized', value: (points / maxPoints) * 100, count: points > 0 ? 1 : 0 },
    ], classData.settings[0]);
    const active = missions.filter((m) => {
      const reachesClass = missionTargetsClass(m, classroomId);
      const statuses = m.target_statuses?.length ? m.target_statuses : ['On Track', 'Developing', 'At Risk'];
      return reachesClass && statuses.includes(classification.tag);
    });
    const earned = subs.reduce((s, x) => s + (x.xp_earned || 0), 0);
    const redeemed = logs.filter((l) => l.event_type === "mission_redemption").reduce((s, l) => s + (l.xp_spent || 0), 0);
    const available = Math.max(0, earned - redeemed);
    const dueReviews = reviews.filter((review) => new Date(review.next_review_at) <= new Date());
    setData({ account, group, missions, active, subs, members, earned, redeemed, available, dueReviews, classification });
  }

  async function redeem(e) {
    e.preventDefault();
    const amt = Number(redeemAmt);
    if (!amt || amt < 10 || amt % 10 !== 0 || amt > data.available) {
      setMsg({ ok: false, text: "Redeem a multiple of 10 XP, up to your available balance." });
      return;
    }
    setRedeeming(true);
    setMsg(null);
    try {
      const result = await redeemMissionPoints(amt, data.account.classroom_id);
      setRedeemAmt("");
      setMsg({ ok: true, text: `Redeemed ${amt} XP for ${result.pointsAwarded} participation point${result.pointsAwarded === 1 ? "" : "s"}!` });
      load();
    } catch (err) { setMsg({ ok: false, text: err.message || "Could not redeem XP." }); }
    setRedeeming(false);
    setTimeout(() => setMsg(null), 3000);
  }

  async function markReviewed(review, correct) {
    await completeLearningReview(review.id, correct);
    setData((current) => ({ ...current, dueReviews: current.dueReviews.filter((item) => item.id !== review.id) }));
  }

  if (!data) return <div className="flex items-center justify-center py-20"><div className="w-8 h-8 border-4 border-clay-purple border-t-transparent rounded-full animate-spin" /></div>;

  const { group, active, subs, earned, redeemed, available, dueReviews, classification } = data;
  const completedMissions = active.filter((m) => subs.find((s) => s.mission_id === m.id));
  const currentMissions = active.filter((m) => !subs.find((s) => s.mission_id === m.id));
  const gradedCount = completedMissions.length;

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      <div className="flex items-center gap-3">
        <MascotWidget state="quest" size="md" />
        <div>
        <h1 className="text-2xl font-display font-extrabold mb-1 flex items-center gap-2"><Target className="w-6 h-6" /> Group Missions</h1>
        <p className="text-ink/60 text-sm">Nova&apos;s quests earn XP, then turn it into participation points.</p>
        <p className="text-xs text-ink/50 mt-1">Your current learning status: {classification.tag}</p>
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
            <p className="text-xs text-white/70">{`Earned ${earned} XP - Redeemed ${redeemed} XP · 10 XP = 1 point`}</p>
          </div>
        </div>
        <form onSubmit={redeem} className="mt-4 flex gap-2">
          <input type="number" min="10" step="10" max={available} className="clay-input font-mono flex-1" placeholder="XP to redeem (10 at a time)" value={redeemAmt} onChange={(e) => setRedeemAmt(e.target.value)} />
          <ClayButton type="submit" color="lime" size="md" disabled={redeeming || available <= 0}>
            {redeeming ? <Loader2 className="w-4 h-4 animate-spin" /> : "Redeem"}
          </ClayButton>
        </form>
        {available > 0 && (
          <button type="button" onClick={() => setRedeemAmt(String(Math.floor(available / 10) * 10))} className="text-xs text-white/80 underline mt-1">{`Use ${Math.floor(available / 10) * 10} XP`}</button>
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
        {currentMissions.length === 0 ? (
          <div className="flex items-center gap-3 rounded-xl border-2 border-ink bg-clay-sky/30 p-3"><MascotWidget state="waiting" size="sm" /><p className="text-ink/60 text-sm">Nova is watching for the next quest. Check back when your teacher posts one.</p></div>
        ) : (
          <div className="space-y-3">
            {currentMissions.map((m) => {
              const sub = subs.find((s) => s.mission_id === m.id);
              const isAi = m.formative_type && m.formative_type !== "manual";
              let questionMax = m.max_score;
              if (isAi && m.formative_type !== 'drag_drop') {
                try { questionMax = JSON.parse(m.ai_content || '{}').questions?.length || m.max_score; } catch {}
              }
              const header = (
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-display font-bold">{m.title}</p>
                    {m.description && <p className="text-xs text-ink/60 mt-0.5">{m.description}</p>}
                    <div className="flex flex-wrap gap-2 mt-2">
                      <ClayChip color="sun">{`+${m.xp_reward} XP`}</ClayChip>
                      <ClayChip color="purple">{`/${questionMax} questions`}</ClayChip>
                      {m.deadline && <ClayChip color="sky">{`Due ${m.deadline}`}</ClayChip>}
                      {isAi && <ClayChip color="purple">{m.formative_type.replace("_", " ")}</ClayChip>}
                    </div>
                  </div>
                  {sub ? <ClayChip color="lime">{`${sub.score}/${questionMax} -> ${sub.xp_earned} XP`}</ClayChip> : <ClayChip color="sun">To do</ClayChip>}
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

      {completedMissions.length > 0 && (
        <div>
          <h2 className="font-display font-bold text-lg mb-2 flex items-center gap-2"><History className="w-5 h-5" /> Mission History</h2>
          <p className="text-xs text-ink/60 mb-2">Open a completed mission anytime to review your answers and feedback.</p>
          <div className="space-y-2">
            {completedMissions.map((m) => {
              const sub = subs.find((s) => s.mission_id === m.id);
              const isAi = m.formative_type && m.formative_type !== "manual";
              let questionMax = m.max_score;
              if (isAi && m.formative_type !== 'drag_drop') {
                try { questionMax = JSON.parse(m.ai_content || '{}').questions?.length || m.max_score; } catch {}
              } else if (isAi && m.formative_type === 'drag_drop') {
                try { questionMax = JSON.parse(m.ai_content || '{}').left?.length || m.max_score; } catch {}
              }
              const expanded = historyMissionId === m.id;
              return <div key={m.id} className="space-y-2">
                <ClayCard className="p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0"><p className="font-display font-bold truncate">{m.title}</p><p className="text-xs text-ink/55">{isAi ? 'AI formative assessment' : 'Teacher-graded mission'}{m.deadline ? ` · Due ${m.deadline}` : ''}</p></div>
                    <div className="flex items-center gap-2 shrink-0"><ClayChip color="lime">{sub.score}/{questionMax}</ClayChip><ClayButton type="button" size="sm" color="sky" onClick={() => setHistoryMissionId(expanded ? null : m.id)}>{expanded ? 'Close' : isAi ? 'Review' : 'View'}</ClayButton></div>
                  </div>
                </ClayCard>
                {expanded && (isAi ? <MissionAssessment mission={m} group={group} userId={user.id} existing={sub} onDone={load} /> : <ClayCard className="p-3"><p className="text-sm font-display font-bold">Completed</p><p className="text-xs text-ink/60 mt-1">This mission is teacher-graded. Ask your teacher for written feedback or a score review.</p></ClayCard>)}
              </div>;
            })}
          </div>
        </div>
      )}
    </div>
  );
}
