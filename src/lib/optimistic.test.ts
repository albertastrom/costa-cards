import { describe, expect, it } from "vitest";
import {
  applyOptimistic,
  displayState,
  dropSeq,
  prunePending,
  sortCards,
  type PendingOp,
} from "./optimistic";
import { DEFAULT_SETTINGS, STACK_SNAP_RADIUS, type ClientSnapshot } from "./types";

function snap(partial: Partial<ClientSnapshot> = {}): ClientSnapshot {
  return {
    playerId: "p_me",
    myHand: [
      { uid: "h1", faceUp: true, rank: "K", suit: "h" },
      { uid: "h2", faceUp: true, rank: "3", suit: "s" },
      { uid: "h3", faceUp: false },
    ],
    table: [
      { uid: "t1", faceUp: true, rank: "A", suit: "s", x: 0.5, y: 0.5, playedBy: "p_x" },
      { uid: "t2", faceUp: true, rank: "2", suit: "d", x: 0.5, y: 0.5, playedBy: "p_x" },
      { uid: "t3", faceUp: false, x: 0.2, y: 0.2, playedBy: "p_x" },
    ],
    players: [
      { id: "p_me", name: "Me", handCount: 3, isHost: true, connected: true, seat: 0 },
      { id: "p_x", name: "X", handCount: 5, isHost: false, connected: true, seat: 1 },
    ],
    deckCount: 40,
    phase: "playing",
    roomCode: "ABCDE",
    deckPreset: "standard52",
    settings: DEFAULT_SETTINGS,
    activity: [],
    ackSeq: 0,
    ...partial,
  };
}

describe("applyOptimistic", () => {
  it("PLAY_CARD face-up moves the card onto the table and updates hand count", () => {
    const s = applyOptimistic(snap(), { type: "PLAY_CARD", uid: "h1", x: 0.8, y: 0.8 });
    expect(s.myHand.map((c) => c.uid)).toEqual(["h2", "h3"]);
    expect(s.table.at(-1)).toMatchObject({ uid: "h1", rank: "K", faceUp: true, x: 0.8, y: 0.8, playedBy: "p_me" });
    expect(s.players[0].handCount).toBe(2);
    expect(s.players[1].handCount).toBe(5);
  });

  it("PLAY_CARD snaps onto a nearby stack and becomes its top", () => {
    const d = STACK_SNAP_RADIUS / 2;
    const s = applyOptimistic(snap(), { type: "PLAY_CARD", uid: "h1", x: 0.5 + d, y: 0.5 });
    expect(s.table.at(-1)).toMatchObject({ uid: "h1", x: 0.5, y: 0.5 });
  });

  it("PLAY_CARD face-down hides the face", () => {
    const s = applyOptimistic(snap(), { type: "PLAY_CARD", uid: "h1", x: 0.9, y: 0.1, faceUp: false });
    const c = s.table.at(-1)!;
    expect(c.faceUp).toBe(false);
    expect(c.rank).toBeUndefined();
    expect(c.suit).toBeUndefined();
  });

  it("MOVE_CARD ignores its own stack when snapping and moves to top of z-order", () => {
    const s = applyOptimistic(snap(), { type: "MOVE_CARD", uid: "t1", x: 0.21, y: 0.2 });
    expect(s.table.map((c) => c.uid)).toEqual(["t2", "t3", "t1"]);
    expect(s.table.at(-1)).toMatchObject({ x: 0.2, y: 0.2 });
  });

  it("TAKE_CARD of a known card predicts; of a hidden card waits", () => {
    const s = applyOptimistic(snap(), { type: "TAKE_CARD", uid: "t2" });
    expect(s.table.map((c) => c.uid)).toEqual(["t1", "t3"]);
    expect(s.myHand.at(-1)).toEqual({ uid: "t2", faceUp: true, rank: "2", suit: "d" });
    const base = snap();
    expect(applyOptimistic(base, { type: "TAKE_CARD", uid: "t3" })).toBe(base);
  });

  it("FLIP_CARD only predicts going face-down", () => {
    const s = applyOptimistic(snap(), { type: "FLIP_CARD", uid: "t2" });
    expect(s.table[1]).toEqual({ uid: "t2", faceUp: false, x: 0.5, y: 0.5, playedBy: "p_x" });
    const base = snap();
    expect(applyOptimistic(base, { type: "FLIP_CARD", uid: "t3" })).toBe(base);
  });

  it("FLIP_HAND_CARD hides a visible card, waits on a blind one", () => {
    const s = applyOptimistic(snap(), { type: "FLIP_HAND_CARD", uid: "h1" });
    expect(s.myHand[0]).toEqual({ uid: "h1", faceUp: false });
    const base = snap();
    expect(applyOptimistic(base, { type: "FLIP_HAND_CARD", uid: "h3" })).toBe(base);
  });

  it("MOVE_STACK moves every card preserving order", () => {
    const s = applyOptimistic(snap(), { type: "MOVE_STACK", uid: "t1", x: 0.7, y: 0.3 });
    expect(s.table.map((c) => [c.uid, c.x, c.y])).toEqual([
      ["t3", 0.2, 0.2],
      ["t1", 0.7, 0.3],
      ["t2", 0.7, 0.3],
    ]);
  });

  it("TAKE_STACK predicts only when every card is known", () => {
    const s = applyOptimistic(snap(), { type: "TAKE_STACK", uid: "t2" });
    expect(s.table.map((c) => c.uid)).toEqual(["t3"]);
    expect(s.myHand.map((c) => c.uid)).toEqual(["h1", "h2", "h3", "t1", "t2"]);
    expect(s.players[0].handCount).toBe(5);
    const base = snap();
    expect(applyOptimistic(base, { type: "TAKE_STACK", uid: "t3" })).toBe(base);
  });

  it("FLIP_STACK of a face-up pile turns it over (reversed, hidden, lifted to top)", () => {
    const s = applyOptimistic(snap(), { type: "FLIP_STACK", uid: "t1" });
    expect(s.table.map((c) => [c.uid, c.faceUp, c.rank])).toEqual([
      ["t3", false, undefined],
      ["t2", false, undefined],
      ["t1", false, undefined],
    ]);
  });

  it("SORT_HAND predicts only with all faces known", () => {
    const base = snap();
    expect(applyOptimistic(base, { type: "SORT_HAND", by: "rank" })).toBe(base);
    const known = snap({ myHand: base.myHand.slice(0, 2) });
    const s = applyOptimistic(known, { type: "SORT_HAND", by: "rank" });
    expect(s.myHand.map((c) => c.uid)).toEqual(["h2", "h1"]);
  });

  it("unpredictable ops are identity", () => {
    const base = snap();
    for (const msg of [
      { type: "DRAW" as const },
      { type: "SHUFFLE" as const },
      { type: "DEAL" as const, count: 3 },
    ]) {
      expect(applyOptimistic(base, msg)).toBe(base);
    }
  });

  it("missing uids are ignored", () => {
    const base = snap();
    expect(applyOptimistic(base, { type: "MOVE_CARD", uid: "nope", x: 0, y: 0 })).toBe(base);
    expect(applyOptimistic(base, { type: "PLAY_CARD", uid: "nope", x: 0, y: 0 })).toBe(base);
  });
});

