
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/AuthContext";
import { Link, Outlet, useLocation } from "react-router-dom";
import { ROUTES } from "@/lib/routes";
import { getActiveStudentAccount } from "@/lib/studentContext";
import { supabase } from "@/api/supabaseClient";

import {
  Home, Settings, FileText, QrCode, Award, ClipboardCheck,
  LogOut, Menu, X, Target, Gift, User,
  Megaphone, BarChart3, UserCheck, HelpCircle, Users, ClipboardList, Archive, Trophy, Upload, Download, ChevronDown, Image, History, MoreHorizontal,
} from "lucide-react";
import ThemeToggle from "@/components/ThemeToggle";
import StudentClassSwitcher from "@/components/StudentClassSwitcher";
import TeacherClassSwitcher from "@/components/TeacherClassSwitcher";
import OfflineStatus from "@/components/OfflineStatus";
import NotificationBell from "@/components/NotificationBell";
import BrandMark from "@/components/BrandMark";
import UserAvatar from "@/components/visual/UserAvatar";
import { UIAsset } from "@/components/visual/UIAsset";
import { GroupBadgeProvider } from "@/components/GroupBadgeContext";

const NAV_ASSET_BY_LABEL = {
  Dashboard: "home",
  Analytics: "analytics",
  Missions: "missions",
  "QR Generator": "qr",
  "Score Import": "scoreImport",
  Activities: "activities",
  "Reward Catalog": "reward",
  Rewards: "reward",
  Badges: "badge",
  Roster: "students",
  Accounts: "profile",
  Announcements: "notifications",
  "Activity Logs": "history",
  "Activity Proof": "view",
  "Export Data": "download",
  "Mission Archive": "archive",
  Leaderboard: "leaderboard",
  "Class Setup": "classes",
  Settings: "settings",
  "Help Guide": "help",
  Help: "help",
  Attendance: "attendance",
  "Activity Scores": "activities",
  "Scan QR": "qr",
  History: "history",
};

const TEACHER_NAV_SECTIONS = [
  {
    label: "Home",
    icon: Home,
    items: [
      { label: "Dashboard",  path: ROUTES.TEACHER.DASHBOARD,  icon: Home },
      { label: "Analytics",  path: ROUTES.TEACHER.ANALYTICS,  icon: BarChart3 },
    ],
  },
  {
    label: "Class",
    icon: Users,
    items: [
      { label: "Roster",         path: ROUTES.TEACHER.ROSTER,             icon: Users },
      { label: "Attendance",     path: ROUTES.TEACHER.ATTENDANCE,         icon: ClipboardCheck },
      { label: "Accounts",       path: ROUTES.TEACHER.STUDENT_MANAGEMENT, icon: UserCheck },
      { label: "Announcements",  path: ROUTES.TEACHER.ANNOUNCEMENTS,      icon: Megaphone },
    ],
  },
  {
    label: "Learning",
    icon: Target,
    items: [
      { label: "Missions",       path: ROUTES.TEACHER.MISSIONS,     icon: Target },
      { label: "QR Generator",   path: ROUTES.TEACHER.QR_GENERATOR, icon: QrCode },
      { label: "Score Import", path: ROUTES.TEACHER.SCORE_IMPORT, icon: Upload },
      { label: "Activities", path: ROUTES.TEACHER.ACTIVITIES, icon: FileText },
    ],
  },
  {
    label: "Rewards",
    icon: Gift,
    items: [
      { label: "Reward Catalog", path: ROUTES.TEACHER.REWARDS, icon: Gift },
      { label: "Badges", path: ROUTES.TEACHER.BADGES, icon: Award },
    ],
  },
  {
    label: "Reports",
    icon: BarChart3,
    items: [
      { label: "Activity Logs",   path: ROUTES.TEACHER.ACTIVITY_LOGS,  icon: ClipboardList },
      { label: "Activity Proof", path: ROUTES.TEACHER.EVIDENCE,        icon: Image },
      { label: "Export Data",     path: ROUTES.TEACHER.EXPORT_DATA,    icon: Download },
      { label: "Mission Archive", path: ROUTES.TEACHER.MISSION_ARCHIVE, icon: Archive },
      { label: "Leaderboard",     path: ROUTES.LEADERBOARD,              icon: Trophy },
    ],
  },
  {
    label: "Settings",
    icon: Settings,
    items: [
      { label: "Class Setup", path: ROUTES.TEACHER.ONBOARDING, icon: Settings },
      { label: "Settings",    path: ROUTES.TEACHER.SETTINGS,   icon: User },
      { label: "Help Guide",  path: ROUTES.TEACHER.HELP_GUIDE, icon: HelpCircle },
    ],
  },
];

