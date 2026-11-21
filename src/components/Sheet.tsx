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
        className="sheet-backdrop absolute inset-0 bg-black/40"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        className="sheet-panel relative w-full max-w-lg max-h-[86dvh] overflow-y-auto overscroll-contain rounded-t-2xl bg-white px-4 pt-2 pb-[max(1rem,env(safe-area-inset-bottom))] text-fg"
      >
        <div className="mx-auto mb-2 h-1 w-9 rounded-full bg-gray-200" />
        {title && (
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold text-fg">{title}</h2>
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
      <h3 className="label mb-2">{label}</h3>
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
  tone?: "default" | "primary" | "danger";
  hint?: ReactNode;
}) {
  const toneCls =
    tone === "primary"
      ? "bg-fg text-white border-fg"
      : tone === "danger"
        ? "bg-white text-danger border-red-200"
        : "bg-white text-fg border-line";
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`flex w-full items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left text-[15px] font-medium transition active:scale-[0.98] disabled:opacity-30 ${toneCls}`}
    >
      <span>{children}</span>
      {hint && <span className="text-xs opacity-60">{hint}</span>}
    </button>
  );
}