describe("sortCards", () => {
  it("sorts by suit then rank, stably", () => {
    const cards = [
      { uid: "a", faceUp: true, rank: "K" as const, suit: "h" as const },
      { uid: "b", faceUp: true, rank: "2" as const, suit: "s" as const },
      { uid: "c", faceUp: true, rank: "A" as const, suit: "h" as const },
      { uid: "d", faceUp: true, rank: "Joker" as const, suit: "joker" as const },
    ];
    expect(sortCards(cards, "suit").map((c) => c.uid)).toEqual(["b", "a", "c", "d"]);
    expect(sortCards(cards, "rank").map((c) => c.uid)).toEqual(["b", "a", "c", "d"]);
  });
});

describe("reconciliation", () => {
  const ops: PendingOp[] = [
    { seq: 1, msg: { type: "PLAY_CARD", uid: "h1", x: 0.9, y: 0.9 }, sentAt: 0 },
    { seq: 2, msg: { type: "MOVE_CARD", uid: "t3", x: 0.6, y: 0.6 }, sentAt: 0 },
  ];

  it("prunes acked ops and drops rejected ones", () => {
    expect(prunePending(ops, 1).map((p) => p.seq)).toEqual([2]);
    expect(dropSeq(ops, 1).map((p) => p.seq)).toEqual([2]);
  });

  it("re-applies remaining pending ops on top of a fresh server snapshot", () => {
    const server = snap({
      ackSeq: 1,
      myHand: snap().myHand.filter((c) => c.uid !== "h1"),
      table: [...snap().table, { uid: "new", faceUp: true, rank: "K", suit: "h", x: 0.9, y: 0.9, playedBy: "p_me" }],
    });
    const pending = prunePending(ops, server.ackSeq);
    const shown = displayState(server, pending)!;
    expect(shown.table.map((c) => c.uid)).toEqual(["t1", "t2", "new", "t3"]);
    expect(shown.table.at(-1)).toMatchObject({ x: 0.6, y: 0.6 });
    expect(shown.myHand.map((c) => c.uid)).toEqual(["h2", "h3"]);
  });

  it("returns null without a server snapshot", () => {
    expect(displayState(null, ops)).toBeNull();
  });
});