const STUDENT_NAV = [
  { label: "Dashboard",       path: ROUTES.STUDENT.DASHBOARD,  icon: Home },
  { label: "Attendance",      path: ROUTES.STUDENT.ATTENDANCE, icon: ClipboardCheck },
  { label: "Activity Scores", path: ROUTES.STUDENT.SCORES,     icon: FileText },
  { label: "Scan QR",         path: ROUTES.STUDENT.SCAN,       icon: QrCode },
  { label: "Badges",          path: ROUTES.STUDENT.BADGES,     icon: Award },
  { label: "Missions",        path: ROUTES.STUDENT.MISSIONS,   icon: Target },
  { label: "Rewards",         path: ROUTES.STUDENT.REWARDS,    icon: Gift },
  { label: "History",         path: ROUTES.STUDENT.HISTORY,    icon: History },
  { label: "Leaderboard",     path: ROUTES.STUDENT.LEADERBOARD,icon: Trophy },
  { label: "Settings",        path: ROUTES.STUDENT.SETTINGS,   icon: Settings },
  { label: "Help",            path: ROUTES.STUDENT.HELP,       icon: HelpCircle },
];

export default function Layout() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [openSection, setOpenSection] = useState("Home");
  const [studentAvatarKey, setStudentAvatarKey] = useState(null);

  const isTeacher = location.pathname.startsWith("/teacher") || location.pathname === ROUTES.LEADERBOARD;
  const mobileNav = isTeacher
    ? [
        { label: "Home", path: ROUTES.TEACHER.DASHBOARD, icon: Home },
        { label: "Attendance", path: ROUTES.TEACHER.ATTENDANCE, icon: ClipboardCheck },
        { label: "Missions", path: ROUTES.TEACHER.MISSIONS, icon: Target },
        { label: "QR", path: ROUTES.TEACHER.QR_GENERATOR, icon: QrCode },
      ]
    : STUDENT_NAV;
  const learnerTheme = !isTeacher && user?.banner_theme ? `uc-theme-${user.banner_theme}` : "";
  const canvasTheme = learnerTheme || "uc-app-background";

  useEffect(() => {
    const current = TEACHER_NAV_SECTIONS.find((section) => section.items.some((item) => item.path === location.pathname));
    if (current) setOpenSection(current.label);
  }, [location.pathname]);

  useEffect(() => {
    let active = true;
    if (isTeacher || !user?.id) { setStudentAvatarKey(null); return () => { active = false; }; }
    void (async () => {
      const account = await getActiveStudentAccount(user.id);
      if (!account || !active) return;
      const { data } = await supabase.rpc("get_classroom_student_avatars", { p_classroom_id: account.classroom_id });
      const saved = (data || []).find((row) => row.group_member_id === account.group_member_id)?.avatar_key;
      if (active) setStudentAvatarKey(saved || user.avatar_key || null);
    })().catch(() => { if (active) setStudentAvatarKey(user.avatar_key || null); });
    return () => { active = false; };
  }, [isTeacher, user?.id, user?.avatar_key]);

  const handleLogout = async () => { await logout(true); };

  const NavItem = ({ item }) => {
    const Icon = item.icon;
    const assetName = NAV_ASSET_BY_LABEL[item.label];
    const active = location.pathname === item.path;
    return (
      <Link key={item.path} to={item.path} onClick={() => setOpen(false)} className={`flex min-h-11 items-center gap-2 rounded-xl px-3 py-2 text-sm font-display font-bold transition-colors ${active ? "bg-clay-purple text-white shadow-[0_4px_10px_rgba(142,92,246,.22)]" : "text-ink/70 hover:bg-clay-purple/10 hover:text-ink"}`}>
        {assetName ? <UIAsset name={assetName} className="h-4 w-4" /> : <Icon className="w-4 h-4" />}
        {item.label}
      </Link>
    );
  };

  const SectionMenu = ({ section }) => {
    const Icon = section.icon;
    const expanded = openSection === section.label;
    return (
      <div>
        <button type="button" onClick={() => setOpenSection(expanded ? "" : section.label)} aria-expanded={expanded} className={`w-full flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-display font-extrabold ${expanded ? "bg-clay-purple text-white" : "text-ink/70 hover:bg-clay-purple/10"}`}>
          <Icon className="w-4 h-4" />
          <span className="flex-1 text-left">{section.label}</span>
          <ChevronDown className={`w-4 h-4 transition-transform ${expanded ? "rotate-180" : ""}`} />
        </button>
        {expanded && <div className="mt-1 ml-2 pl-2 border-l-2 border-ink/10 flex flex-col gap-1">{section.items.map((item) => <NavItem key={item.path} item={item} />)}</div>}
      </div>
    );
  };

  return (
    <GroupBadgeProvider user={user} isTeacher={isTeacher}>
    <div className={`min-h-screen bg-[var(--uc-bg)] ${canvasTheme}`}>
      <OfflineStatus />
      <header className="sticky top-0 z-40 border-b border-ink/5 bg-white/90 text-ink shadow-[0_2px_14px_rgba(29,38,88,.04)] backdrop-blur no-print">
        <div className="mx-auto flex h-[4.5rem] max-w-[1440px] items-center justify-between px-4 sm:px-6">
          <Link to={isTeacher ? ROUTES.TEACHER.DASHBOARD : ROUTES.STUDENT.DASHBOARD} className="flex items-center gap-2">
            <BrandMark />
            <span className="font-display text-xl font-extrabold tracking-tight text-[var(--uc-navy-950)] sm:text-2xl">UniClass</span>
          </Link>
          <p className="hidden flex-1 text-center text-sm font-medium text-ink/60 lg:block">{isTeacher ? "Teacher workspace" : "Your learning space"}</p>
          <div className="flex items-center gap-3">
            {isTeacher ? <TeacherClassSwitcher user={user} /> : <StudentClassSwitcher user={user} />}
            <NotificationBell teacher={isTeacher} />
            <span className="hidden sm:flex"><UserAvatar name={user?.email} avatarKey={isTeacher ? user?.avatar_key : studentAvatarKey || user?.avatar_key} frameKey={user?.avatar_frame} size="md" /></span>
            <ThemeToggle />
            <button onClick={() => setOpen(!open)} className="lg:hidden clay-btn bg-clay-purple text-white px-2 py-2" aria-label="Menu">
              {open ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-[1440px] gap-6 px-4 py-5 sm:px-6 lg:py-7">
        <aside className="hidden w-56 shrink-0 lg:block no-print">
          <nav className="sticky top-[5.75rem] flex max-h-[calc(100vh-7rem)] flex-col gap-3 overflow-y-auto rounded-[22px] border border-[rgba(16,32,101,.06)] bg-white/85 p-3 shadow-[var(--uc-shadow-sm)]">
            {isTeacher ? (
              TEACHER_NAV_SECTIONS.map((section) => <SectionMenu key={section.label} section={section} />)
            ) : (
              <div className="flex flex-col gap-2">
                {STUDENT_NAV.map((item) => <NavItem key={item.path} item={item} />)}
              </div>
            )}
            <button onClick={handleLogout} className="mt-2 flex min-h-11 w-full items-center gap-2 rounded-xl px-3 py-2 text-sm font-display font-bold text-clay-coral transition-colors hover:bg-clay-coral/10">
              <LogOut className="w-5 h-5" /> Log out
            </button>
          </nav>
        </aside>

        {open && (
          <div className="fixed inset-0 top-16 z-30 bg-[var(--uc-bg)]/95 backdrop-blur lg:hidden no-print" onClick={() => setOpen(false)}>
            <nav className="mx-auto flex max-h-[calc(100vh-4rem)] max-w-2xl flex-col gap-2 overflow-y-auto p-4" onClick={(event) => event.stopPropagation()}>
              {isTeacher ? (
                TEACHER_NAV_SECTIONS.map((section) => <SectionMenu key={section.label} section={section} />)
              ) : (
                STUDENT_NAV.map((item) => <NavItem key={item.path} item={item} />)
              )}
              <button onClick={handleLogout} className="mt-4 flex min-h-11 items-center gap-2 rounded-xl bg-clay-coral px-4 py-3 text-sm font-display font-bold text-white">
                <LogOut className="w-5 h-5" /> Log out
              </button>
            </nav>
          </div>
        )}

        <main className="uc-compact-page flex-1 min-w-0 pb-20 lg:pb-6">
          <Outlet />
        </main>
      </div>

      <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-40 border-t border-ink/10 bg-white/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-4px_18px_rgba(29,38,88,.08)] backdrop-blur no-print">
        <div className="flex h-16 items-center justify-center gap-1 overflow-x-auto px-2 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
          {mobileNav.map((item) => {
            const Icon = item.icon;
            const assetName = NAV_ASSET_BY_LABEL[item.label];
            const active = location.pathname === item.path;
            return (
            <Link key={item.path} to={item.path} className={`flex min-w-16 shrink-0 flex-col items-center justify-center gap-0.5 rounded-lg px-2 py-1 text-center ${active ? "bg-clay-purple/10 text-clay-purple" : "text-ink/55"}`}>
                {assetName ? <UIAsset name={assetName} className="h-6 w-6" /> : <Icon className="h-6 w-6" />}
                <span className="text-[10px] font-display font-bold">{item.label.split(" ")[0]}</span>
              </Link>
            );
          })}
          {isTeacher && <button type="button" onClick={() => setOpen(true)} aria-expanded={open} aria-label="Open more navigation options" className={`flex min-w-16 shrink-0 flex-col items-center justify-center gap-0.5 rounded-lg px-2 py-1 text-center ${open ? "bg-clay-purple/10 text-clay-purple" : "text-ink/55"}`}>
            <MoreHorizontal className="h-6 w-6" />
            <span className="text-[10px] font-display font-bold">More</span>
          </button>}
        </div>
      </nav>
    </div>
    </GroupBadgeProvider>
  );
}
