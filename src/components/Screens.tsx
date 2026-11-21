"use client";

import { useState, type ReactNode } from "react";
import type { RoomBlock } from "@/hooks/useRoom";
import { MAX_NAME_LENGTH } from "@/lib/types";

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-10">
      <div className="w-full max-w-xs space-y-4">
        <h1 className="text-center text-xl font-bold tracking-tight text-fg">{title}</h1>
        {children}
      </div>
    </main>
  );
}

export function NameGate({ roomCode, onSubmit }: { roomCode: string; onSubmit: (name: string) => void }) {
  const [value, setValue] = useState("");
  const name = value.trim();
  return (
    <Panel title={`Join table ${roomCode}`}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (name) onSubmit(name);
        }}
      >
        <input
          className="input-field"
          placeholder="Your name"
          maxLength={MAX_NAME_LENGTH}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoComplete="nickname"
          autoFocus
        />
        <button type="submit" className="btn-primary w-full py-3" disabled={!name}>
          Sit down
        </button>
      </form>
    </Panel>
  );
}

function PasscodeForm({ bad, onSubmit }: { bad: boolean; onSubmit: (code: string) => void }) {
  const [value, setValue] = useState("");
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (value.trim()) onSubmit(value.trim());
      }}
    >
      <p className="text-center text-sm text-muted">
        {bad ? "That codeword didn’t work. Try again." : "This table needs your group’s codeword."}
      </p>
      <input
        className="input-field"
        placeholder="Codeword"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        autoComplete="off"
        autoCapitalize="off"
        autoFocus
      />
      <button type="submit" className="btn-primary w-full py-3" disabled={!value.trim()}>
        Enter
      </button>
    </form>
  );
}

export function BlockScreen({
  block,
  roomCode,
  onPasscode,
  onRetry,
  onHome,
}: {
  block: RoomBlock;
  roomCode: string;
  onPasscode: (code: string) => void;
  onRetry: () => void;
  onHome: () => void;
}) {
  switch (block.kind) {
    case "passcode":
      return (
        <Panel title="Codeword">
          <PasscodeForm bad={block.bad} onSubmit={onPasscode} />
        </Panel>
      );
    case "kicked":
      return (
        <Panel title="You were removed">
          <p className="text-center text-sm text-muted">The host removed you from table {roomCode}.</p>
          <div className="grid gap-2">
            <button type="button" className="btn-primary w-full py-3" onClick={onRetry}>
              Rejoin
            </button>
            <button type="button" className="btn-ghost w-full py-3" onClick={onHome}>
              Back home
            </button>
          </div>
        </Panel>
      );
    case "full":
      return (
        <Panel title="Table is full">
          <p className="text-center text-sm text-muted">Table {roomCode} has no free seats right now.</p>
          <div className="grid gap-2">
            <button type="button" className="btn-primary w-full py-3" onClick={onRetry}>
              Try again
            </button>
            <button type="button" className="btn-ghost w-full py-3" onClick={onHome}>
              Back home
            </button>
          </div>
        </Panel>
      );
    case "elsewhere":
      return (
        <Panel title="Open in another tab">
          <p className="text-center text-sm text-muted">Table {roomCode} is open in another tab or window.</p>
          <button type="button" className="btn-primary w-full py-3" onClick={onRetry}>
            Use it here
          </button>
        </Panel>
      );
    case "left":
      return (
        <Panel title="You left the table">
          <button type="button" className="btn-primary w-full py-3" onClick={onHome}>
            Back home
          </button>
        </Panel>
      );
  }
}
