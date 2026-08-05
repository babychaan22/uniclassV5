
const db = globalThis.__B44_DB__;

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/AuthContext";

import ClayButton from "@/components/ClayButton";
import ClayCard from "@/components/ClayCard";
import ClayChip from "@/components/ClayChip";
import { Gift, Loader2, Sparkles } from "lucide-react";
import { computeParticipationPoints } from "@/lib/stats";
import { ROUTES } from '@/lib/routes';

export default function StudentRewards() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [redeeming, setRedeeming] = useState(null);
  const [msg, setMsg] = useState(null);

  useEffect(() => { load(); }, [user]);

  async function load() {
    if (!user) return;
    const accs = await db.entities.GroupAccount.filter({ user_id: user.id });
    const account = accs[0];
    if (!account) { navigate(ROUTES.STUDENT.ONBOARDING); return; }
    const group = await db.entities.Group.get(account.group_id);
    const classroomId = group.classroom_id;
    const [rewards, members, logs, redemptions] = await Promise.all([
      db.entities.Reward.filter({ classroom_id: classroomId }),
      db.entities.GroupMember.filter({ group_id: group.id }),
      db.entities.ParticipationLog.filter({ classroom_id: classroomId, group_id: group.id }),
      db.entities.RewardRedemption.filter({ group_id: group.id }),
    ]);
    const gross = members.reduce((s, m) => s + computeParticipationPoints(m.id, logs), 0);
    const spent = redemptions.reduce((s, r) => s + (r.points_spent || 0), 0);
    const available = Math.max(0, gross - spent);
    const active = rewards.filter((r) => r.is_active).sort((a, b) => a.cost_points - b.cost_points);
    setData({ account, group, members, active, gross, spent, available });
  }

  async function redeem(r) {
    if (data.available < r.cost_points) {
      setMsg({ ok: false, text: `Not enough points. You need ${r.cost_points}.` });
      return;
    }
    setRedeeming(r.id);
    setMsg(null);
    await db.entities.RewardRedemption.create({
      reward_id: r.id, reward_title: r.title, group_id: data.group.id, classroom_id: data.group.classroom_id,
      points_spent: r.cost_points, redeemed_by: user.id,
    });
    setRedeeming(null);
    setMsg({ ok: true, text: `Claimed "${r.title}"! Show your teacher 🎉` });
    load();
    setTimeout(() => setMsg(null), 3500);
  }

  if (!data) return <div className="flex items-center justify-center py-20"><div className="w-8 h-8 border-4 border-clay-purple border-t-transparent rounded-full animate-spin" /></div>;
  const { group, active, gross, spent, available } = data;

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      <div>
        <h1 className="text-2xl font-display font-extrabold mb-1 flex items-center gap-2"><Gift className="w-6 h-6" /> Rewards Shop</h1>
        <p className="text-ink/60 text-sm">Trade your group's participation points for rewards.</p>
      </div>

      <ClayCard color="purple" className="p-5">
        <div className="flex items-center gap-4">
          <div className="clay-medallion bg-clay-sun w-16 h-16 flex items-center justify-center shrink-0">
            <Sparkles className="w-8 h-8 text-ink" />
          </div>
          <div className="flex-1 text-white">
            <p className="font-mono font-extrabold text-4xl leading-none">{Math.round(available)}</p>
            <p className="font-display font-bold text-sm">Points available to spend</p>
            <p className="text-xs text-white/70">{`Group ${group.group_number} · Earned ${Math.round(gross)} · Spent ${Math.round(spent)}`}</p>
          </div>
        </div>
      </ClayCard>

      {msg && <p className={`font-display font-bold text-sm text-center ${msg.ok ? "text-clay-lime" : "text-clay-coral"}`}>{msg.text}</p>}

      {active.length === 0 ? (
        <p className="text-ink/50 text-sm text-center">No rewards available right now.</p>
      ) : (
        <div className="grid sm:grid-cols-2 gap-4">
          {active.map((r) => {
            const afford = available >= r.cost_points;
            return (
              <ClayCard key={r.id} className="p-4 flex flex-col">
                <div className="flex items-start gap-3 mb-2">
                  <span className="text-3xl">{r.emoji || "🎁"}</span>
                  <div className="min-w-0">
                    <p className="font-display font-bold">{r.title}</p>
                    {r.description && <p className="text-xs text-ink/60 mt-0.5">{r.description}</p>}
                  </div>
                </div>
                <ClayChip color="sun" className="self-start mb-3">{r.cost_points} pts</ClayChip>
                <ClayButton color={afford ? "lime" : "cream"} size="sm" className="w-full mt-auto" disabled={!afford || redeeming === r.id} onClick={() => redeem(r)}>
                  {redeeming === r.id ? <Loader2 className="w-4 h-4 animate-spin" /> : afford ? "Claim Reward" : "Not enough points"}
                </ClayButton>
              </ClayCard>
            );
          })}
        </div>
      )}
    </div>
  );
}

