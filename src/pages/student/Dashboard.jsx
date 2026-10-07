
const db = globalThis.__B44_DB__;

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Link } from "react-router-dom";
import { useAuth } from "@/lib/AuthContext";
import { getActiveStudentAccount } from "@/lib/studentContext";
import { supabase } from '@/api/supabaseClient';

import ClayCard from "@/components/ClayCard";
import ClayChip from "@/components/ClayChip";
import GroupBadgeMarkers from "@/components/GroupBadgeMarkers";
import { Flame, Star, Trophy, Users, Megaphone, ArrowRight } from "lucide-react";
import { computeAttendanceStreak, computeActivityPct, computeParticipationPoints, computeEngagementStreak } from "@/lib/stats";
import { getTodayManila } from "@/lib/week";
import DashboardRangeTabs from "@/components/DashboardRangeTabs";
import NovaMessage from "@/components/NovaMessage";
import RepresentativeRosterPanel from "@/components/student/RepresentativeRosterPanel";
import UserAvatar from "@/components/visual/UserAvatar";
import { NovaAsset } from "@/components/visual/UIAsset";
import { ROUTES } from '@/lib/routes';
import PanelSkeleton from "@/components/PanelSkeleton";

let studentDashboardCache = null;
const STUDENT_DASHBOARD_CACHE_MS = 30_000;

function missionEstimate(mission) {
  try {
    const content = JSON.parse(mission?.ai_content || "{}");
    return Number(content.estimated_minutes || 0) || null;
  } catch {
    return null;
  }
}

