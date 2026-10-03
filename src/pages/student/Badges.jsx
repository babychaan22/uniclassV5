
const db = globalThis.__B44_DB__;

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/AuthContext";
import { getActiveStudentAccount } from "@/lib/studentContext";

import ClayButton from "@/components/ClayButton";
import ClayCard from "@/components/ClayCard";
import ClayChip from "@/components/ClayChip";
import { redeemBadge } from "@/lib/badgeService";
import { claimBadgeDefinition } from "@/lib/secureActions";
import { supabase } from "@/api/supabaseClient";
import { getWeekStartManila, isEndOfWeekManila } from "@/lib/week";
import { Check, Loader2 } from "lucide-react";
import NovaMessage from "@/components/NovaMessage";
import { notifyGroupBadgesUpdated } from "@/components/GroupBadgeContext";

const BADGE_INFO = {
  weekly_90_activity: { label: "90% Activity Squad", desc: "All members ≥90% activity avg this week", points: 10, icon: "🎯" },
  weekly_full_attendance: { label: "Perfect Attendance", desc: "Every member present all week", points: 10, icon: "📅" },
  weekly_top_group_points: { label: "Top Group Points", desc: "Highest group participation this week", points: 10, icon: "🏆" },
  weekly_top_individual_points: { label: "Top Point Earner", desc: "Highest individual points in the whole class this week", points: 10, icon: "⭐" },
};

