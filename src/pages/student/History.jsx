import { useEffect, useState } from "react";

import { useAuth } from "@/lib/AuthContext";
import { supabase } from "@/api/supabaseClient";
import { getActiveStudentAccount } from "@/lib/studentContext";
import { ROUTES } from "@/lib/routes";
import ClayCard from "@/components/ClayCard";
import ClayChip from "@/components/ClayChip";
import ClayButton from "@/components/ClayButton";
import NovaMessage from "@/components/NovaMessage";
import NovaEmptyState from "@/components/mascot/NovaEmptyState";
import { Loader2, History as HistoryIcon, Users, User, TrendingUp, TrendingDown, Sparkles } from "lucide-react";

const KINDS = {
  qr_scan: { label: "QR Scan", color: "sky" },
  gacha_win: { label: "Gacha Win", color: "lime" },
  gacha_loss: { label: "Gacha Loss", color: "coral" },
  gacha_even: { label: "Gacha Draw", color: "sun" },
  penalty: { label: "Penalty", color: "coral" },
  mission_xp: { label: "Mission XP", color: "purple" },
  xp_redeemed: { label: "XP Redeemed", color: "purple" },
  badge_awarded: { label: "Badge Reward", color: "sun" },
  badge_claim: { label: "Badge", color: "sun" },
  reward_request: { label: "Reward", color: "pink" },
  attendance: { label: "Attendance", color: "sky" },
  correction: { label: "Correction", color: "purple" },
  manual_award: { label: "Points Awarded", color: "lime" },
  score_edit: { label: "Score Review", color: "purple" },
};

const FILTERS = [
  { key: "all", label: "All" },
  { key: "points", label: "Points" },
  { key: "xp", label: "XP" },
  { key: "attendance", label: "Attendance" },
  { key: "scores", label: "Scores" },
  { key: "awards", label: "Badges & rewards" },
];

const PAGE_SIZE = 60;

// Approved/pending/declined reads differently per kind, so the chip colour and
// label come from the server-supplied status rather than being inferred.
const STATUS_LABELS = {
  pending: { label: "Awaiting approval", color: "sun" },
  approved: { label: "Approved", color: "lime" },
  rejected: { label: "Declined", color: "coral" },
  awarded: { label: "XP awarded", color: "lime" },
  "no xp": { label: "No XP this time", color: "cream" },
  reversed: { label: "Removed by teacher", color: "coral" },
};

function matchesFilter(kind, filter) {
  if (filter === "all") return true;
  if (filter === "points") return ["qr_scan", "gacha_win", "gacha_loss", "gacha_even", "penalty", "correction", "xp_redeemed", "manual_award"].includes(kind);
  if (filter === "xp") return kind === "mission_xp" || kind === "xp_redeemed";
  if (filter === "attendance") return kind === "attendance";
  if (filter === "scores") return kind === "score_edit";
  if (filter === "awards") return ["badge_awarded", "badge_claim", "reward_request"].includes(kind);
  return true;
}

