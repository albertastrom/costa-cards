"use client";

import type { ToastMsg } from "@/hooks/useRoom";

export function Toast({ toast, onDismiss }: { toast: ToastMsg | null; onDismiss: () => void }) {
  if (!toast) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-[max(3.5rem,calc(env(safe-area-inset-top)+3rem))] z-[300] flex justify-center px-4">
      <button
        key={toast.id}
        type="button"
        onClick={onDismiss}
        role="status"
        className={`toast-in pointer-events-auto max-w-sm rounded-full px-4 py-2 text-sm shadow-xl ${
          toast.tone === "error" ? "bg-[#3a1f1f] text-[#f3c9c9] ring-1 ring-danger/40" : "bg-[#1d2a25] text-cream ring-1 ring-white/10"
        }`}
      >
        {toast.text}
      </button>
    </div>
  );
}
