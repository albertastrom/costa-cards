"use client";

import { useEffect, type ReactNode } from "react";

export function Sheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[200] flex items-end justify-center" role="presentation">
      <button
        type="button"
        aria-label="Close"
        className="sheet-backdrop absolute inset-0 bg-black/55"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        className="sheet-panel relative w-full max-w-lg max-h-[86dvh] overflow-y-auto overscroll-contain rounded-t-3xl border-t border-white/10 bg-[#121a17] px-4 pt-2 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-2xl"
      >
        <div className="mx-auto mb-2 h-1.5 w-10 rounded-full bg-white/15" />
        {title && (
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold text-cream">{title}</h2>
            <button type="button" className="chip" onClick={onClose}>
              Done
            </button>
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

export function SheetSection({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="mb-4">
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted">{label}</h3>
      {children}
    </section>
  );
}

export function ActionButton({
  children,
  onClick,
  disabled,
  tone = "default",
  hint,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  tone?: "default" | "gold" | "danger";
  hint?: ReactNode;
}) {
  const toneCls =
    tone === "gold"
      ? "bg-gold text-ink border-transparent"
      : tone === "danger"
        ? "text-danger border-danger/40"
        : "text-cream border-white/10 bg-white/[0.04]";
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`flex w-full items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-left text-[15px] font-medium transition active:scale-[0.98] disabled:opacity-40 ${toneCls}`}
    >
      <span>{children}</span>
      {hint && <span className="text-xs opacity-70">{hint}</span>}
    </button>
  );
}
