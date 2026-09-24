import { useState } from "react";
import { Loader2, Save, UserRound } from "lucide-react";
import { useAuth } from "@/lib/AuthContext";
import { db } from "@/api/supabaseClient";
import ClayButton from "@/components/ClayButton";
import ClayCard from "@/components/ClayCard";
import UserAvatar, { AVATAR_OPTIONS } from "@/components/visual/UserAvatar";
import { NovaAsset } from "@/components/visual/UIAsset";

export default function StudentSettings() {
  const { user, checkUserAuth } = useAuth();
  const [selectedAvatar, setSelectedAvatar] = useState(user?.avatar_key || "");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState(null);

  async function saveAvatar() {
    setSaving(true);
    setNotice(null);
    try {
      await db.auth.updateMe({ avatar_key: selectedAvatar });
      await checkUserAuth();
      setNotice({ ok: true, text: "Your avatar is saved." });
    } catch (error) {
      setNotice({ ok: false, text: error?.message || "Your avatar could not be saved. Please try again." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5 sm:space-y-6">
      <section className="uc-card relative overflow-hidden px-5 py-5 sm:px-7 sm:py-6">
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-[var(--uc-purple)]">Your account</p>
            <h1 className="uc-page-title mt-1 text-3xl sm:text-4xl">Profile settings</h1>
            <p className="mt-1 max-w-xl text-sm leading-relaxed text-ink/60">Choose an avatar that appears for you while you use UniClass.</p>
          </div>
          <div className="flex items-center gap-3 rounded-2xl bg-[var(--uc-purple-soft)] px-4 py-3">
            <UserAvatar name={user?.email} avatarKey={selectedAvatar} size="lg" />
            <div><p className="font-display text-base font-extrabold text-[var(--uc-navy-950)]">Your avatar</p><p className="text-xs text-ink/60">Only you can change it.</p></div>
          </div>
        </div>
      </section>

      <ClayCard className="overflow-hidden p-5 sm:p-6">
        <div className="flex items-start gap-3 border-b border-ink/5 pb-4">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[var(--uc-purple-soft)]"><UserRound className="h-5 w-5 text-[var(--uc-purple)]" /></span>
          <div><h2 className="font-display text-xl font-extrabold text-[var(--uc-navy-950)]">Choose your avatar</h2><p className="mt-0.5 text-sm text-ink/60">Pick one character. You can update it anytime.</p></div>
        </div>

        <div role="radiogroup" aria-label="Choose your avatar" className="mt-5 grid grid-cols-3 gap-3 sm:grid-cols-4">
          {AVATAR_OPTIONS.map((avatar) => {
            const selected = selectedAvatar === avatar.id;
            return (
              <button key={avatar.id} type="button" role="radio" aria-checked={selected} onClick={() => setSelectedAvatar(avatar.id)}
                className={`group flex min-h-28 flex-col items-center justify-center gap-1.5 rounded-2xl border-2 p-3 transition-all ${selected ? "border-[var(--uc-purple)] bg-[var(--uc-purple-soft)] shadow-[0_6px_16px_rgba(119,84,236,.15)]" : "border-transparent bg-[var(--uc-bg)] hover:border-[var(--uc-purple)]/30 hover:bg-[var(--uc-purple-soft)]/45"}`}>
                <img src={avatar.src} alt="" aria-hidden="true" className="h-14 w-14 rounded-full border-2 border-white bg-white shadow-sm" loading="lazy" />
                <span className="text-xs font-display font-extrabold text-[var(--uc-navy-950)]">{avatar.label}</span>
                {selected && <span className="text-[10px] font-display font-bold text-[var(--uc-purple)]">Selected</span>}
              </button>
            );
          })}
        </div>

        <div className="mt-5 flex flex-col-reverse gap-3 border-t border-ink/5 pt-4 sm:flex-row sm:items-center sm:justify-between">
          {notice ? <p role="status" className={`text-sm font-display font-bold ${notice.ok ? "text-clay-lime" : "text-clay-coral"}`}>{notice.text}</p> : <p className="text-xs text-ink/50">Your name and class records will not change.</p>}
          <ClayButton color="purple" size="sm" onClick={saveAvatar} disabled={saving || !selectedAvatar}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Save className="h-4 w-4" /> Save avatar</>}
          </ClayButton>
        </div>
      </ClayCard>

      <div className="flex items-center gap-3 rounded-2xl bg-[var(--uc-sky-soft)] px-4 py-3">
        <NovaAsset pose="profile" className="h-16 w-16 shrink-0" />
        <p className="font-caveat text-xl leading-tight text-[var(--uc-navy-950)]">Make your UniClass space feel like your own!</p>
      </div>
    </div>
  );
}
