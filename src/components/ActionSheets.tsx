"use client";

import { useState } from "react";
import { cardLabel } from "@/domain/game";
import type { CardBackId, TableCardView } from "@/lib/types";
import { MAX_DEAL_COUNT } from "@/lib/types";
import type { Action } from "@/hooks/useRoom";
import { CardFace } from "./Card";
import { ActionButton, Sheet, SheetSection } from "./Sheet";

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`chip ${checked ? "chip-on" : ""}`}
    >
      <span className={`h-2 w-2 rounded-full ${checked ? "bg-ink" : "bg-white/30"}`} />
      {label}
    </button>
  );
}

/** Actions for one pile on the table. `stack` is bottom → top. */
export function StackSheet({
  stack,
  back,
  canDeck,
  onClose,
  act,
  onMovePile,
}: {
  stack: TableCardView[] | null;
  back: CardBackId;
  canDeck: boolean;
  onClose: () => void;
  act: (a: Action) => void;
  onMovePile: () => void;
}) {
  const [keepTop, setKeepTop] = useState(false);
  const [shuffle, setShuffle] = useState(true);
  const open = !!stack && stack.length > 0;
  if (!open) return null;

  const top = stack[stack.length - 1];
  const n = stack.length;
  const faceUp = stack.filter((c) => c.faceUp).length;
  const run = (a: Action) => {
    act(a);
    onClose();
  };

  return (
    <Sheet
      open
      onClose={onClose}
      title={n > 1 ? `Pile of ${n}` : top.faceUp && top.rank && top.suit ? cardLabel({ rank: top.rank, suit: top.suit }) : "Face-down card"}
    >
      <div className="mb-4 flex items-center gap-3">
        <CardFace card={top} back={back} w={52} h={70} className="card-shadow" />
        <p className="text-sm text-muted">
          {n > 1 ? `${faceUp} face-up · ${n - faceUp} face-down` : top.faceUp ? "Face up" : "Face down"}
          <br />
          <span className="text-xs">Tip: drag the top card to move it, drag the number badge to move the pile.</span>
        </p>
      </div>
      <div className="grid gap-2">
        <ActionButton tone="gold" onClick={() => run({ type: "TAKE_CARD", uid: top.uid })}>
          {n > 1 ? "Take top card" : "Take into hand"}
        </ActionButton>
        <ActionButton onClick={() => run({ type: "FLIP_CARD", uid: top.uid })}>
          {n > 1 ? "Flip top card" : "Flip"}
        </ActionButton>
        {n > 1 && (
          <>
            <ActionButton onClick={() => run({ type: "TAKE_STACK", uid: top.uid })} hint={`${n} cards`}>
              Take whole pile
            </ActionButton>
            <ActionButton onClick={() => run({ type: "FLIP_STACK", uid: top.uid })}>Turn pile over</ActionButton>
            <ActionButton
              onClick={() => {
                onMovePile();
                onClose();
              }}
            >
              Move pile…
            </ActionButton>
          </>
        )}
      </div>
      {canDeck && (
        <SheetSection label="Back to deck">
          <div className="mb-2 mt-4 flex flex-wrap gap-2">
            {n > 1 && <Toggle checked={keepTop} onChange={setKeepTop} label="Keep top card" />}
            <Toggle checked={shuffle} onChange={setShuffle} label="Shuffle deck" />
          </div>
          <ActionButton
            onClick={() => run({ type: "COLLECT_STACK", uid: top.uid, keepTop: n > 1 && keepTop, shuffle })}
          >
            Collect into deck
          </ActionButton>
        </SheetSection>
      )}
    </Sheet>
  );
}

/** Deck actions. Draw is open to all; the rest needs host (or open deck controls). */
export function DeckSheet({
  open,
  onClose,
  deckCount,
  playerCount,
  canDeck,
  faceDown,
  act,
}: {
  open: boolean;
  onClose: () => void;
  deckCount: number;
  playerCount: number;
  canDeck: boolean;
  faceDown: boolean;
  act: (a: Action) => void;
}) {
  const [dealCount, setDealCount] = useState(5);
  const [custom, setCustom] = useState("");
  const [blind, setBlind] = useState(false);
  const run = (a: Action) => {
    act(a);
    onClose();
  };
  const count = custom ? Math.max(1, Math.min(MAX_DEAL_COUNT, Number(custom) || 1)) : dealCount;

  return (
    <Sheet open={open} onClose={onClose} title={`Deck · ${deckCount} left`}>
      <SheetSection label="Draw">
        <div className="grid grid-cols-2 gap-2">
          <ActionButton tone="gold" disabled={deckCount === 0} onClick={() => run({ type: "DRAW", count: 1 })}>
            Draw 1
          </ActionButton>
          <ActionButton
            disabled={deckCount === 0}
            onClick={() => run({ type: "DRAW", count: 1, faceUp: false })}
            hint="unseen"
          >
            Draw blind
          </ActionButton>
        </div>
      </SheetSection>

      {canDeck ? (
        <>
          <SheetSection label="Deal to everyone">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              {[1, 5, 7].map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`chip ${!custom && dealCount === c ? "chip-on" : ""}`}
                  onClick={() => {
                    setDealCount(c);
                    setCustom("");
                  }}
                >
                  {c}
                </button>
              ))}
              <input
                inputMode="numeric"
                aria-label="Custom deal count"
                placeholder="#"
                value={custom}
                onChange={(e) => setCustom(e.target.value.replace(/\D/g, "").slice(0, 2))}
                className={`chip w-14 text-center ${custom ? "chip-on" : ""}`}
              />
              <Toggle checked={blind} onChange={setBlind} label="Blind" />
            </div>
            <ActionButton
              tone="gold"
              disabled={deckCount === 0}
              onClick={() => run({ type: "DEAL", count, faceUp: !blind })}
              hint={`${count * playerCount} cards`}
            >
              Deal {count} each{blind ? " (blind)" : ""}
            </ActionButton>
          </SheetSection>
          <SheetSection label="Turn up onto the table">
            <div className="grid grid-cols-2 gap-2">
              <ActionButton
                disabled={deckCount === 0}
                onClick={() => run({ type: "DRAW_TO_TABLE", x: 0.5, y: 0.5, faceUp: true })}
              >
                Face up
              </ActionButton>
              <ActionButton
                disabled={deckCount === 0}
                onClick={() => run({ type: "DRAW_TO_TABLE", x: 0.5, y: 0.5, faceUp: false })}
              >
                Face down
              </ActionButton>
            </div>
            <p className="mt-1.5 text-xs text-muted">
              Lands in the middle — or drag straight from the deck to place it{faceDown ? " (face-down mode on)" : ""}.
            </p>
          </SheetSection>
          <ActionButton onClick={() => run({ type: "SHUFFLE" })}>Shuffle deck</ActionButton>
        </>
      ) : (
        <p className="rounded-2xl bg-white/[0.04] p-3 text-sm text-muted">
          Only the host can deal, shuffle or turn cards onto the table. The host can switch on
          “Anyone can deal” in the room menu.
        </p>
      )}
    </Sheet>
  );
}
