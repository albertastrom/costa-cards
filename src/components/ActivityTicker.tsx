"use client";

import { useEffect, useState } from "react";
import type { ActivityEntry } from "@/lib/types";

const FADE_MS = 6000;

export function ActivityTicker({ activity }: { activity: ActivityEntry[] }) {
  const [expanded, setExpanded] = useState(false);
  const latest = activity.at(-1);
  const [fadedId, setFadedId] = useState<number | null>(null);

  useEffect(() => {
    if (!latest) return;
    const id = latest.id;
    const t = setTimeout(() => setFadedId(id), FADE_MS);
    return () => clearTimeout(t);
  }, [latest]);

  if (!latest) return null;
  const faded = fadedId === latest.id && !expanded;

  return (
    <div className="pointer-events-none absolute inset-x-0 top-2 z-[60] flex justify-center px-3">
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        aria-expanded={expanded}
        aria-label="Recent activity"
        className={`pointer-events-auto max-w-[92%] rounded-2xl bg-black/25 px-3 py-1 text-left text-xs font-medium text-white transition-opacity duration-700 ${
          faded ? "opacity-35" : "opacity-100"
        }`}
      >
        {expanded ? (
          <ol className="space-y-0.5 py-1">
            {activity.slice(-6).map((a) => (
              <li key={a.id} className={a.id === latest.id ? "text-white" : "text-white/60"}>
                {a.text}
              </li>
            ))}
          </ol>
        ) : (
          <span key={latest.id} className="ticker-in block truncate">
            {latest.text}
          </span>
        )}
      </button>
    </div>
  );
}
