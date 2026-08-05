import { useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/AuthContext";
import { ROUTES } from "@/lib/routes";
import RoleRouter from "@/pages/RoleRouter";
import {
  ArrowRight, BarChart3, CheckCircle2, ClipboardCheck, Gift,
  GraduationCap, QrCode, Sparkles, Trophy, UsersRound,
} from "lucide-react";
import ThemeToggle from "@/components/ThemeToggle";

const features = [
  {
    icon: QrCode,
    color: "bg-clay-sky",
    title: "Fast QR attendance",
    copy: "Start class with a time-limited QR code and see attendance update in real time.",
  },
  {
    icon: Trophy,
    color: "bg-clay-sun",
    title: "Motivation that lasts",
    copy: "Turn participation, missions, and positive behavior into points, badges, and rewards.",
  },
  {
    icon: BarChart3,
    color: "bg-clay-lime",
    title: "Clear learning signals",
    copy: "Keep scores, participation, student trends, and at-risk alerts in one teacher-friendly view.",
  },
];

function ActionButton({ children, className = "", ...props }) {
  return <button className={`clay-btn px-5 py-3 text-sm sm:text-base ${className}`} {...props}>{children}</button>;
}

export default function Landing() {
  const { isAuthenticated, isLoadingAuth } = useAuth();
  const navigate = useNavigate();

  if (isLoadingAuth) {
    return <div className="fixed inset-0 flex items-center justify-center bg-cream"><div className="w-8 h-8 border-4 border-clay-purple/30 border-t-clay-purple rounded-full animate-spin" /></div>;
  }
  if (isAuthenticated) return <RoleRouter />;

  return (
    <div className="min-h-screen overflow-x-hidden bg-cream text-ink">
      <div className="pointer-events-none fixed inset-0 -z-0 opacity-[0.045] [background-image:radial-gradient(#17162B_1.2px,transparent_1.2px)] [background-size:22px_22px]" />
      <header className="sticky top-0 z-20 border-b-[3px] border-ink bg-cream/95 backdrop-blur px-4 py-3">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3">
          <a href="#top" className="flex items-center gap-2" aria-label="UniClass home">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl border-[3px] border-ink bg-clay-purple text-white shadow-[3px_3px_0_#17162B]"><GraduationCap aria-hidden="true" /></span>
            <span className="font-display text-2xl font-extrabold tracking-tight">UniClass</span>
          </a>
          <nav className="hidden items-center gap-5 text-sm font-bold md:flex" aria-label="Main navigation">
            <a href="#features" className="hover:text-clay-purple">Features</a>
            <a href="#how-it-works" className="hover:text-clay-purple">How it works</a>
            <a href="#for-everyone" className="hover:text-clay-purple">For your class</a>
          </nav>
          <div className="flex gap-2">
            <ThemeToggle />
            <ActionButton onClick={() => navigate(ROUTES.LOGIN)} className="hidden bg-white sm:inline-flex">Log in</ActionButton>
            <ActionButton onClick={() => navigate(ROUTES.REGISTER)} className="bg-clay-purple text-white">Get started <ArrowRight className="h-4 w-4" /></ActionButton>
          </div>
        </div>
      </header>

      <main id="top" className="relative z-10">
        <section className="mx-auto grid max-w-7xl items-center gap-10 px-4 py-14 lg:grid-cols-2 lg:px-8 lg:py-20">
          <div>
            <p className="mb-5 inline-flex items-center gap-2 rounded-full border-2 border-ink bg-clay-sun/40 px-4 py-2 text-xs font-extrabold uppercase tracking-wide shadow-[2px_2px_0_#17162B]"><Sparkles className="h-4 w-4" /> Classroom routines, made rewarding</p>
            <h1 className="max-w-2xl font-display text-5xl font-extrabold leading-[0.98] sm:text-6xl lg:text-7xl">Make every class feel like <span className="inline-block rounded-2xl border-[3px] border-ink bg-clay-purple px-3 py-1 text-white shadow-[4px_4px_0_#17162B]">progress.</span></h1>
            <p className="mt-6 max-w-xl text-lg font-medium leading-relaxed text-ink/75">UniClass gives teachers one calm place to run attendance, missions, rewards, and student insights—while giving students a fun reason to show up and participate.</p>
            <div className="mt-8 flex flex-col gap-4 sm:flex-row">
              <ActionButton onClick={() => navigate(ROUTES.REGISTER)} className="bg-clay-sky">Create a student account <ArrowRight className="h-4 w-4" /></ActionButton>
              <ActionButton onClick={() => navigate(ROUTES.LOGIN)} className="bg-white">Teacher log in</ActionButton>
            </div>
            <div className="mt-8 flex flex-wrap gap-x-5 gap-y-2 text-sm font-bold text-ink/75">
              <span className="inline-flex items-center gap-1"><CheckCircle2 className="h-4 w-4 text-clay-purple" /> QR attendance</span>
              <span className="inline-flex items-center gap-1"><CheckCircle2 className="h-4 w-4 text-clay-purple" /> Missions & rewards</span>
              <span className="inline-flex items-center gap-1"><CheckCircle2 className="h-4 w-4 text-clay-purple" /> Progress insights</span>
            </div>
          </div>

          <div className="relative mx-auto w-full max-w-xl rounded-[28px] border-[3px] border-ink bg-white p-5 shadow-[8px_8px_0_#17162B] sm:p-7">
            <div className="mb-5 flex items-center justify-between border-b-2 border-ink pb-4"><span className="font-display text-xl font-extrabold">Today&apos;s class</span><span className="rounded-full border-2 border-ink bg-clay-pink px-3 py-1 text-xs font-black text-white">LIVE</span></div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-2xl border-[3px] border-ink bg-ink p-5 text-white"><QrCode className="mb-5 h-14 w-14 rounded-lg bg-white p-2 text-ink" /><p className="font-display text-xl font-bold">Attendance open</p><p className="mt-1 text-sm text-white/70">Scan to check in</p><div className="mt-5 h-2 overflow-hidden rounded-full bg-white/20"><div className="h-full w-3/4 rounded-full bg-clay-lime" /></div></div>
              <div className="space-y-3"><div className="rounded-2xl border-[3px] border-ink bg-clay-sun p-4"><Gift className="mb-2 h-7 w-7" /><p className="font-display font-extrabold">Reward ready!</p><p className="text-sm font-medium">Participation capsule</p></div><div className="rounded-2xl border-[3px] border-ink bg-clay-sky p-4"><ClipboardCheck className="mb-2 h-7 w-7" /><p className="font-display font-extrabold">Mission progress</p><p className="text-sm font-medium">18 of 24 submitted</p></div></div>
            </div>
            <div className="mt-4 flex items-center justify-between rounded-2xl border-[3px] border-ink bg-cream p-4"><div><p className="font-display font-extrabold">Class momentum</p><p className="text-sm font-medium text-ink/70">Participation is up this week</p></div><span className="text-3xl">🚀</span></div>
          </div>
        </section>

        <section id="features" className="border-y-[3px] border-ink bg-white px-4 py-16 lg:px-8">
          <div className="mx-auto max-w-7xl"><p className="font-display text-lg font-extrabold text-clay-purple">Built for the rhythm of real classrooms</p><h2 className="mt-2 max-w-2xl font-display text-4xl font-extrabold sm:text-5xl">Less admin. More meaningful moments.</h2><div className="mt-10 grid gap-6 md:grid-cols-3">{features.map(({ icon: Icon, color, title, copy }) => <article key={title} className="xp-card clay-tile bg-cream p-6"><span className={`mb-5 flex h-12 w-12 items-center justify-center rounded-xl border-[3px] border-ink ${color}`}><Icon className="h-6 w-6" /></span><h3 className="text-2xl">{title}</h3><p className="mt-2 leading-relaxed text-ink/70">{copy}</p></article>)}</div></div>
        </section>

        <section id="how-it-works" className="mx-auto max-w-7xl px-4 py-16 lg:px-8"><div className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr]"><div><p className="font-display text-lg font-extrabold text-clay-purple">Simple by design</p><h2 className="mt-2 font-display text-4xl font-extrabold sm:text-5xl">A better routine in three steps.</h2><p className="mt-5 max-w-md text-lg text-ink/70">Designed for classrooms that need structure without losing the joy of learning.</p></div><ol className="grid gap-4">{[["1","Set up your class","Teachers create a space and share access with students."],["2","Run class with confidence","Take attendance, assign missions, and recognize positive effort."],["3","Celebrate and learn","Students collect rewards while teachers see the trends that matter."]].map(([number, title, copy]) => <li key={number} className="flex gap-4 rounded-2xl border-[3px] border-ink bg-white p-5 shadow-[3px_3px_0_#17162B]"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-[3px] border-ink bg-clay-lime font-display text-lg font-extrabold">{number}</span><div><h3 className="text-xl">{title}</h3><p className="mt-1 text-ink/70">{copy}</p></div></li>)}</ol></div></section>

        <section id="for-everyone" className="border-t-[3px] border-ink bg-clay-purple px-4 py-16 text-white lg:px-8"><div className="mx-auto grid max-w-7xl gap-8 md:grid-cols-2"><div className="rounded-3xl border-[3px] border-ink bg-white p-7 text-ink shadow-[5px_5px_0_#17162B]"><UsersRound className="h-9 w-9" /><h2 className="mt-4 text-3xl">For teachers</h2><p className="mt-2 text-ink/70">Keep the essentials organized and make encouragement visible—without adding another complicated system.</p><ActionButton onClick={() => navigate(ROUTES.LOGIN)} className="mt-6 bg-clay-sun">Teacher log in</ActionButton></div><div className="rounded-3xl border-[3px] border-ink bg-clay-sky p-7 text-ink shadow-[5px_5px_0_#17162B]"><GraduationCap className="h-9 w-9" /><h2 className="mt-4 text-3xl">For students</h2><p className="mt-2 text-ink/70">Show up, complete missions, earn rewards, and see your progress build—one class at a time.</p><ActionButton onClick={() => navigate(ROUTES.REGISTER)} className="mt-6 bg-white">Create your account</ActionButton></div></div></section>
      </main>
      <footer className="relative z-10 border-t-[3px] border-ink bg-cream px-4 py-6 text-center text-sm font-medium text-ink/70">UniClass · Making classroom progress visible and rewarding.</footer>
    </div>
  );
}
