import { useEffect, useState } from "react";
import { Loader2, Lock, Sparkles, UserRound } from "lucide-react";
import { Link } from "react-router-dom";
import { useAuth } from "@/lib/AuthContext";
import { db, supabase } from "@/api/supabaseClient";
import ClayCard from "@/components/ClayCard";
import UserAvatar, { AVATAR_OPTIONS } from "@/components/visual/UserAvatar";
import { getActiveStudentAccount } from "@/lib/studentContext";
import { ROUTES } from "@/lib/routes";
import { applyStyleChoice, getPersonalRewardDashboard } from "@/lib/secureActions";

const THEMES = [
  { key: "sky-banner", label: "Sky", emoji: "☁️", className: "uc-theme-sky-banner" },
  { key: "sunset-banner", label: "Sunset", emoji: "🌅", className: "uc-theme-sunset-banner" },
  { key: "starry-banner", label: "Starry", emoji: "🌟", className: "uc-theme-starry-banner" },
];

export default function StudentSettings() {
  const { user, checkUserAuth } = useAuth();
  const [credits, setCredits] = useState({ avatar: null, theme: null });
  const [busy, setBusy] = useState(null);
  const [notice, setNotice] = useState(null);

  async function load() {
    if (!user) return;
    const account = await getActiveStudentAccount(user.id);
    if (!account) return;
    const wallet = await getPersonalRewardDashboard(account.classroom_id);
    const active = (wallet.claims || []).filter((claim) => claim.status === "active");
    setCredits({ avatar: active.find((claim) => claim.reward_type === "avatar_choice") || null, theme: active.find((claim) => claim.reward_type === "theme_choice") || null });
  }
  useEffect(() => { void load().catch((error) => console.warn("Could not load style choices", error)); }, [user]);

  async function selectStyle(type, assetKey) {
    const credit = type === "avatar" ? credits.avatar : credits.theme;
    if (!credit) return;
    setBusy(assetKey); setNotice(null);
    try {
      await applyStyleChoice(credit.id, assetKey);
      if (type === "avatar") {
        await db.auth.updateMe({ avatar_key: assetKey });
        const { error } = await supabase.rpc("set_my_student_avatar", { p_avatar_key: assetKey });
        if (error) throw error;
      } else await db.auth.updateMe({ banner_theme: assetKey });
      await checkUserAuth(); await load();
      setNotice({ ok: true, text: `${type === "avatar" ? "Avatar" : "Theme"} equipped. Earn another 20 XP to change it again.` });
    } catch (error) { setNotice({ ok: false, text: error.message || "Your choice could not be equipped." }); }
    finally { setBusy(null); }
  }

  const avatarUnlocked = Boolean(credits.avatar);
  const themeUnlocked = Boolean(credits.theme);
  return <div className="mx-auto max-w-4xl space-y-5 sm:space-y-6">
    <section className="uc-card relative overflow-hidden px-5 py-5 sm:px-7 sm:py-6"><div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-sm font-semibold text-[var(--uc-purple)]">Your account</p><h1 className="uc-page-title mt-1 text-3xl sm:text-4xl">Profile settings</h1><p className="mt-1 max-w-xl text-sm leading-relaxed text-ink/60">A 20-XP style unlock lets you choose one avatar or learner-space theme. Each choice is used immediately.</p></div><div className="flex items-center gap-3 rounded-2xl bg-[var(--uc-purple-soft)] px-4 py-3"><UserAvatar name={user?.email} avatarKey={user?.avatar_key} frameKey={user?.avatar_frame} size="lg" /><div><p className="font-display text-base font-extrabold text-[var(--uc-navy-950)]">Your public avatar</p><p className="text-xs text-ink/60">Visible to your classmates.</p></div></div></div></section>
    {notice && <p role="status" className={`text-center text-sm font-display font-bold ${notice.ok ? "text-clay-lime" : "text-clay-coral"}`}>{notice.text}</p>}
    <ClayCard className="overflow-hidden p-5 sm:p-6"><div className="flex items-start justify-between gap-4 border-b border-ink/5 pb-4"><div className="flex items-start gap-3"><span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[var(--uc-purple-soft)]"><UserRound className="h-5 w-5 text-[var(--uc-purple)]" /></span><div><h2 className="font-display text-xl font-extrabold text-[var(--uc-navy-950)]">Choose an avatar</h2><p className="mt-0.5 text-sm text-ink/60">{avatarUnlocked ? "Your avatar choice is ready—select one now." : "Locked until you unlock an Avatar choice for 20 XP."}</p></div></div>{avatarUnlocked ? <span className="rounded-full bg-clay-lime/30 px-3 py-1 text-xs font-display font-bold">Choice ready</span> : <Lock className="h-5 w-5 text-ink/40" />}</div><div className="mt-5 grid grid-cols-3 gap-3 sm:grid-cols-4">{AVATAR_OPTIONS.map((avatar) => { const selected = user?.avatar_key === avatar.id; return <button key={avatar.id} type="button" disabled={!avatarUnlocked || Boolean(busy)} onClick={() => selectStyle("avatar", avatar.id)} className={`group flex min-h-28 flex-col items-center justify-center gap-1.5 rounded-2xl border-2 p-3 transition-all ${selected ? "border-[var(--uc-purple)] bg-[var(--uc-purple-soft)]" : "border-transparent bg-[var(--uc-bg)]"} ${avatarUnlocked ? "hover:border-[var(--uc-purple)]/30" : "cursor-not-allowed opacity-45"}`}><img src={avatar.src} alt="" aria-hidden="true" className="h-14 w-14 rounded-full border-2 border-white bg-white shadow-sm" loading="lazy" /><span className="text-xs font-display font-extrabold text-[var(--uc-navy-950)]">{busy === avatar.id ? <Loader2 className="h-4 w-4 animate-spin" /> : avatar.label}</span>{selected && <span className="text-[10px] font-display font-bold text-[var(--uc-purple)]">Current</span>}</button>; })}</div></ClayCard>
    <ClayCard className="overflow-hidden p-5 sm:p-6"><div className="flex items-start justify-between gap-4 border-b border-ink/5 pb-4"><div className="flex items-start gap-3"><span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[var(--uc-purple-soft)]"><Sparkles className="h-5 w-5 text-[var(--uc-purple)]" /></span><div><h2 className="font-display text-xl font-extrabold text-[var(--uc-navy-950)]">Choose a learner theme</h2><p className="mt-0.5 text-sm text-ink/60">{themeUnlocked ? "Your theme choice is ready—select one now." : "Locked until you unlock a Theme choice for 20 XP."}</p></div></div>{themeUnlocked ? <span className="rounded-full bg-clay-lime/30 px-3 py-1 text-xs font-display font-bold">Choice ready</span> : <Lock className="h-5 w-5 text-ink/40" />}</div><div className="mt-5 grid gap-4 sm:grid-cols-3">{THEMES.map((theme) => { const selected = user?.banner_theme === theme.key; return <button key={theme.key} type="button" disabled={!themeUnlocked || Boolean(busy)} onClick={() => selectStyle("theme", theme.key)} className={`min-h-44 rounded-2xl border-2 p-3 text-left shadow-sm ${theme.className} ${selected ? "border-[var(--uc-purple)] ring-2 ring-[var(--uc-purple)]/25" : "border-white/70"} ${themeUnlocked ? "hover:-translate-y-0.5" : "cursor-not-allowed opacity-50"}`}><div className="rounded-xl bg-white/90 px-3 py-2 text-xs font-display font-extrabold text-[var(--uc-navy-950)]">UniClass <span className="float-right">{theme.emoji}</span></div><div className="mt-3 rounded-xl bg-white/85 p-3"><p className="font-display text-sm font-extrabold text-[var(--uc-navy-950)]">{theme.label}</p><p className="mt-1 text-[10px] text-ink/65">Applies to Dashboard, Missions, Rewards, and Settings.</p></div>{selected && <p className="mt-2 text-center text-xs font-display font-extrabold">Current theme</p>}{busy === theme.key && <Loader2 className="mx-auto mt-2 h-4 w-4 animate-spin" />}</button>; })}</div></ClayCard>
    <ClayCard color="sky" className="p-4"><p className="font-display font-bold">Need an unlock?</p><p className="mt-1 text-sm text-ink/60">Earn 20 personal XP, then open Rewards to unlock one style choice. At 30 XP, convert XP in Rewards before continuing missions.</p><Link to={ROUTES.STUDENT.REWARDS} className="clay-btn mt-3 inline-flex bg-clay-lime px-4 py-2 text-sm font-display font-bold text-ink">Open Rewards</Link></ClayCard>
  </div>;
}