export default function StudentHistory() {
  const { user } = useAuth();
  const [entries, setEntries] = useState([]);
  // Totals come from the database, not from summing the page, so they stay
  // correct no matter how much history has been paged in.
  const [totals, setTotals] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("all");

  useEffect(() => {
    let active = true;
    async function load() {
      if (!user) return;
      setLoading(true);
      setError("");
      try {
        const account = await getActiveStudentAccount(user.id);
        if (!account) {
          if (active) setError("No approved classroom account was found.");
          return;
        }
        const [history, totalsResult] = await Promise.all([
          supabase.rpc("get_student_account_history", {
            p_classroom_id: account.classroom_id,
            p_limit: PAGE_SIZE,
          }),
          supabase.rpc("get_student_account_totals", { p_classroom_id: account.classroom_id }),
        ]);
        if (history.error) throw history.error;
        if (totalsResult.error) throw totalsResult.error;
        if (!active) return;
        const rows = history.data || [];
        const [total] = totalsResult.data || [];
        setEntries(rows);
        if (total) setTotals(total);
        setHasMore(rows.length === PAGE_SIZE);
      } catch (err) {
        if (active) setError(err?.message || "Your history could not be loaded.");
      } finally {
        if (active) setLoading(false);
      }
    }
    load();
    return () => { active = false; };
  }, [user]);

  async function loadMore() {
    const oldest = entries[entries.length - 1]?.occurred_at;
    if (!oldest) return;
    setLoadingMore(true);
    setError("");
    try {
      const account = await getActiveStudentAccount(user.id);
      const { data, error: rpcError } = await supabase.rpc("get_student_account_history", {
        p_classroom_id: account.classroom_id,
        p_limit: PAGE_SIZE,
        p_before: oldest,
      });
      if (rpcError) throw rpcError;
      const rows = data || [];
      setEntries((current) => {
        const seen = new Set(current.map((row) => row.entry_id));
        return [...current, ...rows.filter((row) => !seen.has(row.entry_id))];
      });
      setHasMore(rows.length === PAGE_SIZE);
    } catch (err) {
      setError(err?.message || "Older history could not be loaded.");
    } finally {
      setLoadingMore(false);
    }
  }

  if (loading) {
    return <div className="flex items-center justify-center py-20"><div className="w-8 h-8 border-4 border-clay-purple border-t-transparent rounded-full animate-spin" /></div>;
  }

  // Personal points and whole-group points are reported separately: group
  // awards belong to the group, so they must not look like the student's own.
  const personalPoints = Number(totals?.personal_points || 0);
  const groupPoints = Number(totals?.group_points || 0);
  const xpAvailable = Number(totals?.xp_available || 0);
  const attendanceRate = totals?.attendance_rate != null ? Math.round(Number(totals.attendance_rate)) : null;
  const visible = entries.filter((row) => matchesFilter(row.kind, filter));

  const groups = visible.reduce((acc, row) => {
    const key = new Date(row.occurred_at).toDateString();
    if (!acc[key]) acc[key] = { key, label: key, rows: [] };
    acc[key].rows.push(row);
    return acc;
  }, {});

  return (
    <div className="mx-auto max-w-4xl space-y-5 sm:space-y-6">
      <section className="grid gap-4 lg:grid-cols-[1fr_minmax(290px,.75fr)] lg:items-center">
        <div>
          <p className="text-sm font-semibold text-[var(--uc-purple)]">Your account</p>
          <h1 className="uc-page-title mt-1 flex items-center gap-2 text-3xl sm:text-4xl">
            <HistoryIcon className="h-7 w-7" /> History
          </h1>
          <p className="mt-1 text-sm leading-relaxed text-ink/60">
            Every attendance record, point, XP and badge tied to your account, newest first.
          </p>
        </div>
        <NovaMessage variant="achievement" tone="blue" title="Nothing happens behind your back.">
          Points your whole group earns are marked so you always know what came from where.
        </NovaMessage>
      </section>

      {error && <ClayCard color="coral" className="p-4 text-sm">{error}</ClayCard>}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <ClayCard className="p-3 text-center">
          <p className="font-mono text-2xl font-extrabold text-clay-purple">{Math.round(personalPoints)}</p>
          <p className="text-[10px] font-display font-bold text-ink/60">MY OWN POINTS</p>
        </ClayCard>
        <ClayCard className="p-3 text-center">
          <p className="font-mono text-2xl font-extrabold text-clay-sky">{Math.round(groupPoints)}</p>
          <p className="text-[10px] font-display font-bold text-ink/60">MY GROUP'S POINTS</p>
        </ClayCard>
        <ClayCard className="p-3 text-center">
          <p className="font-mono text-2xl font-extrabold text-clay-lime">{Math.round(xpAvailable)}</p>
          <p className="text-[10px] font-display font-bold text-ink/60">XP AVAILABLE</p>
        </ClayCard>
        <ClayCard className="p-3 text-center">
          <p className="font-mono text-2xl font-extrabold text-clay-sun">
            {attendanceRate != null ? `${attendanceRate}%` : "—"}
          </p>
          <p className="text-[10px] font-display font-bold text-ink/60">PRESENT RATE</p>
        </ClayCard>
      </div>

      <p className="px-1 text-xs text-ink/55">
        {"My own points"} are the points scored on your account. {"My group's points"} is the shared total for everyone in your group,
        which includes points your whole group earned together.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((option) => (
          <button
            key={option.key}
            type="button"
            aria-pressed={filter === option.key}
            onClick={() => setFilter(option.key)}
            className={`clay-btn px-3 py-1.5 text-sm ${filter === option.key ? "bg-clay-purple text-white" : "bg-cream text-ink/70"}`}
          >
            {option.label}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <NovaEmptyState
          variant="learning"
          title={entries.length === 0 ? "No history yet" : "Nothing in this filter"}
          description={
            entries.length === 0
              ? "Once your representative marks attendance or your group scans a QR code, it will appear here."
              : "Try a different filter to see the rest of your history."
          }
          actionLabel={entries.length === 0 ? "Go to my dashboard" : undefined}
          actionHref={entries.length === 0 ? ROUTES.STUDENT.DASHBOARD : undefined}
        />
      ) : (
        <div className="space-y-4">
          {Object.values(groups).map((group) => (
            <section key={group.key}>
              <h2 className="mb-2 px-1 text-xs font-display font-extrabold uppercase tracking-wide text-ink/50">
                {group.label}
              </h2>
              <div className="space-y-2">
                {group.rows.map((row) => {
                  const meta = KINDS[row.kind] || { label: row.kind, color: "cream" };
                  const points = Number(row.points || 0);
                  const xpEarned = Number(row.xp_earned || 0);
                  const xpSpent = Number(row.xp_spent || 0);
                  const isGroup = row.scope === "group";
                  // A removed entry keeps its place in the ledger so the student
                  // can see that points were taken back, and why.
                  const removed = row.status === "reversed";
                  return (
                    <ClayCard key={row.entry_id} className={`flex items-start gap-3 p-3 ${removed ? "opacity-70" : ""}`}>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <ClayChip color={meta.color}>{meta.label}</ClayChip>
                          {row.status && STATUS_LABELS[row.status] && (
                            <ClayChip color={STATUS_LABELS[row.status].color}>{STATUS_LABELS[row.status].label}</ClayChip>
                          )}
                          <span className="flex items-center gap-1 text-[10px] font-display font-bold text-ink/45">
                            {isGroup ? <Users className="h-3 w-3" /> : <User className="h-3 w-3" />}
                            {isGroup ? "Whole group" : "Just you"}
                          </span>
                        </div>
                        <p className={`mt-1 text-sm font-display font-bold ${removed ? "line-through" : ""}`}>{row.title}</p>
                        {row.detail && (
                          <p className="mt-0.5 break-words text-xs text-ink/60">
                            {row.kind === "attendance"
                              ? new Date(`${String(row.detail).slice(0, 10)}T00:00:00`).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" })
                              : row.detail}
                          </p>
                        )}
                        {removed && (
                          <p className="mt-0.5 text-xs font-bold text-clay-coral">
                            Your teacher removed this entry.
                          </p>
                        )}
                        <p className="mt-1 text-[10px] font-mono text-ink/40">
                          {row.occurred_at ? new Date(row.occurred_at).toLocaleString() : ""}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        {points !== 0 && (
                          <p className={`flex items-center justify-end gap-1 font-mono font-extrabold ${points < 0 ? "text-clay-coral" : "text-clay-lime"}`}>
                            {points < 0 ? <TrendingDown className="h-3.5 w-3.5" /> : <TrendingUp className="h-3.5 w-3.5" />}
                            {points > 0 ? "+" : ""}{Math.round(points)}
                          </p>
                        )}
                        {xpEarned > 0 && (
                          <p className="flex items-center justify-end gap-1 font-mono font-extrabold text-clay-purple">
                            <Sparkles className="h-3.5 w-3.5" />+{Math.round(xpEarned)} XP
                          </p>
                        )}
                        {xpSpent > 0 && (
                          <p className="font-mono font-extrabold text-clay-purple">-{Math.round(xpSpent)} XP</p>
                        )}
                      </div>
                    </ClayCard>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}

      {hasMore && visible.length > 0 && (
        <ClayButton color="white" className="w-full" onClick={loadMore} disabled={loadingMore}>
          {loadingMore ? <Loader2 className="h-4 w-4 animate-spin" /> : "Load older history"}
        </ClayButton>
      )}
    </div>
  );
}