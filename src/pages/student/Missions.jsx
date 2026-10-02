
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
import { Loader2, Rocket, History, Zap } from "lucide-react";
import MissionAssessment from "@/components/student/MissionAssessment";
import { ROUTES } from '@/lib/routes';
import MascotWidget from "@/components/MascotWidget";
import NovaEmptyState from "@/components/mascot/NovaEmptyState";
import NovaMessage from "@/components/NovaMessage";
import { UIAsset } from "@/components/visual/UIAsset";
import { completeLearningReview, ensureDailyPowerUp, redeemMissionPoints } from '@/lib/secureActions';
import { missionTargetsClass } from '@/lib/missionAudience';
import { formatMissionDeadline, isDailyFoundationMission, isMissionLocked, manilaDateKey } from '@/lib/missionProgress';

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
    // Materialise today's Daily Math Power-Up before reading the list, so a
    // student who has never opened the app still has one waiting.
    let powerUp = null;
    try {
      powerUp = await ensureDailyPowerUp(classroomId);
    } catch (err) {
      // A missing Power-Up must never block the teacher's missions from
      // loading, but the reason matters to the teacher who reports it.
      powerUp = null;
      console.warn('[power-up] not generated for today:', err?.message || err);
    }
    const [missionResult, subs, members, logs, reviews, classData] = await Promise.all([
      supabase.rpc('get_student_missions', { p_classroom_id: classroomId }),
      db.entities.MissionSubmission.filter({ classroom_id: classroomId, group_member_id: account.group_member_id }),
      db.entities.GroupMember.filter({ group_id: group.id }),
      db.entities.ParticipationLog.filter({ classroom_id: classroomId, group_id: group.id, group_member_id: account.group_member_id }),
      db.entities.LearningReview.filter({ user_id: user.id }, { orderBy: 'next_review_at', ascending: true, limit: 20 }),
      getClassroomDataset(classroomId, ['members', 'settings', 'terms', 'attendance', 'scores', 'activities', 'assessments', 'logs']),
    ]);
    if (missionResult.error) throw missionResult.error;
    const missions = [...(missionResult.data || [])];
    // A Power-Up generated after the RPC snapshot still belongs in today's list,
    // but only once a teacher has approved it. The engine creates it pending, so
    // an unapproved row must never reach the student's screen.
    if (powerUp && powerUp.approval_status === 'approved' && powerUp.is_active
      && !missions.some((m) => m.id === powerUp.id)) missions.unshift(powerUp);
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
    // The daily Power-Up is generated by UniClass, not by the teacher, and it
    // is rebuilt every day. It gets its own section instead of competing with
    // teacher-assigned work for attention.
    const powerUps = missions.filter(isDailyFoundationMission);
    const active = missions.filter((m) => {
      if (isDailyFoundationMission(m)) return false;
      const reachesClass = missionTargetsClass(m, classroomId);
      const statuses = m.target_statuses?.length ? m.target_statuses : ['On Track', 'Developing', 'At Risk'];
      return reachesClass && statuses.includes(classification.tag);
    });
    const earned = subs.reduce((s, x) => s + (x.xp_earned || 0), 0);
    const redeemed = logs.filter((l) => l.event_type === "mission_redemption").reduce((s, l) => s + (l.xp_spent || 0), 0);
    const available = Math.max(0, earned - redeemed);
    const dueReviews = reviews.filter((review) => new Date(review.next_review_at) <= new Date());
    setData({ account, group, missions, active, powerUps, subs, members, earned, redeemed, available, dueReviews, classification });
  }

  async function redeem(e) {
    e.preventDefault();
    const requested = Number(redeemAmt);
    const amt = Math.floor(Math.min(requested || 0, data.available) / 10) * 10;
    if (amt < 10) {
      setMsg({ ok: false, text: "Enter at least 10 XP to redeem 1 participation point." });
      return;
    }
    setRedeeming(true);
    setMsg(null);
    try {
      const result = await redeemMissionPoints(amt, data.account.classroom_id);
      setRedeemAmt("");
      const remainder = Math.max(0, Math.floor(Math.min(requested, data.available)) - amt);
      setMsg({ ok: true, text: `Redeemed ${result.xpAmount} XP for ${result.pointsAwarded} participation point${result.pointsAwarded === 1 ? "" : "s"}.${remainder ? ` ${remainder} XP stays available.` : ""}` });
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

  const { group, active, powerUps, subs, earned, redeemed, available, dueReviews, classification } = data;
  const completedMissions = active.filter((m) => subs.find((s) => s.mission_id === m.id));
  const currentMissions = active.filter((m) => !subs.find((s) => s.mission_id === m.id));
  const gradedCount = completedMissions.length;
  // Today's Power-Up, and only a teacher's approved one. The engine generates
  // it every morning but holds it back until it is reviewed, so until then
  // there is genuinely no Power-Up to do today.
  const todayPowerUp = powerUps.find((m) => m.auto_daily_date === manilaDateKey()) || null;
  const hasPowerUp = Boolean(todayPowerUp);
  const powerUpSubmission = todayPowerUp ? subs.find((s) => s.mission_id === todayPowerUp.id) : null;
  const powerUpLocked = todayPowerUp ? isMissionLocked(todayPowerUp) : false;
  let powerUpQuestions = 5;
  try { powerUpQuestions = JSON.parse(todayPowerUp?.ai_content || '{}').questions?.length || 5; } catch {}

  return (
    <div className="mx-auto max-w-5xl space-y-5 sm:space-y-6">
      <section className="grid gap-4 lg:grid-cols-[1fr_minmax(290px,.75fr)] lg:items-center">
        <div>
          <p className="text-sm font-semibold text-[var(--uc-purple)]">Your learning quests</p>
          <h1 className="uc-page-title mt-1 text-3xl sm:text-4xl">My missions</h1>
          <p className="mt-1 text-sm leading-relaxed text-ink/60">Complete your own teacher-assigned activities, learn from feedback, and exchange your XP for your participation points.</p>
          <p className="mt-2 inline-flex rounded-full bg-[var(--uc-green-soft)] px-3 py-1 text-xs font-semibold text-[var(--uc-navy-950)]">Learning status: {classification.tag}</p>
        </div>
        <NovaMessage variant="assessment" tone="violet" title="Ready for your next step?">Take your time. Feedback will help you strengthen each topic.</NovaMessage>
      </section>

      <ClayCard color="purple" className="p-5">
        <div className="flex items-center gap-4">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-white/15"><UIAsset name="assessment" className="h-14 w-14" /></div>
          <div className="flex-1 text-white">
            <p className="font-mono font-extrabold text-4xl leading-none">{available}</p>
            <p className="font-display font-bold text-sm">XP available to redeem</p>
            <p className="text-xs text-white/70">{`Earned ${earned} XP - Redeemed ${redeemed} XP · 10 XP = 1 point`}</p>
          </div>
        </div>
        <form onSubmit={redeem} className="mt-4 flex items-center gap-2">
          <label className="sr-only" htmlFor="redeem-xp">XP to redeem</label>
          <input id="redeem-xp" type="number" min="10" inputMode="numeric" className="clay-input h-10 w-28 shrink-0 bg-cream px-3 py-2 font-mono text-sm text-ink placeholder:text-ink/50" placeholder="XP" value={redeemAmt} onChange={(e) => setRedeemAmt(e.target.value)} />
          <span className="min-w-0 flex-1 text-xs text-white/75">10 XP = 1 point</span>
          <ClayButton type="submit" color="lime" size="sm" disabled={redeeming || available < 10}>
            {redeeming ? <Loader2 className="w-4 h-4 animate-spin" /> : "Redeem"}
          </ClayButton>
        </form>
        {available > 0 && (
          <button type="button" onClick={() => setRedeemAmt(String(Math.floor(available / 10) * 10))} className="mt-2 text-xs text-white/80 underline">{`Use ${Math.floor(available / 10) * 10} XP`}</button>
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
        <ClayCard className="p-4 sm:p-5">
          <div className="flex justify-between mb-2">
            <span className="flex items-center gap-2 font-display font-bold text-sm"><UIAsset name="analytics" className="h-7 w-7" /> Mission progress</span>
            <span className="font-mono text-sm">{gradedCount}/{active.length} graded</span>
          </div>
          <div className="h-5 rounded-full border-2 border-ink bg-cream overflow-hidden">
            <div className="h-full bg-clay-lime" style={{ width: `${active.length ? (gradedCount / active.length) * 100 : 0}%` }} />
          </div>
          <p className="text-xs text-ink/60 mt-2">{gradedCount < active.length ? "Complete the remaining missions to earn more XP!" : "All active missions graded. Nice work!"}</p>
        </ClayCard>
      )}

      <section>
          <h2 className="font-display font-bold text-lg mb-2 flex items-center gap-2"><Zap className="w-5 h-5" /> Daily Math Power-Up</h2>
          <p className="text-xs text-ink/60 mb-2">A short daily practice your classroom unlocks automatically. A new one arrives each morning.</p>
          <div className="space-y-2">
            {hasPowerUp ? (
              <>
                <ClayCard color="sky" className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-display font-bold">Today's Power-Up</p>
                      <div className="flex flex-wrap gap-2 mt-2">
                        <ClayChip color="sun">{`+${todayPowerUp.xp_reward} XP`}</ClayChip>
                        <ClayChip color="purple">{`${powerUpQuestions} questions`}</ClayChip>
                        {powerUpSubmission
                          ? <ClayChip color="lime">{`${powerUpSubmission.score}/${powerUpQuestions} done`}</ClayChip>
                          : <ClayChip color="sun">{powerUpLocked ? 'Closed' : 'To do'}</ClayChip>}
                      </div>
                    </div>
                    {powerUpSubmission && <MascotWidget state="excited" size="sm" />}
                  </div>
                </ClayCard>
                {powerUpLocked && !powerUpSubmission && <ClayCard className="p-4"><p className="font-display font-bold text-clay-coral">Today's Power-Up has closed.</p><p className="text-xs text-ink/60 mt-1">A fresh one arrives tomorrow morning. Keep practising in your mission history in the meantime.</p></ClayCard>}
                {!powerUpLocked && <MissionAssessment mission={todayPowerUp} group={group} userId={user.id} existing={powerUpSubmission} onDone={load} />}
              </>
            ) : (
              <ClayCard className="p-4">
                <p className="font-display font-bold text-clay-coral">No Power-Up today</p>
                <p className="text-xs text-ink/60 mt-1">Your teacher reviews the daily Power-Up before it opens, so there is nothing to do here yet. Check back after it is approved.</p>
              </ClayCard>
            )}
          </div>
      </section>

      <div>
        <h2 className="font-display font-bold text-lg mb-2 flex items-center gap-2"><Rocket className="w-5 h-5" /> Active Missions</h2>
        {currentMissions.length === 0 ? (
          <NovaEmptyState
            variant="teacher"
            title="No active missions"
            description="Nova is watching for the next quest. Check back when your teacher posts one."
          />
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
                      {formatMissionDeadline(m) && <ClayChip color={isMissionLocked(m) ? "coral" : "sky"}>{isMissionLocked(m) ? `Locked ${formatMissionDeadline(m)}` : `Due ${formatMissionDeadline(m)}`}</ClayChip>}
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
                    {isMissionLocked(m) ? <ClayCard className="p-4"><p className="font-display font-bold text-clay-coral">This mission is locked.</p><p className="text-xs text-ink/60 mt-1">Its deadline was {formatMissionDeadline(m)}. You can still view completed missions in your history.</p></ClayCard> : <MissionAssessment mission={m} group={group} userId={user.id} existing={sub} onDone={load} />}
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