export default function StudentDashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const initialCache = studentDashboardCache?.userId === user?.id && Date.now() - studentDashboardCache.savedAt < STUDENT_DASHBOARD_CACHE_MS ? studentDashboardCache.data : null;
  const [data, setData] = useState(initialCache);
  const [loading, setLoading] = useState(!initialCache);
  const [range, setRange] = useState("week");

  useEffect(() => {
    let active = true;
    async function load() {
      if (!user) return;
      const account = await getActiveStudentAccount(user.id);
      if (!account) { navigate(ROUTES.STUDENT.ONBOARDING); return; }
      const group = await db.entities.Group.get(account.group_id);
      const classroomId = group.classroom_id;
      const [classroom, members, rankResult, attendance, scores, activities, logs, avatarResult] = await Promise.all([
        db.entities.Classroom.get(classroomId),
        db.entities.GroupMember.filter({ group_id: group.id }),
        supabase.rpc('get_classroom_group_leaderboard', { p_classroom_id: classroomId }),
        db.entities.Attendance.filter({ classroom_id: classroomId }),
        db.entities.ActivityScore.filter({ classroom_id: classroomId }),
        db.entities.Activity.filter({ classroom_id: classroomId }),
        db.entities.ParticipationLog.filter({ classroom_id: classroomId }),
        supabase.rpc('get_classroom_student_avatars', { p_classroom_id: classroomId }),
      ]);
      if (rankResult.error) throw rankResult.error;
      if (!active) return;

      const avatarKeys = new Map((avatarResult.data || []).map((row) => [row.group_member_id, row.avatar_key]));
      const memberCards = members.map((m) => {
        const streak = computeAttendanceStreak(m.id, attendance, classroom?.class_days);
        const act = computeActivityPct(m.id, scores, activities);
        const pts = computeParticipationPoints(m.id, logs);
        return { member: m, streak, activityPct: act.pct, points: pts, avatarKey: avatarKeys.get(m.id) };
      });

      const groupLeaderboard = (rankResult.data || []).map((row) => ({ group: { id: row.group_id, group_number: row.group_number }, points: Number(row.points || 0) }))
        .sort((a, b) => b.points - a.points);

      const indLeaderboard = members
        .map((m) => ({ member: m, points: computeParticipationPoints(m.id, logs), avatarKey: avatarKeys.get(m.id) }))
        .sort((a, b) => b.points - a.points)
        .slice(0, 10);

      const personalStreak = computeEngagementStreak(account.group_member_id, attendance, scores, getTodayManila(), classroom?.class_days);

      const snapshot = { account, group, classroom, members, attendance, scores, activities, logs, badges: [], badgeDefinitions: [], memberCards, groupLeaderboard, indLeaderboard, personalStreak, myAvatarKey: avatarKeys.get(account.group_member_id) || user?.avatar_key || null, missions: [], announcements: [] };
      studentDashboardCache = { userId: user.id, data: snapshot, savedAt: Date.now() };
      setData(snapshot);
      setLoading(false);

      Promise.all([
        db.entities.Announcement.filter({ classroom_id: classroomId, is_pinned: true }),
        supabase.rpc('get_student_missions', { p_classroom_id: classroomId }),
        db.entities.Badge.filter({ classroom_id: classroomId }),
        db.entities.BadgeDefinition.filter({ classroom_id: classroomId }),
      ]).then(([announcements, missions, badges, badgeDefinitions]) => {
        if (!active) return;
        setData((current) => {
          const next = current && ({
          ...current,
          badges,
          badgeDefinitions,
          missions: missions.data || [],
          announcements: announcements.sort((a, b) => (b.created_date || "").localeCompare(a.created_date || "")),
          });
          if (next) studentDashboardCache = { userId: user.id, data: next, savedAt: Date.now() };
          return next;
        });
      }).catch((error) => console.warn("Dashboard extras could not be loaded", error));
    }
    load().catch((error) => {
      console.error("Student dashboard could not be loaded", error);
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [user, navigate]);

  if (loading) return <PanelSkeleton />;

  const { account, group, classroom, members, attendance, scores, activities, logs, badges, badgeDefinitions, memberCards, groupLeaderboard, indLeaderboard, personalStreak, myAvatarKey, missions, announcements } = data;
  const myGroupRank = groupLeaderboard.findIndex((g) => g.group.id === group.id) + 1;
  const maxGroupPoints = Math.max(...groupLeaderboard.map((g) => g.points), 1);
  const maxPoints = Math.max(...indLeaderboard.map((i) => i.points), 1);
  const myMemberId = account.group_member_id;
  const myAttendanceRate = attendance.length ? Math.round((attendance.filter((a) => a.group_member_id === myMemberId && a.status === "present").length / Math.max(1, attendance.filter((a) => a.group_member_id === myMemberId).length)) * 100) : 0;
  const myActivityPct = memberCards.find((c) => c.member.id === myMemberId)?.activityPct || 0;
  const myPoints = memberCards.find((c) => c.member.id === myMemberId)?.points || 0;

  const studentProgressAreas = [
    { label: "Attendance", value: myAttendanceRate, color: "bg-clay-sky" },
    { label: "Activity", value: Math.round(myActivityPct), color: "bg-clay-lime" },
    { label: "Participation", value: memberCards.length ? Math.round((memberCards.filter((c) => c.points > 0).length / memberCards.length) * 100) : 0, color: "bg-clay-purple" },
  ];
  const nextMission = missions.find((mission) => mission.is_active && mission.approval_status === "approved") || missions.find((mission) => mission.is_active);
  const nextMissionMinutes = missionEstimate(nextMission);
  const hasChosenHero = Boolean(myAvatarKey);

  return (
    <div className="space-y-6">
      <section className="grid items-center gap-4 lg:grid-cols-[1fr_.82fr] no-print">
        <div>
          <p className="text-sm font-semibold text-[var(--uc-purple)]">Your learning space</p>
          <h1 className="uc-page-title mt-1 text-4xl leading-none sm:text-5xl">Hi, {account.first_name}!</h1>
          <p className="mt-3 text-sm text-ink/60 sm:text-base">One clear step at a time—your everyday effort is adding up.</p>
          <Link to={`${ROUTES.STUDENT.ONBOARDING}?add=1`} className="clay-btn mt-4 bg-white px-3 py-2 text-xs text-ink">Join another class</Link>
        </div>
        <div className="relative flex min-h-44 overflow-hidden rounded-[26px] border border-[rgba(142,92,246,.1)] bg-[linear-gradient(135deg,#F3EFFF_0%,#EAE5FF_100%)] p-5 shadow-[var(--uc-shadow-sm)] items-center">
          {hasChosenHero ? (
            <UserAvatar name={user?.email} avatarKey={myAvatarKey} frameKey={user?.avatar_frame} size="lg" className="ml-1 scale-[1.55]" />
          ) : (
            <NovaAsset pose="welcome" priority className="absolute -bottom-2 -left-1 h-36 w-36" />
          )}
          <div className={`relative min-w-0 ${hasChosenHero ? "ml-16" : "ml-32"}`}>
            <p className="text-xs font-display font-bold text-[var(--uc-purple)]">{hasChosenHero ? "Your hero" : "Nova is here"}</p>
            <h2 className="mt-1 font-display text-2xl font-extrabold leading-none text-[var(--uc-navy-950)]">{hasChosenHero ? "This is your space." : "Small steps, big progress!"}</h2>
            <p className="mt-2 text-sm leading-relaxed text-ink/65">{hasChosenHero ? "Your chosen avatar appears here and across your learner profile." : missions?.length ? `${missions.length} mission${missions.length === 1 ? " is" : "s are"} ready for your group.` : "Your effort this week is building something great."}</p>
            <Link to={ROUTES.STUDENT.SETTINGS} className="mt-3 inline-flex text-xs font-display font-bold text-[var(--uc-purple)] underline">{hasChosenHero ? "Change avatar" : "Unlock an avatar"}</Link>
          </div>
        </div>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <DashboardRangeTabs value={range} onChange={setRange} />
        <ClayChip color="sky">Group {group.group_number} <GroupBadgeMarkers groupId={group.id} badges={badges} definitions={badgeDefinitions} /></ClayChip>
      </div>

      <ClayCard color="purple" className="no-print p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-4 text-white">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/15 font-mono text-xl font-extrabold">1</div>
          <div className="min-w-0 flex-1"><p className="font-display text-sm font-bold text-white/75">Your next step</p><p className="font-display text-lg font-extrabold">{nextMission ? nextMission.title : "Scan your class QR code"}</p><p className="text-xs text-white/75">{nextMission ? `${nextMissionMinutes ? `${nextMissionMinutes} min · ` : ""}Earn up to ${nextMission.xp_reward || 0} personal XP.` : "Every scan and completed activity moves your group closer to its next class goal."}</p></div>
          <Link to={nextMission ? ROUTES.STUDENT.MISSIONS : ROUTES.STUDENT.SCAN} className="clay-btn shrink-0 bg-clay-lime px-4 py-2 text-sm font-display font-bold text-ink">{nextMission ? "Start mission" : "Open scanner"}</Link>
        </div>
      </ClayCard>

      <section className="no-print">
        <div className="grid grid-cols-2 gap-3 text-center sm:gap-3">
          <ClayCard className="p-3">
            <div className="font-mono text-2xl font-extrabold text-clay-sky">{myAttendanceRate}%</div>
            <p className="text-xs font-display font-bold text-ink/60">Attendance</p>
          </ClayCard>
          <ClayCard className="p-3">
            <div className="font-mono text-2xl font-extrabold text-clay-purple">{Math.round(myActivityPct)}%</div>
            <p className="text-xs font-display font-bold text-ink/60">Activity</p>
          </ClayCard>
        </div>
      </section>

      {(missions.length > 0 || myActivityPct < 60) && (
        <ClayCard className="p-3">
          <h3 className="font-display text-xs font-bold text-ink/60 mb-2">Needs attention</h3>
          <ul className="space-y-1 text-sm">
            {missions
              .slice()
              .sort((a, b) => (a.deadline || "").localeCompare(b.deadline || ""))
              .filter((m) => m.deadline)
              .slice(0, 2)
              .map((m) => (
                <li key={m.id} className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-clay-sun" />
                  <span>Due {m.deadline}: {m.title}</span>
                </li>
              ))}
            {myActivityPct < 60 && (
              <li className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-clay-coral" />
                <span>Your activity is below 60% — submit scores soon</span>
              </li>
            )}
          </ul>
        </ClayCard>
      )}

      <section className="no-print">
        <div className="mb-3 flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-clay-purple" /><div><h2 className="font-display text-lg font-extrabold">Your progress</h2><p className="text-xs text-ink/60">Building habits across categories</p></div></div>
        <div className="space-y-3">
          {studentProgressAreas.map((area) => (
            <div key={area.label}>
              <div className="mb-1 flex justify-between text-sm font-display font-bold"><span>{area.label}</span><span>{area.value}%</span></div>
              <div className="h-4 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${area.color}`} style={{ width: `${area.value}%` }} /></div>
            </div>
          ))}
        </div>
      </section>

      {announcements?.length > 0 && (
        <div className="space-y-2">
          {announcements.map((a) => (
            <ClayCard key={a.id} color="purple" className="p-4">
              <p className="font-display font-bold text-white flex items-center gap-2"><Megaphone className="w-4 h-4" /> {a.title}</p>
              {a.body && <p className="text-sm text-white/80 mt-1 whitespace-pre-wrap">{a.body}</p>}
            </ClayCard>
          ))}
        </div>
      )}

      <NovaMessage variant="teacher" tone="violet" title="Nova's learning tip" className="lg:hidden">
            {missions?.length ? (
              <>
                <p>You have {missions.length} active mission{missions.length === 1 ? "" : "s"} waiting for your group.</p>
                <p className="mt-1 text-xs text-ink/55">Next up: {missions[0].title}</p>
              </>
            ) : <p>No active missions right now. Keep your group streak going.</p>}
            {missions?.length > 0 && <Link to={ROUTES.STUDENT.MISSIONS} className="mt-3 inline-flex items-center gap-1 font-display text-sm font-bold underline">Open missions <ArrowRight className="w-4 h-4" /></Link>}
      </NovaMessage>

      <ClayCard tone="green" className="p-4 flex items-center gap-4">
        <div className="clay-medallion bg-clay-sun w-16 h-16 flex items-center justify-center shrink-0">
          <Flame className="w-8 h-8 text-clay-coral" />
        </div>
        <div className="flex-1">
          <p className="font-display font-extrabold text-3xl font-mono leading-none">{personalStreak}</p>
          <p className="font-display font-bold text-sm">your personal day{personalStreak === 1 ? "" : "s"} in a row</p>
          <p className="text-xs text-ink/60">{personalStreak > 0 ? "Your own attendance and activity keep this streak alive!" : "Your attendance or activity on a class day starts your own streak 🔥"}</p>
          <p className="mt-1 text-[10px] text-ink/45">Only your scheduled class days count.</p>
        </div>
      </ClayCard>

      <section>
        <div className="mb-3 flex items-center gap-2"><Users className="h-5 w-5 text-clay-purple" /><div><h2 className="font-display text-lg font-extrabold">Group progress</h2><p className="text-xs text-ink/60">How your group is building habits together</p></div></div>
      <RepresentativeRosterPanel account={account} members={members} />
      <div className="grid gap-4 sm:grid-cols-2">
        {memberCards.map(({ member, streak, activityPct, points, avatarKey }) => (
          <ClayCard key={member.id} className="p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex min-w-0 items-center gap-2"><UserAvatar name={`${member.first_name} ${member.last_name}`} avatarKey={avatarKey} size="sm" /><p className="truncate font-display font-bold">{member.last_name}, {member.first_name}</p></div>
              {member.id === account.group_member_id && <ClayChip color="purple">You</ClayChip>}
            </div>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-xl border-2 border-ink/15 bg-clay-sun/20 p-2">
                <Flame className="w-4 h-4 mx-auto text-clay-coral" />
                <p className="font-mono font-bold text-lg">{streak}</p>
                <p className="text-[10px] font-display">Streak</p>
              </div>
              <div className="rounded-xl border-2 border-ink/15 bg-clay-lime/20 p-2">
                <Star className="w-4 h-4 mx-auto text-clay-lime" />
                <p className="font-mono font-bold text-lg">{Math.round(activityPct)}%</p>
                <p className="text-[10px] font-display">Activity</p>
              </div>
              <div className="rounded-xl border-2 border-ink/15 bg-clay-pink/20 p-2">
                <Trophy className="w-4 h-4 mx-auto text-clay-pink" />
                <p className="font-mono font-bold text-lg">{points}</p>
                <p className="text-[10px] font-display">Points</p>
              </div>
            </div>
          </ClayCard>
        ))}
      </div>
      </section>

      <ClayCard className="p-5">
        <h2 className="font-display font-bold text-lg mb-3 flex items-center gap-2"><Users className="w-5 h-5" /> Group Leaderboard</h2>
        <div className="space-y-2">
          {groupLeaderboard.map((g, i) => {
            const isMe = g.group.id === group.id;
            return (
              <div key={g.group.id} className="flex items-center gap-3">
                <span className="font-mono font-bold w-6">{i + 1}</span>
                <div className="flex-1">
                  <div className="flex justify-between mb-1">
                    <span className={`inline-flex items-center gap-1 font-display font-bold text-sm ${isMe ? "text-clay-pink" : ""}`}>Group {g.group.group_number} <GroupBadgeMarkers groupId={g.group.id} badges={badges} definitions={badgeDefinitions} /> {isMe && "(You)"}</span>
                    <span className="font-mono text-sm">{Math.round(g.points)} pts</span>
                  </div>
                  <div className="h-6 rounded-full border-2 border-ink bg-cream overflow-hidden">
                    <div className={`h-full rounded-full ${isMe ? "bg-clay-pink" : "bg-clay-purple"}`} style={{ width: `${(g.points / maxGroupPoints) * 100}%` }} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </ClayCard>

      <ClayCard className="p-5">
        <h2 className="font-display font-bold text-lg mb-3 flex items-center gap-2"><Trophy className="w-5 h-5" /> Top Points Earners</h2>
        <div className="space-y-2">
          {indLeaderboard.map((item, i) => (
            <div key={item.member.id} className="flex items-center gap-3">
              <span className="font-mono font-bold w-6">{i + 1}</span>
              <UserAvatar name={`${item.member.first_name} ${item.member.last_name}`} avatarKey={item.avatarKey} size="sm" />
              <div className="flex-1">
                <div className="flex justify-between mb-1">
                  <span className="font-display font-bold text-sm">{item.member.last_name}, {item.member.first_name[0]}.</span>
                  <span className="font-mono text-sm">{item.points}pts</span>
                </div>
                <div className="h-5 rounded-full border-2 border-ink bg-cream overflow-hidden">
                  <div className="h-full bg-clay-sky" style={{ width: `${(item.points / maxPoints) * 100}%` }} />
                </div>
              </div>
            </div>
          ))}
          {indLeaderboard.length === 0 && <p className="text-ink/50 text-sm">No points earned yet.</p>}
        </div>
      </ClayCard>
    </div>
  );
}
