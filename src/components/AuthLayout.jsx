
import { NovaAsset } from "@/components/visual/UIAsset";
import BrandMark from "@/components/BrandMark";

export default function AuthLayout({ icon: Icon, title, subtitle, footer, children }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[radial-gradient(circle_at_top,#F3EFFF_0%,#FBFAF7_42%,#FBFAF7_100%)] px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-10">
          <div className="mb-6 inline-flex items-center gap-2 text-[var(--uc-navy-950)]"><BrandMark /><span className="font-display text-2xl font-extrabold">UniClass</span></div>
          <NovaAsset pose="welcome" priority className="mx-auto mb-4 h-24 w-24" />
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-clay-purple shadow-[0_5px_13px_rgba(142,92,246,.28)] mb-4">
            <Icon className="w-7 h-7 text-white" aria-hidden="true" />
          </div>
          <h1 className="uc-page-title text-3xl">{title}</h1>
          {subtitle && <p className="text-ink/60 mt-2">{subtitle}</p>}
        </div>
        <div className="clay-card p-8">
          {children}
        </div>
        {footer && (
          <p className="text-center text-sm text-ink/60 mt-6">{footer}</p>
        )}
      </div>
    </div>
  );
}
