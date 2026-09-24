
const db = globalThis.__B44_DB__;

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/AuthContext";
import { getActiveStudentAccount } from "@/lib/studentContext";

import ClayButton from "@/components/ClayButton";
import ClayCard from "@/components/ClayCard";
import ClayChip from "@/components/ClayChip";
import NovaEmptyState from "@/components/mascot/NovaEmptyState";
import NovaMessage from "@/components/NovaMessage";
import { UIAsset } from "@/components/visual/UIAsset";
import { Loader2 } from "lucide-react";
import { ROUTES } from '@/lib/routes';
import { redeemReward } from '@/lib/secureActions';

export default function StudentRewards() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [redeeming, setRedeeming] = useState(null);
  const [msg, setMsg] = useState(null);

  useEffect(() => { load(); }, [user]);

  async function load() {
    if (!user) return;
    const account = await getActiveStudentAccount(user.id);
    if (!account) { navigate(ROUTES.STUDENT.ONBOARDING); return; }
    const group = await db.entities.Group.get(account.group_id);
    const classroomId = group.classroom_id;
    const [rewards, logs, redemptions] = await Promise.all([
      db.entities.Reward.filter({ is_active: true }),
      db.entities.ParticipationLog.filter({ classroom_id: classroomId, group_id: group.id }),
      db.entities.RewardRedemption.filter({ group_id: group.id }),
    ]);
    const gross = logs.reduce((sum, log) => sum + (log.points_awarded || 0), 0);
    const active = rewards
      .filter((r) => r.classroom_id === classroomId || r.applies_to_all_classes)
      .sort((a, b) => a.cost_points - b.cost_points);
    setData({ account, group, classroomId, active, gross, redemptions });
  }

  async function redeem(r) {
    if (data.gross < r.cost_points) {
      setMsg({ ok: false, text: `Not enough points. You need ${r.cost_points}.` });
      return;
    }
    setRedeeming(r.id);
    setMsg(null);
    try {
      await redeemReward(r.id, data.classroomId);
      setMsg({ ok: true, text: `Request sent for "${r.title}". Your teacher will approve or decline it.` });
      load();
    } catch (err) { setMsg({ ok: false, text: err.message || "Could not request this reward." }); }
    setRedeeming(null);
    setTimeout(() => setMsg(null), 3500);
  }

  if (!data) return <div className="flex items-center justify-center py-20"><div className="w-8 h-8 border-4 border-clay-purple border-t-transparent rounded-full animate-spin" /></div>;
  const { group, active, gross, redemptions } = data;

  return (
    <div className="mx-auto max-w-5xl space-y-5 sm:space-y-6">
      <section className="grid gap-4 lg:grid-cols-[1fr_minmax(290px,.75fr)] lg:items-center"><div><p className="text-sm font-semibold text-[var(--uc-purple)]">Group rewards</p><h1 className="uc-page-title mt-1 text-3xl sm:text-4xl">Rewards shop</h1><p className="mt-1 text-sm leading-relaxed text-ink/60">Use group participation points for teacher-approved rewards available across your enrolled classes.</p></div><NovaMessage variant="achievement" tone="pink" title="Great teamwork earns great things.">Choose a reward together, then wait for your teacher’s approval.</NovaMessage></section>

      <ClayCard color="purple" className="p-5">
        <div className="flex items-center gap-4">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-white/15"><UIAsset name="assessment" className="h-14 w-14" /></div>
          <div className="flex-1 text-white">
            <p className="font-mono font-extrabold text-4xl leading-none">{Math.round(gross)}</p>
            <p className="font-display font-bold text-sm">Group points earned</p>
            <p className="text-xs text-white/70">Rewards require a points threshold; requesting one never deducts your points.</p>
          </div>
        </div>
      </ClayCard>

      {msg && <p className={`font-display font-bold text-sm text-center ${msg.ok ? "text-clay-lime" : "text-clay-coral"}`}>{msg.text}</p>}

      {active.length === 0 ? (
        <NovaEmptyState
          variant="achievement"
          title="No rewards available right now"
          description="Rewards will appear here once you've earned enough points. Keep earning activity and attendance points!"
        />
      ) : (
        <div className="grid sm:grid-cols-2 gap-4">
          {active.map((r) => {
            const afford = gross >= r.cost_points;
            const isPending = redemptions.some((request) => request.reward_id === r.id && request.approval_status === "pending");
            return (
              <ClayCard key={r.id} className="p-4 flex flex-col">
                <div className="flex items-start gap-3 mb-2">
                  <span className="text-3xl">{r.emoji || "🎁"}</span>
                  <div className="min-w-0">
                    <p className="font-display font-bold">{r.title}</p>
                    {r.description && <p className="text-xs text-ink/60 mt-0.5">{r.description}</p>}
                  </div>
                </div>
                <ClayChip color="sun" className="self-start mb-3">{r.cost_points} pts required</ClayChip>
                <ClayButton color={afford && !isPending ? "lime" : "cream"} size="sm" className="w-full mt-auto" disabled={!afford || isPending || redeeming === r.id} onClick={() => redeem(r)}>
                  {redeeming === r.id ? <Loader2 className="w-4 h-4 animate-spin" /> : isPending ? "Awaiting teacher approval" : afford ? "Request reward" : "Not enough points"}
                </ClayButton>
              </ClayCard>
            );
          })}
        </div>
      )}
    </div>
  );
}