export default function StudentBadges() {
  const { user } = useAuth();
  const [account, setAccount] = useState(null);
  const [group, setGroup] = useState(null);
  const [eligibility, setEligibility] = useState({});
  const [claimed, setClaimed] = useState({});
  const [pending, setPending] = useState({});
  const [redeeming, setRedeeming] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [customBadges, setCustomBadges] = useState([]);
  const [now, setNow] = useState(() => new Date());

  const weekStart = getWeekStartManila(now);
  const endOfWeek = isEndOfWeekManila(now);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    async function load() {
      if (!user) return;
      const a = await getActiveStudentAccount(user.id);
      if (!a) return;
      setAccount(a);
      const g = await db.entities.Group.get(a.group_id);
      setGroup(g);

      const statusWeekStart = endOfWeek ? weekStart : addDays(weekStart, -7);
      const badges = await db.entities.Badge.filter({ group_id: a.group_id, week_start_date: statusWeekStart });
      const claimedMap = {}; const pendingMap = {};
      for (const b of badges) {
        if (b.approval_status === "approved") claimedMap[b.badge_type] = true;
        if (b.approval_status === "pending") pendingMap[b.badge_type] = true;
      }
      setClaimed(claimedMap);
      setPending(pendingMap);

      const classroomId = g.classroom_id;
      const definitions = await db.entities.BadgeDefinition.filter({ is_active: true });
      setCustomBadges(definitions.filter((definition) => definition.classroom_id === classroomId || definition.applies_to_all_classes));

      // The server decides eligibility, with the reason and the numbers behind
      // it. Recomputing it here used to drift from the rule the database
      // enforces, so a badge could look requestable and then be refused.
      const eligibilityResult = await supabase.rpc("get_badge_eligibility", { p_group_id: g.id });
      const elig = {};
      if (!eligibilityResult.error) {
        for (const row of eligibilityResult.data || []) {
          elig[row.badgeType] = { eligible: row.eligible, reason: row.reason, metric: row.metric };
        }
      } else {
        setError("Could not check which badges you qualify for right now.");
      }
      setEligibility(elig);
    }
    load();
  }, [user, weekStart, endOfWeek]);

  async function redeem(badgeType) {
    setRedeeming(badgeType);
    setError("");
    const res = await redeemBadge(group.id, badgeType, user.id);
    setRedeeming(null);
    if (res.error) { setError(res.error); return; }
    notifyGroupBadgesUpdated();
    setPending({ ...pending, [badgeType]: true });
    setResult({ badgeType, title: BADGE_INFO[badgeType].label });
    setTimeout(() => setResult(null), 3000);
  }

  async function claimCustom(definition) {
    setRedeeming(definition.id); setError("");
    const key = definition.badge_scope === "personal"
      ? `custom:${definition.id}:${account.group_member_id}`
      : `custom:${definition.id}`;
    try {
      await claimBadgeDefinition(definition.id, group.id, definition.badge_scope === "personal" ? account.group_member_id : null);
      notifyGroupBadgesUpdated();
      setPending((current) => ({ ...current, [key]: true }));
      setResult({ badgeType: "custom", title: definition.title });
    } catch (err) { setError(err.message || "Could not claim badge."); }
    setRedeeming(null);
  }

  if (!account) return <div className="flex items-center justify-center py-20"><div className="w-8 h-8 border-4 border-clay-purple border-t-transparent rounded-full animate-spin" /></div>;

  return (
    <div className="mx-auto max-w-5xl space-y-5 sm:space-y-6">
      <section className="grid gap-4 lg:grid-cols-[1fr_minmax(290px,.75fr)] lg:items-center"><div><p className="text-sm font-semibold text-[var(--uc-purple)]">Weekly achievements</p><h1 className="uc-page-title mt-1 text-3xl sm:text-4xl">Badges</h1><p className="mt-1 text-sm leading-relaxed text-ink/60">Celebrate consistent attendance, effort, and teamwork. Week of {weekStart}.</p></div><NovaMessage variant="achievement" tone="yellow" title="You’re building something brilliant.">Eligible badges can be requested at the end of the week.</NovaMessage></section>

      {result && <ClayCard color="sky" className="p-3 text-center"><p className="font-display font-bold text-sm">{result.title} requested</p><p className="text-xs text-ink/60 mt-1">Your teacher must approve it before points are added.</p></ClayCard>}

      {error && <p className="text-clay-coral font-display font-bold text-sm text-center">{error}</p>}

      {!endOfWeek && (
        <ClayCard tone="yellow" className="p-4 text-center">
          <p className="font-display font-bold text-sm mb-1">🔒 Badges unlock at the end of the week (Saturday &amp; Sunday).</p>
          <p className="text-xs text-ink/50">Come back then to compare your group's activity, points &amp; attendance and claim rewards.</p>
        </ClayCard>
      )}

      <div className="!grid sm:grid-cols-2 gap-4">
        {Object.keys(BADGE_INFO).map((type) => {
          const info = BADGE_INFO[type];
          const status = eligibility[type];
          const isEligible = status?.eligible === true;
          const isClaimed = claimed[type];
          const isPending = pending[type];
          const metric = status?.metric || {};
          return (
            <ClayCard key={type} className="p-5">
              <div className="flex items-center gap-3 mb-3">
                <div className="clay-medallion bg-cream w-14 h-14 flex items-center justify-center text-2xl shrink-0">{info.icon}</div>
                <div>
                  <p className="font-display font-bold text-sm leading-tight">{info.label}</p>
                  <p className="text-xs text-ink/50">{info.desc}</p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2"><ClayChip color={isClaimed ? "lime" : isPending ? "sky" : isEligible ? "sun" : "cream"}>
                {isClaimed ? <><Check className="w-3 h-3" /> Approved</> : isPending ? "Awaiting teacher approval" : isEligible ? "Eligible" : "Not eligible"}
              </ClayChip><ClayChip color="sun">+{info.points} pts</ClayChip></div>
              {metricLine(type, metric) && (
                <p className="mt-2 text-[11px] font-mono text-ink/55">{metricLine(type, metric)}</p>
              )}
              {status?.reason && (
                <p className="mt-1 text-[11px] text-ink/50">{status.reason}</p>
              )}
              <div className="mt-3">
                {isEligible && !isClaimed && !isPending && endOfWeek && (
                  <ClayButton color="pink" size="sm" className="w-full" onClick={() => redeem(type)} disabled={redeeming === type}>
                    {redeeming === type ? <Loader2 className="w-4 h-4 animate-spin" /> : "Request approval"}
                  </ClayButton>
                )}
                {!isEligible && !isClaimed && !isPending && (
                  <p className="rounded-xl border-2 border-ink/10 bg-cream/50 px-3 py-2 text-[11px] font-bold text-ink/50">
                    You cannot request this badge until you qualify. Your teacher sees the same numbers.
                  </p>
                )}
              </div>
              <p className="text-[11px] text-ink/50 mt-2">One request per group. Points are added only after teacher approval.</p>
            </ClayCard>
          );
        })}
      </div>
      {customBadges.length > 0 && <>
        <h2 className="font-display font-bold text-lg">Teacher badges</h2>
        <div className="grid sm:grid-cols-2 gap-4">{customBadges.map((badge) => {
          const key = badge.badge_scope === "personal" ? `custom:${badge.id}:${account.group_member_id}` : `custom:${badge.id}`; const isClaimed = claimed[key]; const isPending = pending[key];
          return <ClayCard key={badge.id} className="p-5"><div className="flex items-center gap-3 mb-3"><div className="clay-medallion bg-cream w-14 h-14 flex items-center justify-center text-2xl">{badge.icon}</div><div><p className="font-display font-bold text-sm">{badge.title}</p><p className="text-xs text-ink/50">{badge.description || "Weekend badge"}</p></div></div><div className="flex flex-wrap gap-2"><ClayChip color={isClaimed ? "lime" : isPending ? "sky" : "sun"}>{isClaimed ? "Approved" : isPending ? "Awaiting teacher approval" : badge.badge_scope}</ClayChip><ClayChip color="sun">+{badge.points} pts</ClayChip></div>{badge.badge_scope === "group" && <p className="text-[11px] text-ink/50 mt-2">Points are added to the group only after teacher approval.</p>}{endOfWeek && !isClaimed && !isPending && <ClayButton color="pink" size="sm" className="w-full mt-3" onClick={() => claimCustom(badge)} disabled={redeeming === badge.id}>{redeeming === badge.id ? <Loader2 className="w-4 h-4 animate-spin" /> : "Request approval"}</ClayButton>}</ClayCard>;
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

// The numbers the server used to decide, so a student can see how far off they
// are rather than just being told no.
function metricLine(type, metric) {
  if (!metric || typeof metric !== "object") return "";
  const parts = [];
  if (type === "weekly_90_activity") {
    if (metric.weakest_member_pct != null) parts.push(`lowest member ${metric.weakest_member_pct}%`);
    if (metric.members_below_90 != null) parts.push(`${metric.members_below_90} of ${metric.members} below 90%`);
  } else if (type === "weekly_full_attendance") {
    if (metric.marked != null) parts.push(`${metric.present}/${metric.marked} present`);
    if (metric.members_without_mark) parts.push(`${metric.members_without_mark} unmarked`);
  } else if (type === "weekly_top_group_points") {
    if (metric.group_points != null) parts.push(`group ${metric.group_points} pts`);
    if (metric.top_group_points != null) parts.push(`leader ${metric.top_group_points} pts`);
  } else if (type === "weekly_top_individual_points") {
    if (metric.your_points != null) parts.push(`you ${metric.your_points} pts`);
    if (metric.top_points != null) parts.push(`leader ${metric.top_points} pts`);
  }
  return parts.join(" · ");
}
