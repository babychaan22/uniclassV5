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
import { ROUTES } from "@/lib/routes";
import { claimPersonalReward, getPersonalRewardDashboard, redeemReward } from "@/lib/secureActions";

const PERSONAL_TYPES = {
  learning_privilege: "Learning boosts", avatar_frame: "Avatar frames", nova_accessory: "Nova accessories",
  banner_theme: "Banner themes", profile_sticker: "Profile stickers",
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
      const result = await claimPersonalReward(reward.id, data.classroomId);
      setNotice({ ok: true, text: reward.is_consumable ? `${result.title} is ready in your learning wallet.` : `${result.title} is now in your collection. Customize it in Settings.` });
      await load();
    } catch (error) { setNotice({ ok: false, text: error.message || "That reward could not be claimed." }); }
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

  if (!data) return <div className="flex items-center justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-4 border-clay-purple border-t-transparent" /></div>;
  const { personal, groupPoints, groupRewards, redemptions, group } = data;
  const ownedRewardIds = new Set((personal.claims || []).filter((claim) => !claim.is_consumable).map((claim) => claim.reward_id));
  const personalGroups = Object.entries(PERSONAL_TYPES).map(([type, label]) => ({ type, label, rewards: (personal.catalog || []).filter((reward) => reward.reward_type === type) })).filter((grouping) => grouping.rewards.length);
  const availablePersonal = (personal.catalog || []).filter((reward) => Number(personal.available || 0) >= Number(reward.xp_cost) && (reward.is_consumable || !ownedRewardIds.has(reward.id))).length;
  const closestGroupGoal = groupRewards.find((reward) => groupPoints < reward.cost_points);

  return <div className="mx-auto max-w-5xl space-y-5 sm:space-y-6">
    <section className="grid gap-4 lg:grid-cols-[1fr_minmax(290px,.75fr)] lg:items-center"><div><p className="text-sm font-semibold text-[var(--uc-purple)]">Your rewards</p><h1 className="uc-page-title mt-1 text-3xl sm:text-4xl">Grow, collect, and unlock</h1><p className="mt-1 max-w-2xl text-sm leading-relaxed text-ink/60">Personal XP unlocks learning boosts and profile items. Group points unlock shared class goals—one never takes from the other.</p></div><NovaMessage variant="achievement" tone="pink" title="You choose what to grow.">Use XP for your own learning and style. Work with your group toward class goals.</NovaMessage></section>

    <section className="grid gap-4 sm:grid-cols-2">
      <ClayCard color="purple" className="p-5"><div className="flex items-start gap-3 text-white"><Sparkles className="mt-1 h-7 w-7 shrink-0" /><div><p className="font-mono text-4xl font-extrabold leading-none">{Math.floor(Number(personal.available || 0))}</p><p className="font-display text-sm font-bold">personal XP available</p><p className="mt-1 text-xs text-white/75">Earned through your missions · spent only on personal rewards</p></div></div><div className="mt-4 flex items-center justify-between gap-2 border-t border-white/15 pt-3 text-xs"><span>{availablePersonal} reward{availablePersonal === 1 ? "" : "s"} ready now</span><Link to={ROUTES.STUDENT.SETTINGS} className="font-display font-bold underline">Customize profile</Link></div></ClayCard>
      <ClayCard color="sky" className="p-5"><div className="flex items-start gap-3"><Users className="mt-1 h-7 w-7 shrink-0 text-clay-purple" /><div><p className="font-mono text-4xl font-extrabold leading-none">{Math.round(groupPoints)}</p><p className="font-display text-sm font-bold">Group {group.group_number} points</p><p className="mt-1 text-xs text-ink/60">Shared progress toward class goals; requests never spend them.</p></div></div>{closestGroupGoal ? <p className="mt-4 border-t border-ink/10 pt-3 text-xs font-display font-bold">{Math.max(0, closestGroupGoal.cost_points - groupPoints)} points until {closestGroupGoal.title}</p> : <p className="mt-4 border-t border-ink/10 pt-3 text-xs font-display font-bold">Your group has reached every current goal.</p>}</ClayCard>
    </section>
    {notice && <p role="status" className={`text-center text-sm font-display font-bold ${notice.ok ? "text-clay-lime" : "text-clay-coral"}`}>{notice.text}</p>}

    <section><div className="mb-3 flex items-end justify-between gap-3"><div><h2 className="font-display text-xl font-extrabold">Personal rewards</h2><p className="text-sm text-ink/60">Spend your mission XP. Cosmetics stay in your collection forever.</p></div><Link to={ROUTES.STUDENT.SETTINGS} className="hidden text-sm font-display font-bold text-clay-purple underline sm:block">My collection</Link></div><div className="space-y-5">
      {personalGroups.map((grouping) => <div key={grouping.type}><h3 className="mb-2 text-sm font-display font-extrabold text-ink/70">{grouping.label}</h3><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {grouping.rewards.map((reward) => {
          const owned = !reward.is_consumable && ownedRewardIds.has(reward.id);
          const remaining = Math.max(0, Number(reward.xp_cost) - Number(personal.available || 0));
          const ready = remaining === 0 && !owned;
          return <ClayCard key={reward.id} className="flex min-h-52 flex-col p-4"><div className="flex items-start gap-3"><span className="text-3xl" aria-hidden="true">{reward.emoji}</span><div className="min-w-0"><p className="font-display font-bold">{reward.title}</p><p className="mt-0.5 text-xs leading-relaxed text-ink/60">{reward.description}</p></div></div><div className="mt-auto pt-4"><div className="mb-2 flex items-center justify-between gap-2"><ClayChip color="sun">{reward.xp_cost} XP</ClayChip>{owned ? <ClayChip color="lime">Owned</ClayChip> : reward.is_consumable ? <ClayChip color="sky">Use with teacher</ClayChip> : <ClayChip color="purple">Permanent</ClayChip>}</div>{!owned && !ready && <p className="mb-2 text-xs text-ink/55">{remaining} more XP to unlock</p>}<ClayButton size="sm" color={ready ? "lime" : "cream"} className="w-full" disabled={!ready || claiming === reward.id} onClick={() => claimPersonal(reward)}>{claiming === reward.id ? <Loader2 className="h-4 w-4 animate-spin" /> : owned ? "In collection" : ready ? reward.is_consumable ? "Claim boost" : "Unlock item" : <><Lock className="h-4 w-4" /> Locked</>}</ClayButton></div></ClayCard>;
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
