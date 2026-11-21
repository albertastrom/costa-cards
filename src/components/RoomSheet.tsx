"use client";

import { useState } from "react";
import { CARD_BACKS } from "@/domain/sprites";
import type { ClientSnapshot, DeckPreset } from "@/lib/types";
import type { Action } from "@/hooks/useRoom";
import { CardFace } from "./Card";
import { ActionButton, Sheet, SheetSection } from "./Sheet";

const PRESETS: { id: DeckPreset; label: string; hint: string }[] = [
  { id: "standard52", label: "52", hint: "Standard" },
  { id: "jokers54", label: "54", hint: "+ 2 jokers" },
  { id: "double104", label: "104", hint: "2 decks" },
];

export function RoomSheet({
  open,
  onClose,
  state,
  canDeck,
  act,
  muted,
  setMuted,
  shield,
  setShield,
  onInvite,
  onLeave,
}: {
  open: boolean;
  onClose: () => void;
  state: ClientSnapshot;
  canDeck: boolean;
  act: (a: Action) => void;
  muted: boolean;
  setMuted: (v: boolean) => void;
  shield: boolean;
  setShield: (v: boolean) => void;
  onInvite: () => void;
  onLeave: () => void;
}) {
  const [confirm, setConfirm] = useState<string | null>(null);
  const [picked, setPicked] = useState<DeckPreset | null>(null);
  const preset = picked ?? state.deckPreset;
  const isHost = !!state.players.find((p) => p.id === state.playerId)?.isHost;

  const close = () => {
    setConfirm(null);
    setPicked(null);
    onClose();
  };

  return (
    <Sheet open={open} onClose={close} title={`Room ${state.roomCode}`}>
      <div className="mb-4 grid grid-cols-2 gap-2">
        <ActionButton tone="gold" onClick={onInvite}>
          Invite
        </ActionButton>
        <ActionButton onClick={() => setShield(!shield)} hint={shield ? "on" : "off"}>
          Shield hand
        </ActionButton>
        <ActionButton onClick={() => setMuted(!muted)} hint={muted ? "off" : "on"}>
          Sound
        </ActionButton>
        <ActionButton
          tone="danger"
          onClick={() => (confirm === "leave" ? onLeave() : setConfirm("leave"))}
        >
          {confirm === "leave" ? "Tap to confirm" : "Leave room"}
        </ActionButton>
      </div>

      <SheetSection label={`Players · ${state.players.length}`}>
        <ul className="divide-y divide-white/5 rounded-2xl bg-white/[0.03]">
          {state.players.map((p) => {
            const self = p.id === state.playerId;
            const kickKey = `kick:${p.id}`;
            return (
              <li key={p.id} className={`flex items-center gap-2 px-3 py-2.5 ${p.connected ? "" : "opacity-50"}`}>
                <span className="min-w-0 flex-1 truncate text-sm">
                  {p.name}
                  {self && <span className="text-muted"> (you)</span>}
                  {p.isHost && <span className="ml-1.5 text-xs text-gold">host</span>}
                  {!p.connected && <span className="ml-1.5 text-xs text-muted">away</span>}
                </span>
                <span className="text-xs tabular-nums text-muted">{p.handCount} cards</span>
                {isHost && !self && (
                  <>
                    <button
                      type="button"
                      className="chip"
                      onClick={() =>
                        confirm === `host:${p.id}`
                          ? (act({ type: "TRANSFER_HOST", playerId: p.id }), setConfirm(null))
                          : setConfirm(`host:${p.id}`)
                      }
                    >
                      {confirm === `host:${p.id}` ? "Confirm" : "Make host"}
                    </button>
                    <button
                      type="button"
                      className="chip text-danger"
                      onClick={() =>
                        confirm === kickKey
                          ? (act({ type: "KICK_PLAYER", playerId: p.id }), setConfirm(null))
                          : setConfirm(kickKey)
                      }
                    >
                      {confirm === kickKey ? "Kick?" : "Kick"}
                    </button>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      </SheetSection>

      {isHost && (
        <SheetSection label="Table">
          <button
            type="button"
            role="switch"
            aria-checked={state.settings.openDeckControls}
            onClick={() =>
              act({ type: "UPDATE_SETTINGS", settings: { openDeckControls: !state.settings.openDeckControls } })
            }
            className="mb-3 flex w-full items-center justify-between rounded-2xl bg-white/[0.04] px-4 py-3 text-left"
          >
            <span>
              <span className="block text-[15px]">Anyone can deal</span>
              <span className="block text-xs text-muted">Let everyone shuffle, deal and reset the deck</span>
            </span>
            <span
              className={`relative h-6 w-11 shrink-0 rounded-full transition ${state.settings.openDeckControls ? "bg-gold" : "bg-white/15"}`}
            >
              <span
                className={`absolute top-0.5 h-5 w-5 rounded-full bg-cream transition-all ${state.settings.openDeckControls ? "left-[22px]" : "left-0.5"}`}
              />
            </span>
          </button>

          <p className="mb-2 text-xs text-muted">Card back</p>
          <div className="grid grid-cols-4 gap-2">
            {CARD_BACKS.map((b) => {
              const on = state.settings.cardBack === b.id;
              return (
                <button
                  key={b.id}
                  type="button"
                  aria-label={b.label}
                  aria-pressed={on}
                  onClick={() => act({ type: "UPDATE_SETTINGS", settings: { cardBack: b.id } })}
                  className={`grid place-items-center rounded-xl p-1.5 transition ${on ? "bg-gold/25 ring-2 ring-gold" : "bg-white/[0.04]"}`}
                >
                  <CardFace card={{ faceUp: false }} back={b.id} w={46} h={62} />
                </button>
              );
            })}
          </div>
        </SheetSection>
      )}

      {canDeck && (
        <SheetSection label="New deck">
          <div className="mb-2 grid grid-cols-3 gap-2">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setPicked(p.id)}
                className={`rounded-2xl px-2 py-2 text-center transition ${preset === p.id ? "bg-gold text-ink" : "bg-white/[0.04] text-cream"}`}
              >
                <span className="block text-lg font-bold">{p.label}</span>
                <span className="block text-[11px] opacity-75">{p.hint}</span>
              </button>
            ))}
          </div>
          <ActionButton
            tone={confirm === "reset" ? "danger" : "default"}
            onClick={() => {
              if (confirm !== "reset") return setConfirm("reset");
              act({ type: "RESET_DECK", deckPreset: preset });
              close();
            }}
            hint={confirm === "reset" ? "clears table & hands" : undefined}
          >
            {confirm === "reset" ? "Tap again to reset everything" : "Reset & shuffle a fresh deck"}
          </ActionButton>
        </SheetSection>
      )}
    </Sheet>
  );
}
