
const db = globalThis.__B44_DB__;

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/AuthContext";
import { getActiveStudentAccount } from "@/lib/studentContext";

import ClayButton from "@/components/ClayButton";
import ClayCard from "@/components/ClayCard";
import ClayChip from "@/components/ClayChip";
import CapsulePop from "@/components/CapsulePop";
import { redeemBadge } from "@/lib/badgeService";
import { claimBadgeDefinition } from "@/lib/secureActions";
import { getWeekStartManila, isEndOfWeekManila } from "@/lib/week";
import { playStamp } from "@/lib/gacha";
import { Award, Check, Loader2, Volume2, VolumeX } from "lucide-react";

const BADGE_INFO = {
  weekly_90_activity: { label: "90% Activity Squad", desc: "All members ≥90% activity avg this week", points: 20, icon: "🎯" },
  weekly_full_attendance: { label: "Perfect Attendance", desc: "Every member present all week", points: 10, icon: "📅" },
  weekly_top_group_points: { label: "Top Group Points", desc: "Highest group participation this week", points: 20, icon: "🏆" },
  weekly_top_individual_points: { label: "Top Point Earner", desc: "A member has the highest individual points", points: 20, icon: "⭐" },
};

export default function StudentBadges() {
  const { user } = useAuth();
  const [account, setAccount] = useState(null);
  const [group, setGroup] = useState(null);
  const [eligibility, setEligibility] = useState({});
  const [claimed, setClaimed] = useState({});
  const [redeeming, setRedeeming] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [soundOn, setSoundOn] = useState(false);
  const [customBadges, setCustomBadges] = useState([]);

  const weekStart = getWeekStartManila();
  const endOfWeek = isEndOfWeekManila();

  useEffect(() => {
    async function load() {
      if (!user) return;
      const a = await getActiveStudentAccount(user.id);
      if (!a) return;
      setAccount(a);
      const g = await db.entities.Group.get(a.group_id);
      setGroup(g);

      const badges = await db.entities.Badge.filter({ group_id: a.group_id, week_start_date: weekStart });
      const claimedMap = {};
      for (const b of badges) claimedMap[b.badge_type] = true;
      setClaimed(claimedMap);

      const classroomId = g.classroom_id;
      const definitions = await db.entities.BadgeDefinition.filter({ is_active: true });
      setCustomBadges(definitions.filter((definition) => definition.classroom_id === classroomId || definition.applies_to_all_classes));
      const [members, allGroups, allMembers, attendance, scores, activities, logs] = await Promise.all([
        db.entities.GroupMember.filter({ group_id: g.id }),
        db.entities.Group.filter({ classroom_id: classroomId }),
        db.entities.GroupMember.filter({ classroom_id: classroomId }),
        db.entities.Attendance.filter({ classroom_id: classroomId }),
        db.entities.ActivityScore.filter({ classroom_id: classroomId }),
        db.entities.Activity.filter({ classroom_id: classroomId }),
        db.entities.ParticipationLog.filter({ classroom_id: classroomId }),
      ]);

      const weekEnd = addDays(weekStart, 6);
      const inWeek = (d) => (d || "").slice(0, 10) >= weekStart && (d || "").slice(0, 10) <= weekEnd;

      const elig = {};
      elig.weekly_90_activity = members.length > 0 && members.every((m) => {
        const ms = scores.filter((s) => s.group_member_id === m.id && inWeek(s.created_date));
        if (ms.length === 0) return false;
        let ts = 0, tm = 0;
        for (const s of ms) { const act = activities.find((a) => a.id === s.activity_id); if (act) { ts += s.score; tm += act.max_score; } }
        return tm > 0 && ts / tm >= 0.9;
      });

      const weekAtt = attendance.filter((a) => inWeek(a.attendance_date));
      elig.weekly_full_attendance = members.length > 0 && members.every((m) => {
        const recs = weekAtt.filter((a) => a.group_member_id === m.id);
        return recs.length > 0 && recs.every((r) => r.status === "present");
      });

      const groupTotals = {};
      for (const gr of allGroups) groupTotals[gr.id] = logs.filter((l) => l.group_id === gr.id && inWeek(l.created_date)).reduce((s, l) => s + (l.points_awarded || 0), 0);
      const maxGroup = Math.max(...Object.values(groupTotals));
      elig.weekly_top_group_points = maxGroup > 0 && groupTotals[g.id] === maxGroup;

      const memTotals = {};
      for (const m of allMembers) memTotals[m.id] = logs.filter((l) => l.group_member_id === m.id && inWeek(l.created_date)).reduce((s, l) => s + (l.points_awarded || 0), 0);
      const maxMem = Math.max(...Object.values(memTotals));
      const topMem = Object.keys(memTotals).find((id) => memTotals[id] === maxMem);
      elig.weekly_top_individual_points = maxMem > 0 && members.some((m) => m.id === topMem);

      setEligibility(elig);
    }
    load();
  }, [user]);

  async function redeem(badgeType) {
    setRedeeming(badgeType);
    setError("");
    const res = await redeemBadge(group.id, badgeType, user.id);
    setRedeeming(null);
    if (res.error) { setError(res.error); return; }
    setClaimed({ ...claimed, [badgeType]: true });
    setResult({ badgeType, points: res.points });
    if (soundOn) playStamp();
    setTimeout(() => setResult(null), 3000);
  }

  async function claimCustom(definition) {
    setRedeeming(definition.id); setError("");
    try {
      await claimBadgeDefinition(definition.id, group.id, definition.badge_scope === "personal" ? account.group_member_id : null);
      setClaimed({ ...claimed, [`custom:${definition.id}`]: true });
      setResult({ badgeType: "custom", points: definition.points, icon: definition.icon, title: definition.title });
    } catch (err) { setError(err.message || "Could not claim badge."); }
    setRedeeming(null);
  }

  if (!account) return <div className="flex items-center justify-center py-20"><div className="w-8 h-8 border-4 border-clay-purple border-t-transparent rounded-full animate-spin" /></div>;

  return (
    <div className="max-w-lg mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-display font-extrabold flex items-center gap-2"><Award className="w-6 h-6" /> Badges</h1>
          <p className="text-ink/60 text-sm font-mono">Week of {weekStart}</p>
        </div>
        <button onClick={() => setSoundOn(!soundOn)} className={`clay-btn px-3 py-2 ${soundOn ? "bg-clay-lime text-ink" : "bg-cream text-ink/60"}`}>
          {soundOn ? <Volume2 className="w-5 h-5" /> : <VolumeX className="w-5 h-5" />}
        </button>
      </div>

      {result && (
        <CapsulePop trigger={Date.now()} className="flex justify-center">
          <div className="clay-medallion bg-clay-sun w-24 h-24 flex flex-col items-center justify-center">
            <span className="text-3xl">{result.icon || BADGE_INFO[result.badgeType].icon}</span>
            <span className="font-display font-bold text-sm">+{result.points}</span>
          </div>
        </CapsulePop>
      )}

      {error && <p className="text-clay-coral font-display font-bold text-sm text-center">{error}</p>}

      {!endOfWeek && (
        <ClayCard className="p-4 text-center">
          <p className="font-display font-bold text-sm">🔒 Badges unlock at the end of the week (Saturday &amp; Sunday).</p>
          <p className="text-xs text-ink/50 mt-1">Come back then to compare your group's activity, points &amp; attendance and claim rewards.</p>
        </ClayCard>
      )}

      <div className="!grid sm:grid-cols-2 gap-4">
        {Object.keys(BADGE_INFO).map((type) => {
          const info = BADGE_INFO[type];
          const isEligible = eligibility[type];
          const isClaimed = claimed[type];
          return (
            <ClayCard key={type} className="p-5">
              <div className="flex items-center gap-3 mb-3">
                <div className="clay-medallion bg-cream w-14 h-14 flex items-center justify-center text-2xl shrink-0">{info.icon}</div>
                <div>
                  <p className="font-display font-bold text-sm leading-tight">{info.label}</p>
                  <p className="text-xs text-ink/50">{info.desc}</p>
                </div>
              </div>
              <ClayChip color={isClaimed ? "lime" : isEligible ? "sun" : "cream"}>
                {isClaimed ? <><Check className="w-3 h-3" /> Claimed</> : isEligible ? `Eligible · +${info.points}pts` : "Not eligible"}
              </ClayChip>
              <div className="mt-3">
                {isEligible && !isClaimed && endOfWeek && (
                  <ClayButton color="pink" size="sm" className="w-full" onClick={() => redeem(type)} disabled={redeeming === type}>
                    {redeeming === type ? <Loader2 className="w-4 h-4 animate-spin" /> : "Redeem"}
                  </ClayButton>
                )}
              </div>
              <p className="text-[11px] text-ink/50 mt-2">One redemption per group. Points go to the group total.</p>
            </ClayCard>
          );
        })}
      </div>
      {customBadges.length > 0 && <>
        <h2 className="font-display font-bold text-lg">Teacher badges</h2>
        <div className="grid sm:grid-cols-2 gap-4">{customBadges.map((badge) => {
          const key = `custom:${badge.id}`; const isClaimed = claimed[key];
          return <ClayCard key={badge.id} className="p-5"><div className="flex items-center gap-3 mb-3"><div className="clay-medallion bg-cream w-14 h-14 flex items-center justify-center text-2xl">{badge.icon}</div><div><p className="font-display font-bold text-sm">{badge.title}</p><p className="text-xs text-ink/50">{badge.description || "Weekend badge"}</p></div></div><ClayChip color={isClaimed ? "lime" : "sun"}>{isClaimed ? "Claimed" : `${badge.badge_scope} · +${badge.points} pts`}</ClayChip>{badge.badge_scope === "group" && <p className="text-[11px] text-ink/50 mt-2">One redemption per group. Points go to the group total.</p>}{endOfWeek && !isClaimed && <ClayButton color="pink" size="sm" className="w-full mt-3" onClick={() => claimCustom(badge)} disabled={redeeming === badge.id}>{redeeming === badge.id ? <Loader2 className="w-4 h-4 animate-spin" /> : "Claim badge"}</ClayButton>}</ClayCard>;
        })}</div>
      </>}
    </div>
  );
}

function addDays(dateStr, days) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
