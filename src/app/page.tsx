"use client";

import { useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { CardFace } from "@/components/Card";
import { generateRoomCode, getStoredName, normalizeRoomCode, setStoredName } from "@/lib/session";
import { MAX_NAME_LENGTH, ROOM_CODE_LENGTH } from "@/lib/types";

const noopSubscribe = () => () => {};

export default function HomePage() {
  const router = useRouter();
  const stored = useSyncExternalStore(noopSubscribe, getStoredName, () => "");
  const [edited, setEdited] = useState<string | null>(null);
  const name = edited ?? stored;
  const [joinCode, setJoinCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  const go = (code: string) => {
    const trimmed = name.trim();
    if (!trimmed) return setError("Enter your name first");
    const room = normalizeRoomCode(code);
    if (room.length < 4) return setError("Enter a valid room code");
    setStoredName(trimmed);
    router.push(`/r/${room}`);
  };

  return (
    <main className="relative flex flex-1 flex-col items-center justify-center px-4 pb-[max(2.5rem,env(safe-area-inset-bottom))] pt-[max(2.5rem,env(safe-area-inset-top))]">
      <div className="relative w-full max-w-xs space-y-8">
        <header className="space-y-3 text-center">
          <div className="mx-auto flex h-24 items-end justify-center" aria-hidden>
            {(
              [
                { rank: "A", suit: "s" },
                { rank: "K", suit: "h" },
                { rank: "Q", suit: "d" },
              ] as const
            ).map((c, i) => (
              <CardFace
                key={c.rank}
                card={{ faceUp: true, ...c }}
                back="red"
                w={55}
                h={74}
                className="card-shadow -mx-2"
                style={{ transform: `rotate(${(i - 1) * 12}deg) translateY(${i === 1 ? -6 : 0}px)` }}
              />
            ))}
          </div>
          <h1 className="pt-1 text-2xl font-bold tracking-tight text-fg">Costa Cards</h1>
          <p className="text-sm text-muted">A deck of cards for the table you’re already sitting at.</p>
        </header>

        <div className="space-y-4">
          <label className="block space-y-1.5">
            <span className="label">Your name</span>
            <input
              className="input-field"
              placeholder="e.g. Maya"
              maxLength={MAX_NAME_LENGTH}
              value={name}
              onChange={(e) => {
                setEdited(e.target.value);
                setError(null);
              }}
              autoComplete="nickname"
            />
          </label>

          <button type="button" className="btn-primary w-full py-3 text-base" onClick={() => go(generateRoomCode())}>
            New table
          </button>

          <div className="flex items-center gap-3">
            <div className="h-px flex-1 bg-line" />
            <span className="label">or join</span>
            <div className="h-px flex-1 bg-line" />
          </div>

          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              go(joinCode);
            }}
          >
            <input
              className="input-field font-mono uppercase tracking-[0.3em]"
              placeholder={"CODE".padEnd(ROOM_CODE_LENGTH, "·")}
              maxLength={8}
              value={joinCode}
              autoCapitalize="characters"
              autoComplete="off"
              onChange={(e) => {
                setJoinCode(e.target.value.toUpperCase());
                setError(null);
              }}
            />
            <button type="submit" className="btn-ghost shrink-0 px-5">
              Join
            </button>
          </form>

          {error && (
            <p className="text-center text-sm text-danger" role="alert">
              {error}
            </p>
          )}
        </div>

        <p className="text-center text-xs leading-relaxed text-gray-400">
          No accounts, no rules engine — just cards. Share the code or link with your friends.
        </p>
      </div>
    </main>
  );
}
