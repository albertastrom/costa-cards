"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import qrcode from "qrcode-generator";
import { ActionButton, Sheet } from "./Sheet";

function QrCode({ text }: { text: string }) {
  const path = useMemo(() => {
    const qr = qrcode(0, "M");
    qr.addData(text);
    qr.make();
    const n = qr.getModuleCount();
    let d = "";
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
    }
    return { d, n };
  }, [text]);
  const pad = 3;
  return (
    <svg
      viewBox={`${-pad} ${-pad} ${path.n + pad * 2} ${path.n + pad * 2}`}
      className="h-52 w-52 rounded-2xl bg-[#f3efe6]"
      shapeRendering="crispEdges"
      role="img"
      aria-label="QR code for the room link"
    >
      <path d={path.d} fill="#0b0f0e" />
    </svg>
  );
}

export function InviteSheet({ open, onClose, roomCode }: { open: boolean; onClose: () => void; roomCode: string }) {
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
    },
    [],
  );
  const url = typeof window !== "undefined" ? `${window.location.origin}/r/${roomCode}` : `/r/${roomCode}`;
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard blocked */
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title="Invite to the table">
      <div className="flex flex-col items-center gap-3 pb-2">
        {open && <QrCode text={url} />}
        <p className="font-mono text-2xl font-bold tracking-[0.35em] text-gold">{roomCode}</p>
        <p className="break-all text-center text-xs text-muted">{url}</p>
        <div className="grid w-full gap-2">
          <ActionButton tone="gold" onClick={copy}>
            {copied ? "Copied!" : "Copy link"}
          </ActionButton>
          {canShare && (
            <ActionButton
              onClick={() => {
                navigator.share({ title: "Costa Cards", text: `Join my card table (${roomCode})`, url }).catch(() => {});
              }}
            >
              Share…
            </ActionButton>
          )}
        </div>
      </div>
    </Sheet>
  );
}
