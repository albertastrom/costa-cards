"use client";

import type { ConnectionState } from "@/hooks/useRoom";
import type { PlayerPublic } from "@/lib/types";

function Crown({ me }: { me: boolean }) {
  return (
    <svg aria-label="Host" viewBox="0 0 12 9" className={`h-2.5 w-3 ${me ? "text-amber-300" : "text-amber-500"}`} fill="currentColor">
      <path d="M0 2l3 2.5L6 0l3 4.5L12 2l-1.2 7H1.2z" />
    </svg>
  );
}

function Seats({ players, selfId }: { players: PlayerPublic[]; selfId: string }) {
  return (
    <ul className="no-scrollbar flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto px-1">
      {players.map((p) => {
        const me = p.id === selfId;
        return (
          <li
            key={p.id}
            title={p.connected ? p.name : `${p.name} (disconnected)`}
            className={`flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${
              me ? "bg-fg text-white" : "bg-subtle text-gray-800"
            } ${p.connected ? "" : "opacity-40"}`}
          >
            {p.isHost && <Crown me={me} />}
            <span className="max-w-[5.5rem] truncate">{me ? "You" : p.name}</span>
            <span
              className={`flex items-center gap-0.5 font-normal tabular-nums ${me ? "text-gray-400" : "text-muted"}`}
              aria-label={`${p.handCount} cards`}
            >
              <svg viewBox="0 0 8 10" className="h-2.5 w-2" aria-hidden>
                <rect x="0.5" y="0.5" width="7" height="9" rx="1" fill="none" stroke="currentColor" />
              </svg>
              {p.handCount}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export function TopRail({
  roomCode,
  players,
  selfId,
  connection,
  muted,
  onToggleMute,
  onInvite,
  onMenu,
}: {
  roomCode: string;
  players: PlayerPublic[];
  selfId: string;
  connection: ConnectionState;
  muted: boolean;
  onToggleMute: () => void;
  onInvite: () => void;
  onMenu: () => void;
}) {
  const online = connection === "open";
  return (
    <header className="flex shrink-0 items-center gap-1 border-b border-line bg-white px-2 pt-[max(0.4rem,env(safe-area-inset-top))] pb-1.5">
      <button
        type="button"
        onClick={onInvite}
        className="flex shrink-0 items-center gap-1.5 rounded-lg px-1.5 py-1.5 font-mono text-sm font-bold tracking-[0.15em] text-fg active:bg-subtle"
        aria-label={`Room ${roomCode}. Invite players`}
      >
        <span
          className={`h-1.5 w-1.5 rounded-full ${online ? "bg-emerald-500" : "animate-pulse bg-amber-400"}`}
          aria-label={online ? "Connected" : "Reconnecting"}
        />
        {roomCode}
      </button>
      <div className="h-4 w-px shrink-0 bg-line" />
      <Seats players={players} selfId={selfId} />
      <button type="button" className="icon-btn" onClick={onToggleMute} aria-label={muted ? "Unmute" : "Mute"}>
        {muted ? (
          <svg viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor" aria-hidden>
            <path d="M9 4L5 7.5H2v5h3l4 3.5zM13 7l5 6m0-6l-5 6" stroke="currentColor" strokeWidth="1.6" />
          </svg>
        ) : (
          <svg viewBox="0 0 20 20" className="h-4 w-4" aria-hidden>
            <path d="M9 4L5 7.5H2v5h3l4 3.5z" fill="currentColor" />
            <path d="M13 7.5a3.5 3.5 0 010 5M15.5 5a7 7 0 010 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        )}
      </button>
      <button type="button" className="icon-btn" onClick={onMenu} aria-label="Room menu">
        <svg viewBox="0 0 20 20" className="h-4 w-4" aria-hidden>
          <path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      </button>
    </header>
  );
}
