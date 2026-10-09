const db = globalThis.__B44_DB__;

import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Loader2, Lock, Sparkles, Users } from "lucide-react";
import { useAuth } from "@/lib/AuthContext";
import { getActiveStudentAccount } from "@/lib/studentContext";
import ClayButton from "@/components/ClayButton";
import ClayCard from "@/components/ClayCard";
import ClayChip from "@/components/ClayChip";
import NovaEmptyState from "@/components/mascot/NovaEmptyState";
import NovaMessage from "@/components/NovaMessage";
import PanelSkeleton from "@/components/PanelSkeleton";
import { ROUTES } from "@/lib/routes";
import { getPersonalRewardDashboard, redeemMissionPoints, redeemReward, unlockStyleChoice } from "@/lib/secureActions";

const PERSONAL_TYPES = {
  avatar_choice: "Avatar choice", theme_choice: "Theme choice", name_effect_choice: "Name style",
};

export default function StudentRewards() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [claiming, setClaiming] = useState(null);
  const [requesting, setRequesting] = useState(null);
  const [notice, setNotice] = useState(null);

  useEffect(() => { void load(); }, [user]);

  async function load() {
    if (!user) return;
    const account = await getActiveStudentAccount(user.id);
    if (!account) { navigate(ROUTES.STUDENT.ONBOARDING); return; }
    const group = await db.entities.Group.get(account.group_id);
    const classroomId = group.classroom_id;
    const [rewards, logs, redemptions, personal] = await Promise.all([
      db.entities.Reward.filter({ is_active: true }),
      db.entities.ParticipationLog.filter({ classroom_id: classroomId, group_id: group.id }),
      db.entities.RewardRedemption.filter({ group_id: group.id }),
      getPersonalRewardDashboard(classroomId),
    ]);
    const groupPoints = logs.reduce((sum, log) => sum + (log.event_type === "behavior_penalty" ? -Math.abs(log.points_awarded || 0) : log.points_awarded || 0), 0);
    const groupRewards = rewards.filter((reward) => reward.classroom_id === classroomId || reward.applies_to_all_classes).sort((a, b) => a.cost_points - b.cost_points);
    setData({ group, classroomId, groupPoints, groupRewards, redemptions, personal });
  }

  async function claimPersonal(reward) {
    setClaiming(reward.id); setNotice(null);
    try {
      await unlockStyleChoice(reward.reward_type, data.classroomId);
      setNotice({ ok: true, text: `${reward.title} is ready. Choose it in Profile settings before unlocking another style.` });
      await load();
    } catch (error) { setNotice({ ok: false, text: error.message || "That reward could not be claimed." }); }
    finally { setClaiming(null); }
  }

  async function convertXp(requestedAmount) {
    setClaiming("converter"); setNotice(null);
    try {
      const available = Math.max(0, Number(data.personal.available || 0));
      const amount = requestedAmount === 10
        ? 10
        : Math.floor(available / 10) * 10;
      if (amount < 10 || amount > available) {
        await load();
        throw new Error("Your XP wallet was refreshed. At least 10 XP is needed to redeem 1 participation point.");
      }
      const result = await redeemMissionPoints(amount, data.classroomId);
      setNotice({ ok: true, text: `${result.xpAmount} XP converted to ${result.pointsAwarded} participation point${result.pointsAwarded === 1 ? "" : "s"}.` });
      await load();
    } catch (error) { setNotice({ ok: false, text: error.message || "XP could not be converted." }); }
    finally { setClaiming(null); }
  }

  async function requestGroupReward(reward) {
    setRequesting(reward.id); setNotice(null);
    try {
      await redeemReward(reward.id, data.classroomId);
      setNotice({ ok: true, text: `Requested “${reward.title}” for Group ${data.group.group_number}. Group points are not spent.` });
      await load();
    } catch (error) { setNotice({ ok: false, text: error.message || "The group goal could not be requested." }); }
    finally { setRequesting(null); }
  }

  if (!data) return <PanelSkeleton cards={2} />;
  const { personal, groupPoints, groupRewards, redemptions, group } = data;
  const availableXp = Math.max(0, Number(personal.available || 0));
  const walletRequiresSettlement = availableXp >= 30;
  const activeStyleChoice = (personal.claims || []).find((claim) => claim.status === "active" && ["avatar_choice", "theme_choice", "name_effect_choice"].includes(claim.reward_type));
  const personalGroups = Object.entries(PERSONAL_TYPES).map(([type, label]) => ({ type, label, rewards: (personal.catalog || []).filter((reward) => reward.reward_type === type) })).filter((grouping) => grouping.rewards.length);
  const availablePersonal = (personal.catalog || []).filter((reward) => availableXp >= Number(reward.xp_cost) && !activeStyleChoice && !walletRequiresSettlement).length;
  const closestGroupGoal = groupRewards.find((reward) => groupPoints < reward.cost_points);

  return <div className="mx-auto max-w-5xl space-y-5 sm:space-y-6">
    <section className="grid gap-4 lg:grid-cols-[1fr_minmax(290px,.75fr)] lg:items-center"><div><p className="text-sm font-semibold text-[var(--uc-purple)]">Your rewards</p><h1 className="uc-page-title mt-1 text-3xl sm:text-4xl">Grow, collect, and unlock</h1><p className="mt-1 max-w-2xl text-sm leading-relaxed text-ink/60">Personal XP unlocks learning boosts and profile items. Group points unlock shared class goals—one never takes from the other.</p></div><NovaMessage variant="achievement" tone="pink" title="You choose what to grow.">Use XP for your own learning and style. Work with your group toward class goals.</NovaMessage></section>

    <section className="grid gap-4 sm:grid-cols-2">
      <ClayCard color="purple" className="p-5"><div className="flex items-start gap-3 text-white"><Sparkles className="mt-1 h-7 w-7 shrink-0" /><div><p className="font-mono text-4xl font-extrabold leading-none">{Math.floor(availableXp)}</p><p className="font-display text-sm font-bold">personal XP available</p><p className="mt-1 text-xs text-white/75">10 XP = 1 participation point. 20 XP unlocks one avatar, theme, or name style.</p></div></div><div className="mt-4 flex items-center justify-between gap-2 border-t border-white/15 pt-3 text-xs"><span>{activeStyleChoice ? "Style choice ready in Settings" : availablePersonal ? "A style unlock is ready" : walletRequiresSettlement ? "Redeem XP before another style unlock" : "Earn 20 XP for your next style"}</span><Link to={ROUTES.STUDENT.SETTINGS} className="font-display font-bold underline">Profile settings</Link></div>{availableXp >= 10 && <div className="mt-3 flex flex-wrap gap-2"><ClayButton size="sm" color="cream" disabled={claiming === "converter"} onClick={() => convertXp(10)}>{claiming === "converter" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Redeem 10 XP · 1 point"}</ClayButton>{walletRequiresSettlement && <ClayButton size="sm" color="lime" disabled={claiming === "converter"} onClick={() => convertXp()}>{claiming === "converter" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Redeem all available XP"}</ClayButton>}</div>}{walletRequiresSettlement && <div className="mt-3 rounded-xl bg-white/15 p-3"><p className="font-display text-sm font-bold">Redeem 10 XP to continue</p><p className="mt-0.5 text-xs text-white/80">At 30 XP or more, new missions and style unlocks pause. Redeem at least 10 XP into participation points to bring your wallet below 30 XP.</p></div>}</ClayCard>
      <ClayCard color="sky" className="p-5"><div className="flex items-start gap-3"><Users className="mt-1 h-7 w-7 shrink-0 text-clay-purple" /><div><p className="font-mono text-4xl font-extrabold leading-none">{Math.round(groupPoints)}</p><p className="font-display text-sm font-bold">Group {group.group_number} points</p><p className="mt-1 text-xs text-ink/60">Shared progress toward class goals; requests never spend them.</p></div></div>{closestGroupGoal ? <p className="mt-4 border-t border-ink/10 pt-3 text-xs font-display font-bold">{Math.max(0, closestGroupGoal.cost_points - groupPoints)} points until {closestGroupGoal.title}</p> : <p className="mt-4 border-t border-ink/10 pt-3 text-xs font-display font-bold">Your group has reached every current goal.</p>}</ClayCard>
    </section>
    {notice && <p role="status" className={`text-center text-sm font-display font-bold ${notice.ok ? "text-clay-lime" : "text-clay-coral"}`}>{notice.text}</p>}

    <section><div className="mb-3 flex items-end justify-between gap-3"><div><h2 className="font-display text-xl font-extrabold">Personal style unlocks</h2><p className="text-sm text-ink/60">Spend 20 XP to choose one avatar, learner theme, or name style. Choosing it uses the unlock, so other styles stay locked until you earn another 20 XP.</p></div><Link to={ROUTES.STUDENT.SETTINGS} className="hidden text-sm font-display font-bold text-clay-purple underline sm:block">Profile settings</Link></div>{walletRequiresSettlement && <NovaMessage variant="tip" tone="yellow" title="Redeem before a new style">Your XP wallet has reached 30. Convert at least 10 XP into participation points first, then you can unlock a new avatar, theme, or name style.</NovaMessage>}<div className="mt-4 space-y-5">
      {personalGroups.map((grouping) => <div key={grouping.type}><h3 className="mb-2 text-sm font-display font-extrabold text-ink/70">{grouping.label}</h3><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {grouping.rewards.map((reward) => {
          const owned = false;
          const remaining = Math.max(0, Number(reward.xp_cost) - availableXp);
          const ready = remaining === 0 && !activeStyleChoice && !walletRequiresSettlement;
          return <ClayCard key={reward.id} className="flex min-h-44 flex-col p-4"><div className="flex items-start gap-3"><span className="text-3xl" aria-hidden="true">{reward.emoji}</span><div className="min-w-0"><p className="font-display font-bold">{reward.title}</p><p className="mt-0.5 text-xs leading-relaxed text-ink/60">{reward.description}</p></div></div><div className="mt-auto pt-4"><div className="mb-2 flex items-center justify-between gap-2"><ClayChip color="sun">20 XP</ClayChip><ClayChip color="purple">One-time choice</ClayChip></div>{activeStyleChoice ? <p className="mb-2 text-xs text-ink/55">Use your current style choice in Settings first.</p> : walletRequiresSettlement ? <p className="mb-2 text-xs text-ink/55">Redeem at least 10 XP first.</p> : !ready && <p className="mb-2 text-xs text-ink/55">{remaining} more XP to unlock</p>}<ClayButton size="sm" color={ready ? "lime" : "cream"} className="w-full" disabled={!ready || claiming === reward.id} onClick={() => claimPersonal(reward)}>{claiming === reward.id ? <Loader2 className="h-4 w-4 animate-spin" /> : ready ? "Unlock choice" : <><Lock className="h-4 w-4" /> Locked</>}</ClayButton></div></ClayCard>;
        })}
      </div></div>)}
    </div></section>

    <section className="border-t border-ink/10 pt-6"><div className="mb-3"><h2 className="font-display text-xl font-extrabold">Group unlocks</h2><p className="text-sm text-ink/60">Shared classroom goals. A request asks your teacher to approve the reward; group points stay earned.</p></div>{groupRewards.length === 0 ? <NovaEmptyState variant="achievement" title="No group goals yet" description="Your teacher can add shared classroom goals here." /> : <div className="grid gap-4 sm:grid-cols-2">{groupRewards.map((reward) => {
      const remaining = Math.max(0, reward.cost_points - groupPoints); const progress = Math.min(100, Math.round((groupPoints / Math.max(1, reward.cost_points)) * 100));
      const pending = redemptions.some((request) => request.reward_id === reward.id && request.approval_status === "pending"); const claimed = redemptions.some((request) => request.reward_id === reward.id && request.approval_status === "approved");
      return <ClayCard key={reward.id} className="flex flex-col p-4"><div className="flex items-start gap-3"><span className="text-3xl">{reward.emoji || "🎁"}</span><div><p className="font-display font-bold">{reward.title}</p>{reward.description && <p className="mt-0.5 text-xs text-ink/60">{reward.description}</p>}</div></div><div className="mt-4"><div className="mb-1 flex justify-between text-xs font-display font-bold"><span>{Math.round(groupPoints)} / {reward.cost_points} points</span><span>{remaining ? `${remaining} to go` : "Goal reached"}</span></div><div className="h-3 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-clay-sky" style={{ width: `${progress}%` }} /></div></div><ClayButton color={remaining || pending || claimed ? "cream" : "lime"} size="sm" className="mt-4 w-full" disabled={Boolean(remaining || pending || claimed || requesting === reward.id)} onClick={() => requestGroupReward(reward)}>{requesting === reward.id ? <Loader2 className="h-4 w-4 animate-spin" /> : pending ? "Awaiting teacher" : claimed ? "Already approved" : remaining ? `${remaining} more points` : "Request group unlock"}</ClayButton></ClayCard>;
    })}</div>}</section>
  </div>;
}
