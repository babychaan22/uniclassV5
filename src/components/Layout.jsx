
import { useState } from "react";
import { useAuth } from "@/lib/AuthContext";
import { Link, Outlet, useLocation } from "react-router-dom";
import { ROUTES } from "@/lib/routes";

import {
  Home, Settings, FileText, QrCode, Award, ClipboardCheck,
  LogOut, Menu, X, Target, Gift, User,
  Megaphone, BarChart3, UserCheck, HelpCircle, Users, ClipboardList, Archive, Trophy, Upload, Download,
} from "lucide-react";
import ThemeToggle from "@/components/ThemeToggle";
import { MascotBadge } from "@/components/MascotWidget";

const TEACHER_NAV_GROUPS = [
  {
    label: "Overview",
    items: [
      { label: "Dashboard",  path: ROUTES.TEACHER.DASHBOARD,  icon: Home },
      { label: "Analytics",  path: ROUTES.TEACHER.ANALYTICS,  icon: BarChart3 },
    ],
  },
  {
    label: "Grading",
    items: [
      { label: "Score Import", path: ROUTES.TEACHER.SCORE_IMPORT, icon: Upload },
      { label: "Roster",       path: ROUTES.TEACHER.ROSTER,       icon: Users },
    ],
  },
  {
    label: "Engagement",
    items: [
      { label: "QR Generator",   path: ROUTES.TEACHER.QR_GENERATOR, icon: QrCode },
      { label: "Missions",       path: ROUTES.TEACHER.MISSIONS,     icon: Target },
      { label: "Reward Catalog", path: ROUTES.TEACHER.REWARDS,      icon: Gift },
    ],
  },
  {
    label: "Class",
    items: [
      { label: "Accounts",      path: ROUTES.TEACHER.STUDENT_MANAGEMENT, icon: UserCheck },
      { label: "Announcements", path: ROUTES.TEACHER.ANNOUNCEMENTS,      icon: Megaphone },
    ],
  },
  {
    label: "Data",
    items: [
      { label: "Activity Logs",   path: ROUTES.TEACHER.ACTIVITY_LOGS,  icon: ClipboardList },
      { label: "Export Data",     path: ROUTES.TEACHER.EXPORT_DATA,    icon: Download },
      { label: "Mission Archive", path: ROUTES.TEACHER.MISSION_ARCHIVE, icon: Archive },
    ],
  },
  {
    label: "Setup",
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
  { label: "Leaderboard",     path: ROUTES.STUDENT.LEADERBOARD,icon: Trophy },
  { label: "Help",            path: ROUTES.STUDENT.HELP,       icon: HelpCircle },
];

export default function Layout() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const [open, setOpen] = useState(false);

  const isTeacher = location.pathname.startsWith("/teacher") || location.pathname === ROUTES.LEADERBOARD;
  const nav = isTeacher ? TEACHER_NAV_GROUPS.flatMap((g) => g.items) : STUDENT_NAV;

  const handleLogout = async () => { await logout(true); };

  const NavItem = ({ item }) => {
    const Icon = item.icon;
    const active = location.pathname === item.path;
    return (
      <Link key={item.path} to={item.path} className={`clay-btn justify-start px-4 py-3 text-sm ${active ? "bg-clay-pink text-white" : "bg-cream text-ink"}`}>
        <Icon className="w-5 h-5" />
        {item.label}
      </Link>
    );
  };

  return (
    <div className="min-h-screen bg-cream">
      <header className="sticky top-0 z-40 bg-clay-purple text-white border-b-[3px] border-ink no-print">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
          <Link to={isTeacher ? ROUTES.TEACHER.DASHBOARD : ROUTES.STUDENT.DASHBOARD} className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-full bg-clay-pink border-[3px] border-ink flex items-center justify-center shadow-[2px_2px_0_#17162B]">
              <MascotBadge />
            </div>
            <span className="font-display font-extrabold text-lg sm:text-xl">UniClass</span>
          </Link>
          <div className="flex items-center gap-3">
            <span className="hidden sm:block text-sm font-display font-bold opacity-90">{user?.email}</span>
            <ThemeToggle />
            <button onClick={() => setOpen(!open)} className="lg:hidden clay-btn bg-clay-pink text-white px-2 py-2" aria-label="Menu">
              {open ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-4 py-6 flex gap-6">
        <aside className="hidden lg:block w-56 shrink-0 no-print">
          <nav className="flex flex-col gap-3">
            {isTeacher ? (
              TEACHER_NAV_GROUPS.map((group) => (
                <div key={group.label}>
                  <p className="text-[10px] font-display font-extrabold uppercase tracking-wider text-ink/40 px-4 mb-1">{group.label}</p>
                  <div className="flex flex-col gap-1.5 mb-2">
                    {group.items.map((item) => <NavItem key={item.path} item={item} />)}
                  </div>
                </div>
              ))
            ) : (
              <div className="flex flex-col gap-2">
                {STUDENT_NAV.map((item) => <NavItem key={item.path} item={item} />)}
              </div>
            )}
            {isTeacher && (
              <Link to={ROUTES.LEADERBOARD} className={`clay-btn justify-start px-4 py-3 text-sm ${location.pathname === ROUTES.LEADERBOARD ? "bg-clay-pink text-white" : "bg-cream text-ink"}`}>
                <Trophy className="w-5 h-5" /> Leaderboard
              </Link>
            )}
            <button onClick={handleLogout} className="clay-btn justify-start px-4 py-3 text-sm bg-clay-coral text-white mt-2">
              <LogOut className="w-5 h-5" /> Log out
            </button>
          </nav>
        </aside>

        {open && (
          <div className="lg:hidden fixed inset-0 top-16 z-30 bg-cream/95 backdrop-blur no-print" onClick={() => setOpen(false)}>
            <nav className="flex flex-col gap-2 p-4">
              {isTeacher ? (
                TEACHER_NAV_GROUPS.map((group) => (
                  <div key={group.label}>
                    <p className="text-[10px] font-display font-extrabold uppercase tracking-wider text-ink/40 px-4 mb-1">{group.label}</p>
                    <div className="flex flex-col gap-1.5 mb-2">
                      {group.items.map((item) => <NavItem key={item.path} item={item} />)}
                    </div>
                  </div>
                ))
              ) : (
                STUDENT_NAV.map((item) => <NavItem key={item.path} item={item} />)
              )}
              {isTeacher && (
                <Link to={ROUTES.LEADERBOARD} onClick={() => setOpen(false)} className={`clay-btn justify-start px-4 py-3 text-sm ${location.pathname === ROUTES.LEADERBOARD ? "bg-clay-pink text-white" : "bg-cream text-ink"}`}>
                  <Trophy className="w-5 h-5" /> Leaderboard
                </Link>
              )}
              <button onClick={handleLogout} className="clay-btn justify-start px-4 py-3 text-sm bg-clay-coral text-white mt-4">
                <LogOut className="w-5 h-5" /> Log out
              </button>
            </nav>
          </div>
        )}

        <main className="flex-1 min-w-0 pb-20 lg:pb-6">
          <Outlet />
        </main>
      </div>

      <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-clay-purple border-t-[3px] border-ink no-print">
        <div className="flex overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden items-center h-16 gap-1 px-2">
          {nav.map((item) => {
            const Icon = item.icon;
            const active = location.pathname === item.path;
            return (
              <Link key={item.path} to={item.path} className={`flex flex-col items-center justify-center gap-0.5 px-2.5 py-1 rounded-lg shrink-0 ${active ? "text-clay-sun" : "text-white/70"}`}>
                <Icon className="w-5 h-5" />
                <span className="text-[10px] font-display font-bold">{item.label.split(" ")[0]}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
