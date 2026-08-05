
export default function AuthLayout({ icon: Icon, title, subtitle, footer, children }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-cream px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-10">
          <img src="/logo.png" alt="UniClass logo" className="w-24 h-24 mx-auto mb-4 object-contain" />
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-clay-purple border-[3px] border-ink shadow-[3px_3px_0_#17162B] mb-4">
            <Icon className="w-7 h-7 text-white" aria-hidden="true" />
          </div>
          <h1 className="text-3xl font-display font-extrabold tracking-tight text-ink">{title}</h1>
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

