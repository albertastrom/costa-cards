import { describe, expect, it } from "vitest";
import type { Card, ClientMessage, DeckPreset, RoomState } from "../lib/types";
import { ACTIVITY_LIMIT, GHOST_TTL_MS, MAX_PLAYERS } from "../lib/types";
import {
  applyAction,
  buildDeck,
  buildSnapshot,
  canUseDeckControls,
  cardLabel,
  connectedPlayers,
  createEmptyRoom,
  deckSize,
  expireGhosts,
  joinPlayer,
  markGhost,
  nextGhostExpiry,
  removePlayer,
  restoreState,
  sanitizeName,
  shuffle,
  totalCards,
} from "./game";
import { isTopOfStack, stackOf } from "./table";

function seeded(seed = 42): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NOW = 1_700_000_000_000;

function allUids(s: RoomState): string[] {
  return [
    ...s.deck.map((c) => c.uid),
    ...s.table.map((c) => c.uid),
    ...Object.values(s.players).flatMap((p) => p.hand.map((c) => c.uid)),
  ];
}

function assertConserved(s: RoomState) {
  expect(totalCards(s)).toBe(deckSize(s.deckPreset));
  const uids = allUids(s);
  expect(new Set(uids).size).toBe(uids.length);
  for (const c of s.deck) expect(c.faceUp).toBe(false);
}

function faceKey(c: Card) {
  return `${c.rank}${c.suit}`;
}

interface Room {
  state: RoomState;
  ids: string[];
}

function makeRoom(names: string[] = ["Ana", "Ben"], preset: DeckPreset = "standard52"): Room {
  let state = createEmptyRoom({ random: seeded(), now: NOW, deckPreset: preset });
  const ids: string[] = [];
  for (const n of names) {
    const r = joinPlayer(state, `sess-${n}`, n, { random: seeded(ids.length + 7), now: NOW });
    if (!r.ok) throw new Error(r.reason);
    state = r.state;
    ids.push(r.playerId);
  }
  return { state, ids };
}

function act(state: RoomState, playerId: string, msg: ClientMessage): RoomState {
  const r = applyAction(state, playerId, msg, { random: seeded(99), now: NOW + 1 });
  if (!r.ok) throw new Error(`expected ok, got: ${r.reason}`);
  assertConserved(r.state);
  return r.state;
}

function reject(state: RoomState, playerId: string, msg: ClientMessage): string {
  const r = applyAction(state, playerId, msg, { now: NOW + 1 });
  if (r.ok) throw new Error("expected reject");
  return r.reason;
}

function lastLog(s: RoomState): string {
  return s.activity[s.activity.length - 1]?.text ?? "";
}

/** Host draws `n` cards and plays them all to (x,y). Returns state + the played uids (bottom→top). */
function pile(state: RoomState, host: string, n: number, x = 0.5, y = 0.5, faceUp = true) {
  let s = act(state, host, { type: "DRAW", count: n });
  const hand = s.players[host].hand.slice(-n);
  for (const c of hand) s = act(s, host, { type: "PLAY_CARD", uid: c.uid, x, y, faceUp });
  return { state: s, uids: s.table.filter((c) => c.x === x && c.y === y).map((c) => c.uid) };
}

// ---------------------------------------------------------------- deck

describe("deck building", () => {
  it.each([
    ["standard52", 52, 0],
    ["jokers54", 54, 2],
    ["double104", 104, 0],
  ] as const)("%s has %i cards and %i jokers", (preset, size, jokers) => {
    const deck = buildDeck(preset, seeded());
    expect(deck).toHaveLength(size);
    expect(deck.filter((c) => c.rank === "Joker" && c.suit === "joker")).toHaveLength(jokers);
    expect(new Set(deck.map((c) => c.uid)).size).toBe(size);
    expect(deck.every((c) => !c.faceUp && /^c_[0-9a-z]{8}$/.test(c.uid))).toBe(true);
  });

  it("double104 has each face exactly twice", () => {
    const counts = new Map<string, number>();
    for (const c of buildDeck("double104", seeded())) counts.set(faceKey(c), (counts.get(faceKey(c)) ?? 0) + 1);
    expect(counts.size).toBe(52);
    expect([...counts.values()].every((n) => n === 2)).toBe(true);
  });

  it("uids do not correlate with identity across builds", () => {
    const a = buildDeck("standard52", seeded(1));
    const b = buildDeck("standard52", seeded(2));
    const byFaceA = new Map(a.map((c) => [faceKey(c), c.uid]));
    expect(b.some((c) => byFaceA.get(faceKey(c)) === c.uid)).toBe(false);
  });

  it("still yields unique uids from a degenerate random source", () => {
    const deck = buildDeck("standard52", () => 0.3);
    expect(new Set(deck.map((c) => c.uid)).size).toBe(52);
  });

  it("shuffle preserves membership", () => {
    const items = Array.from({ length: 20 }, (_, i) => i);
    expect(shuffle(items, seeded()).sort((x, y) => x - y)).toEqual(items);
  });

  it("cardLabel uses suit symbols and Joker", () => {
    expect(cardLabel({ rank: "K", suit: "h" })).toBe("K♥");
    expect(cardLabel({ rank: "10", suit: "s" })).toBe("10♠");
    expect(cardLabel({ rank: "Joker", suit: "joker" })).toBe("Joker");
  });
});

describe("sanitizeName", () => {
  it("trims, collapses, strips control chars, caps length", () => {
    expect(sanitizeName("   ")).toBeNull();
    expect(sanitizeName("  Ali   ce  ")).toBe("Ali ce");
    expect(sanitizeName(`a${String.fromCharCode(0)}b${String.fromCharCode(0x202e)}c`)).toBe("abc");
    expect(sanitizeName("x".repeat(30))).toHaveLength(20);
  });
});

// ---------------------------------------------------------------- membership

describe("join / reconnect / host", () => {
  it("first player is host; ids are opaque p_ ids", () => {
    const { state, ids } = makeRoom(["Ana", "Ben"]);
    expect(ids[0]).toMatch(/^p_[0-9a-z]{8}$/);
    expect(ids[0]).not.toBe(ids[1]);
    expect(state.players[ids[0]].isHost).toBe(true);
    expect(state.players[ids[1]].isHost).toBe(false);
    expect(state.players[ids[1]].seat).toBe(1);
    expect(lastLog(state)).toBe("Ben joined");
    assertConserved(state);
  });

  it("rejects empty names", () => {
    const r = joinPlayer(createEmptyRoom(), "s", "   ");
    expect(r.ok).toBe(false);
  });

  it("reconnect by sessionId reattaches same id and clears ghost", () => {
    const { state, ids } = makeRoom(["Ana", "Ben"]);
    const ghosted = markGhost(state, ids[1], NOW + GHOST_TTL_MS, { now: NOW });
    expect(ghosted.players[ids[1]].ghostUntil).toBe(NOW + GHOST_TTL_MS);
    const r = joinPlayer(ghosted, "sess-Ben", "Benny", { now: NOW });
    expect(r.ok && r.playerId).toBe(ids[1]);
    if (!r.ok) return;
    expect(r.reconnected).toBe(true);
    expect(r.state.players[ids[1]].ghostUntil).toBeUndefined();
    expect(r.state.players[ids[1]].name).toBe("Benny");
  });

  it("reconnect of a non-ghost session (stale socket) keeps the same id", () => {
    const { state, ids } = makeRoom(["Ana"]);
    const r = joinPlayer(state, "sess-Ana", "Ana");
    expect(r.ok && r.playerId).toBe(ids[0]);
  });

  it("host disconnect promotes lowest connected seat; returning host does not steal it back", () => {
    const { state, ids } = makeRoom(["Ana", "Ben", "Cy"]);
    let s = markGhost(state, ids[0], NOW + 1000, { now: NOW });
    expect(s.players[ids[0]].isHost).toBe(false);
    expect(s.players[ids[1]].isHost).toBe(true);
    expect(lastLog(s)).toBe("Ben is now the host");
    const r = joinPlayer(s, "sess-Ana", "Ana");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    expect(s.players[ids[0]].isHost).toBe(false);
    expect(s.players[ids[1]].isHost).toBe(true);
    expect(Object.values(s.players).filter((p) => p.isHost)).toHaveLength(1);
  });

  it("lone host who disconnects and returns is host again", () => {
    const { state, ids } = makeRoom(["Ana"]);
    const s = markGhost(state, ids[0], NOW + 1000);
    const r = joinPlayer(s, "sess-Ana", "Ana");
    expect(r.ok && r.state.players[ids[0]].isHost).toBe(true);
  });

  it("a newcomer into a room of ghosts becomes host", () => {
    const { state, ids } = makeRoom(["Ana"]);
    const s = markGhost(state, ids[0], NOW + 1000);
    const r = joinPlayer(s, "sess-new", "Neo");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.players[r.playerId].isHost).toBe(true);
    expect(r.state.players[ids[0]].isHost).toBe(false);
  });

  it("enforces MAX_PLAYERS connected, ignoring ghosts", () => {
    const names = Array.from({ length: MAX_PLAYERS }, (_, i) => `P${i}`);
    const { state, ids } = makeRoom(names);
    const full = joinPlayer(state, "sess-extra", "Extra");
    expect(full.ok).toBe(false);
    if (!full.ok) expect(full.code).toBe("ROOM_FULL");
    const s = markGhost(state, ids[3], NOW + 1000);
    expect(joinPlayer(s, "sess-extra", "Extra").ok).toBe(true);
  });

  it("removePlayer returns hand face-down to the bottom of the deck with new uids", () => {
    const { state, ids } = makeRoom(["Ana", "Ben"]);
    let s = act(state, ids[0], { type: "DEAL", count: 5 });
    const benHand = s.players[ids[1]].hand;
    s = removePlayer(s, ids[1], { now: NOW });
    assertConserved(s);
    expect(s.players[ids[1]]).toBeUndefined();
    const bottom = s.deck.slice(-5);
    expect(bottom.map(faceKey)).toEqual(benHand.map(faceKey));
    expect(bottom.some((c) => benHand.some((h) => h.uid === c.uid))).toBe(false);
    expect(lastLog(s)).toBe("Ben left (5 cards returned to deck)");
  });

  it("host leaving promotes the next player (single helper)", () => {
    const { state, ids } = makeRoom(["Ana", "Ben"]);
    const s = removePlayer(state, ids[0]);
    expect(s.players[ids[1]].isHost).toBe(true);
  });

  it("expireGhosts removes only expired ghosts and returns their cards", () => {
    const { state, ids } = makeRoom(["Ana", "Ben", "Cy"]);
    let s = act(state, ids[0], { type: "DEAL", count: 3 });
    s = markGhost(s, ids[1], NOW + 100);
    s = markGhost(s, ids[2], NOW + 500);
    expect(nextGhostExpiry(s)).toBe(NOW + 100);
    expect(expireGhosts(s, NOW + 50)).toBe(s);
    s = expireGhosts(s, NOW + 100);
    assertConserved(s);
    expect(s.players[ids[1]]).toBeUndefined();
    expect(s.players[ids[2]]).toBeDefined();
    expect(s.deck).toHaveLength(52 - 9 + 3);
    expect(lastLog(s)).toBe("Ben timed out (3 cards returned to deck)");
  });

  it("does not mutate inputs", () => {
    const { state, ids } = makeRoom(["Ana", "Ben"]);
    const before = JSON.stringify(state);
    act(state, ids[0], { type: "DEAL", count: 3 });
    markGhost(state, ids[1], NOW);
    removePlayer(state, ids[1]);
    joinPlayer(state, "x", "X");
    expect(JSON.stringify(state)).toBe(before);
  });
});

// ---------------------------------------------------------------- permissions

describe("permissions", () => {
  const deckOps: ClientMessage[] = [
    { type: "SHUFFLE" },
    { type: "DEAL", count: 1 },
    { type: "DRAW_TO_TABLE", x: 0.5, y: 0.5, faceUp: true },
    { type: "RESET_DECK" },
  ];

  it.each(deckOps)("$type is host-only by default", (msg) => {
    const { state, ids } = makeRoom();
    expect(canUseDeckControls(state, ids[1])).toBe(false);
    expect(reject(state, ids[1], msg)).toMatch(/host/i);
    act(state, ids[0], msg);
  });

  it.each(deckOps)("$type is open to all with openDeckControls", (msg) => {
    const { state, ids } = makeRoom();
    const s = act(state, ids[0], { type: "UPDATE_SETTINGS", settings: { openDeckControls: true } });
    act(s, ids[1], msg);
  });

  it("COLLECT_STACK is host-only by default", () => {
    const { state, ids } = makeRoom();
    const { state: s, uids } = pile(state, ids[0], 3);
    expect(reject(s, ids[1], { type: "COLLECT_STACK", uid: uids[0], keepTop: false, shuffle: false })).toMatch(
      /host/i,
    );
  });

  it("host-only admin ops reject non-hosts even with open deck controls", () => {
    const { state, ids } = makeRoom();
    const s = act(state, ids[0], { type: "UPDATE_SETTINGS", settings: { openDeckControls: true } });
    expect(reject(s, ids[1], { type: "UPDATE_SETTINGS", settings: { cardBack: "blue" } })).toBe("Host only");
    expect(reject(s, ids[1], { type: "TRANSFER_HOST", playerId: ids[1] })).toBe("Host only");
    expect(reject(s, ids[1], { type: "KICK_PLAYER", playerId: ids[0] })).toBe("Host only");
  });

  it("anyone may DRAW; ghosts and strangers may not act", () => {
    const { state, ids } = makeRoom();
    act(state, ids[1], { type: "DRAW" });
    const g = markGhost(state, ids[1], NOW + 1000);
    expect(reject(g, ids[1], { type: "DRAW" })).toMatch(/Reconnecting/);
    expect(reject(state, "p_nobody", { type: "DRAW" })).toBe("Not in room");
  });

  it("JOIN/LEAVE are not handled by applyAction", () => {
    const { state, ids } = makeRoom();
    expect(reject(state, ids[0], { type: "LEAVE" })).toBeTruthy();
  });
});

// ---------------------------------------------------------------- deck ops

describe("DEAL / DRAW", () => {
  it("deals round-robin in seat order, count passes", () => {
    const { state, ids } = makeRoom(["Ana", "Ben", "Cy"]);
    const top = state.deck.slice(0, 6);
    const s = act(state, ids[0], { type: "DEAL", count: 2 });
    expect(s.players[ids[0]].hand.map((c) => c.uid)).toEqual([top[0].uid, top[3].uid]);
    expect(s.players[ids[1]].hand.map((c) => c.uid)).toEqual([top[1].uid, top[4].uid]);
    expect(s.players[ids[2]].hand.map((c) => c.uid)).toEqual([top[2].uid, top[5].uid]);
    expect(s.players[ids[0]].hand.every((c) => c.faceUp)).toBe(true);
    expect(s.phase).toBe("playing");
    expect(lastLog(s)).toBe("Ana dealt 2 each");
  });

  it("skips ghosts and supports face-down deals", () => {
    const { state, ids } = makeRoom(["Ana", "Ben", "Cy"]);
    const g = markGhost(state, ids[1], NOW + 1000);
    const s = act(g, ids[0], { type: "DEAL", count: 3, faceUp: false });
    expect(s.players[ids[1]].hand).toHaveLength(0);
    expect(s.players[ids[2]].hand).toHaveLength(3);
    expect(s.players[ids[2]].hand.every((c) => !c.faceUp)).toBe(true);
  });

  it("stops when the deck runs out", () => {
    const { state, ids } = makeRoom(["Ana", "Ben", "Cy"]);
    const s = act(state, ids[0], { type: "DEAL", count: 26 }); // 3*26 > 52
    expect(s.deck).toHaveLength(0);
    expect(s.players[ids[0]].hand).toHaveLength(18);
    expect(s.players[ids[2]].hand).toHaveLength(17);
    expect(lastLog(s)).toBe("Ana dealt 52 cards (deck ran out)");
    expect(reject(s, ids[0], { type: "DEAL", count: 1 })).toBe("Deck empty");
  });

  it.each([0, -1, 27, 1.5, NaN])("rejects deal count %s", (count) => {
    const { state, ids } = makeRoom();
    expect(reject(state, ids[0], { type: "DEAL", count })).toBe("Invalid deal count");
  });

  it("DRAW defaults to 1 face-up, supports blind, and logs", () => {
    const { state, ids } = makeRoom();
    let s = act(state, ids[1], { type: "DRAW" });
    expect(s.players[ids[1]].hand).toHaveLength(1);
    expect(s.players[ids[1]].hand[0].faceUp).toBe(true);
    expect(lastLog(s)).toBe("Ben drew 1 card");
    s = act(s, ids[1], { type: "DRAW", count: 2, faceUp: false });
    expect(s.players[ids[1]].hand.slice(1).every((c) => !c.faceUp)).toBe(true);
    expect(lastLog(s)).toBe("Ben drew 2 cards blind");
  });

  it("DRAW rejects empty deck and bad counts", () => {
    const { state, ids } = makeRoom(["Ana"]);
    expect(reject(state, ids[0], { type: "DRAW", count: 0 })).toBe("Invalid draw count");
    const s = act(state, ids[0], { type: "DEAL", count: 26 });
    const s2 = act(s, ids[0], { type: "DEAL", count: 26 });
    expect(reject(s2, ids[0], { type: "DRAW" })).toBe("Deck empty");
  });

  it("DRAW_TO_TABLE places the top deck card, snapped", () => {
    const { state, ids } = makeRoom();
    const top = state.deck[0];
    let s = act(state, ids[0], { type: "DRAW_TO_TABLE", x: 0.3, y: 0.3, faceUp: true });
    expect(s.table[0]).toMatchObject({ uid: top.uid, x: 0.3, y: 0.3, faceUp: true, playedBy: ids[0] });
    expect(lastLog(s)).toBe(`Ana turned up ${cardLabel(top)} from the deck`);
    s = act(s, ids[0], { type: "DRAW_TO_TABLE", x: 0.31, y: 0.31, faceUp: false });
    expect(s.table[1]).toMatchObject({ x: 0.3, y: 0.3, faceUp: false });
    expect(lastLog(s)).not.toContain(s.table[1].rank);
  });

  it("SHUFFLE keeps membership", () => {
    const { state, ids } = makeRoom();
    const s = act(state, ids[0], { type: "SHUFFLE" });
    expect(s.deck.map((c) => c.uid).sort()).toEqual(state.deck.map((c) => c.uid).sort());
    expect(lastLog(s)).toBe("Ana shuffled the deck");
  });

  it("RESET_DECK rebuilds for a new preset and clears table and hands", () => {
    const { state, ids } = makeRoom();
    let s = act(state, ids[0], { type: "DEAL", count: 5 });
    s = act(s, ids[0], { type: "DRAW_TO_TABLE", x: 0.5, y: 0.5, faceUp: true });
    s = act(s, ids[0], { type: "RESET_DECK", deckPreset: "jokers54" });
    expect(s.deckPreset).toBe("jokers54");
    expect(s.deck).toHaveLength(54);
    expect(s.table).toHaveLength(0);
    expect(Object.values(s.players).every((p) => p.hand.length === 0)).toBe(true);
    expect(s.phase).toBe("lobby");
    s = act(s, ids[0], { type: "RESET_DECK" });
    expect(s.deck).toHaveLength(54);
    s = act(s, ids[0], { type: "RESET_DECK", deckPreset: "double104" });
    expect(s.deck).toHaveLength(104);
  });
});

// ---------------------------------------------------------------- card ops

describe("single-card ops", () => {
  it("PLAY_CARD keeps uid, defaults face-up, snaps onto nearby stacks", () => {
    const { state, ids } = makeRoom();
    let s = act(state, ids[1], { type: "DRAW", count: 2 });
    const [a, b] = s.players[ids[1]].hand;
    s = act(s, ids[1], { type: "PLAY_CARD", uid: a.uid, x: 0.4, y: 0.4 });
    expect(s.table[0]).toMatchObject({ uid: a.uid, faceUp: true, x: 0.4, y: 0.4, playedBy: ids[1] });
    expect(lastLog(s)).toBe(`Ben played ${cardLabel(a)}`);
    s = act(s, ids[1], { type: "PLAY_CARD", uid: b.uid, x: 0.42, y: 0.41, faceUp: false });
    expect(s.table[1]).toMatchObject({ uid: b.uid, faceUp: false, x: 0.4, y: 0.4 });
    expect(lastLog(s)).toBe("Ben played a card face-down");
    expect(isTopOfStack(s.table, b.uid)).toBe(true);
  });

  it("PLAY_CARD clamps coordinates and rejects foreign cards", () => {
    const { state, ids } = makeRoom();
    let s = act(state, ids[0], { type: "DEAL", count: 1 });
    const mine = s.players[ids[0]].hand[0];
    const theirs = s.players[ids[1]].hand[0];
    expect(reject(s, ids[0], { type: "PLAY_CARD", uid: theirs.uid, x: 0, y: 0 })).toBe("Card not in hand");
    s = act(s, ids[0], { type: "PLAY_CARD", uid: mine.uid, x: 5, y: -3 });
    expect(s.table[0]).toMatchObject({ x: 1, y: 0 });
  });

  it("TAKE_CARD: top only, enters hand face-up with a new uid", () => {
    const { state, ids } = makeRoom();
    const { state: s, uids } = pile(state, ids[0], 3, 0.5, 0.5, false);
    expect(reject(s, ids[1], { type: "TAKE_CARD", uid: uids[0] })).toMatch(/top card/);
    const taken = s.table.find((c) => c.uid === uids[2])!;
    const s2 = act(s, ids[1], { type: "TAKE_CARD", uid: uids[2] });
    const got = s2.players[ids[1]].hand[0];
    expect(got.faceUp).toBe(true);
    expect(got.uid).not.toBe(uids[2]);
    expect(faceKey(got)).toBe(faceKey(taken));
    expect(lastLog(s2)).toBe("Ben took a face-down card");
    expect(reject(s2, ids[1], { type: "TAKE_CARD", uid: "c_missing" })).toBe("Card not on table");
  });

  it("MOVE_CARD: top only, snaps excluding itself, goes on top of the target", () => {
    const { state, ids } = makeRoom();
    const { state: s0, uids } = pile(state, ids[0], 2, 0.2, 0.2);
    const r = pile(s0, ids[0], 1, 0.8, 0.8);
    let s = r.state;
    expect(reject(s, ids[0], { type: "MOVE_CARD", uid: uids[0], x: 0.5, y: 0.5 })).toMatch(/top card/);
    // nudge within own snap radius: excluded from snapping to itself, but still snaps to its old stack-mate
    s = act(s, ids[0], { type: "MOVE_CARD", uid: r.uids[0], x: 0.21, y: 0.21 });
    expect(stackOf(s.table, uids[0]).map((c) => c.uid)).toEqual([...uids, r.uids[0]]);
    // free move to empty space
    s = act(s, ids[1], { type: "MOVE_CARD", uid: r.uids[0], x: 0.6, y: 0.65 });
    expect(s.table.find((c) => c.uid === r.uids[0])).toMatchObject({ x: 0.6, y: 0.65, playedBy: ids[1] });
  });

  it("FLIP_CARD: top only; turning face-down issues a new uid", () => {
    const { state, ids } = makeRoom();
    const { state: s, uids } = pile(state, ids[0], 2);
    expect(reject(s, ids[0], { type: "FLIP_CARD", uid: uids[0] })).toMatch(/top card/);
    const s2 = act(s, ids[0], { type: "FLIP_CARD", uid: uids[1] });
    const top = s2.table[s2.table.length - 1];
    expect(top.faceUp).toBe(false);
    expect(top.uid).not.toBe(uids[1]);
    expect(lastLog(s2)).toBe("Ana turned a card face-down");
    const s3 = act(s2, ids[0], { type: "FLIP_CARD", uid: top.uid });
    const up = s3.table[s3.table.length - 1];
    expect(up.faceUp).toBe(true);
    expect(up.uid).toBe(top.uid);
    expect(lastLog(s3)).toBe(`Ana flipped ${cardLabel(up)}`);
  });

  it("FLIP_HAND_CARD toggles own visibility only, no log", () => {
    const { state, ids } = makeRoom();
    const s = act(state, ids[0], { type: "DRAW", faceUp: false });
    const c = s.players[ids[0]].hand[0];
    const s2 = act(s, ids[0], { type: "FLIP_HAND_CARD", uid: c.uid });
    expect(s2.players[ids[0]].hand[0]).toMatchObject({ uid: c.uid, faceUp: true });
    expect(s2.activity).toEqual(s.activity);
    expect(reject(s, ids[1], { type: "FLIP_HAND_CARD", uid: c.uid })).toBe("Card not in hand");
  });
});

// ---------------------------------------------------------------- stack ops

describe("stack ops", () => {
  it("TAKE_STACK takes the whole pile face-up with new uids (any member identifies it)", () => {
    const { state, ids } = makeRoom();
    const { state: s, uids } = pile(state, ids[0], 4, 0.5, 0.5, false);
    const faces = s.table.map(faceKey);
    const s2 = act(s, ids[1], { type: "TAKE_STACK", uid: uids[1] });
    expect(s2.table).toHaveLength(0);
    const hand = s2.players[ids[1]].hand;
    expect(hand.map(faceKey)).toEqual(faces);
    expect(hand.every((c) => c.faceUp && !uids.includes(c.uid))).toBe(true);
    expect(lastLog(s2)).toBe("Ben took the pile (4)");
  });

  it("MOVE_STACK moves all members preserving order, landing on top of another stack", () => {
    const { state, ids } = makeRoom();
    const { state: s0, uids: a } = pile(state, ids[0], 3, 0.2, 0.2);
    const r = pile(s0, ids[0], 2, 0.7, 0.7);
    let s = r.state;
    s = act(s, ids[1], { type: "MOVE_STACK", uid: a[0], x: 0.71, y: 0.69 });
    expect(stackOf(s.table, r.uids[0]).map((c) => c.uid)).toEqual([...r.uids, ...a]);
    expect(s.table.every((c) => c.x === 0.7 && c.y === 0.7)).toBe(true);
    // small nudge of a stack doesn't snap onto itself
    s = act(s, ids[1], { type: "MOVE_STACK", uid: a[0], x: 0.72, y: 0.72 });
    expect(stackOf(s.table, a[0])).toHaveLength(5);
  });

  it("FLIP_STACK reverses order and toggles faces; newly hidden cards get new uids", () => {
    const { state, ids } = makeRoom();
    const r = pile(pile(state, ids[0], 2, 0.5, 0.5, true).state, ids[0], 1, 0.5, 0.5, false);
    const s = r.state;
    const before = stackOf(s.table, r.uids[0]); // [up, up, down]
    const s2 = act(s, ids[0], { type: "FLIP_STACK", uid: r.uids[0] });
    const after = stackOf(s2.table, s2.table[0].uid);
    expect(after.map(faceKey)).toEqual([...before].reverse().map(faceKey));
    expect(after.map((c) => c.faceUp)).toEqual([true, false, false]);
    expect(after[0].uid).toBe(before[2].uid); // became face-up: uid kept
    expect(after[1].uid).not.toBe(before[1].uid);
    expect(after[2].uid).not.toBe(before[0].uid);
    expect(lastLog(s2)).toBe("Ana flipped the pile (3)");
  });

  it("COLLECT_STACK keepTop puts the rest face-down at the deck bottom with new uids", () => {
    const { state, ids } = makeRoom();
    const { state: s, uids } = pile(state, ids[0], 4);
    const faces = s.table.map(faceKey);
    const s2 = act(s, ids[0], { type: "COLLECT_STACK", uid: uids[0], keepTop: true, shuffle: false });
    expect(s2.table.map((c) => c.uid)).toEqual([uids[3]]);
    const bottom = s2.deck.slice(-3);
    expect(bottom.map(faceKey)).toEqual(faces.slice(0, 3));
    expect(bottom.some((c) => uids.includes(c.uid))).toBe(false);
    expect(lastLog(s2)).toBe("Ana returned 3 cards to the deck");
    expect(reject(s2, ids[0], { type: "COLLECT_STACK", uid: uids[3], keepTop: true, shuffle: false })).toBe(
      "Nothing to collect",
    );
  });

  it("COLLECT_STACK with shuffle", () => {
    const { state, ids } = makeRoom();
    const { state: s, uids } = pile(state, ids[0], 5);
    const s2 = act(s, ids[0], { type: "COLLECT_STACK", uid: uids[2], keepTop: false, shuffle: true });
    expect(s2.table).toHaveLength(0);
    expect(s2.deck).toHaveLength(52);
    expect(lastLog(s2)).toBe("Ana returned 5 cards to the deck and shuffled");
  });
});

// ---------------------------------------------------------------- hand / settings / admin

describe("SORT_HAND", () => {
  function handFrom(cards: [string, string][]): Card[] {
    return cards.map(([rank, suit], i) => ({ uid: `c_t${i}`, rank, suit, faceUp: true }) as Card);
  }
  function withHand(cards: Card[]) {
    const { state, ids } = makeRoom(["Ana"], "jokers54");
    // move matching cards from deck into hand to keep conservation
    const deck = [...state.deck];
    const hand: Card[] = [];
    for (const want of cards) {
      const i = deck.findIndex((c) => c.rank === want.rank && c.suit === want.suit);
      hand.push({ ...deck.splice(i, 1)[0], faceUp: true });
    }
    const s: RoomState = { ...state, deck, players: { [ids[0]]: { ...state.players[ids[0]], hand } } };
    return { s, id: ids[0] };
  }

  it("by rank: 2..10,J,Q,K,A, jokers last, ties by suit", () => {
    const { s, id } = withHand(
      handFrom([["Joker", "joker"], ["A", "s"], ["2", "d"], ["K", "h"], ["2", "s"], ["10", "c"]]),
    );
    const sorted = act(s, id, { type: "SORT_HAND", by: "rank" }).players[id].hand.map(cardLabel);
    expect(sorted).toEqual(["2♠", "2♦", "10♣", "K♥", "A♠", "Joker"]);
  });

  it("by suit: suit groups then rank", () => {
    const { s, id } = withHand(handFrom([["Joker", "joker"], ["A", "s"], ["3", "h"], ["2", "s"], ["K", "h"]]));
    const sorted = act(s, id, { type: "SORT_HAND", by: "suit" }).players[id].hand.map(cardLabel);
    expect(sorted).toEqual(["2♠", "A♠", "3♥", "K♥", "Joker"]);
  });
});

describe("settings / host admin", () => {
  it("UPDATE_SETTINGS validates and logs", () => {
    const { state, ids } = makeRoom();
    const s = act(state, ids[0], { type: "UPDATE_SETTINGS", settings: { cardBack: "nebula" } });
    expect(s.settings.cardBack).toBe("nebula");
    expect(lastLog(s)).toBe("Ana changed the card back");
    expect(
      reject(s, ids[0], { type: "UPDATE_SETTINGS", settings: { cardBack: "plaid" as never } }),
    ).toBe("Unknown card back");
    expect(reject(s, ids[0], { type: "UPDATE_SETTINGS", settings: {} })).toBe("Nothing changed");
    expect(state.settings.openDeckControls).toBe(false);
  });

  it("TRANSFER_HOST to a connected player only", () => {
    const { state, ids } = makeRoom(["Ana", "Ben", "Cy"]);
    const s = act(state, ids[0], { type: "TRANSFER_HOST", playerId: ids[1] });
    expect(s.players[ids[1]].isHost).toBe(true);
    expect(s.players[ids[0]].isHost).toBe(false);
    expect(lastLog(s)).toBe("Ana made Ben the host");
    const g = markGhost(state, ids[2], NOW + 100);
    expect(reject(g, ids[0], { type: "TRANSFER_HOST", playerId: ids[2] })).toBe("Player is disconnected");
    expect(reject(state, ids[0], { type: "TRANSFER_HOST", playerId: "p_x" })).toBe("No such player");
  });

  it("KICK_PLAYER removes a player and returns their hand to the deck", () => {
    const { state, ids } = makeRoom(["Ana", "Ben"]);
    const s = act(state, ids[0], { type: "DEAL", count: 4 });
    const s2 = act(s, ids[0], { type: "KICK_PLAYER", playerId: ids[1] });
    expect(s2.players[ids[1]]).toBeUndefined();
    expect(s2.deck).toHaveLength(52 - 4);
    expect(lastLog(s2)).toBe("Ana removed Ben (4 cards returned to deck)");
    expect(reject(s, ids[0], { type: "KICK_PLAYER", playerId: ids[0] })).toMatch(/yourself/);
  });
});

// ---------------------------------------------------------------- activity / snapshot

describe("activity feed", () => {
  it("is a ring buffer of ACTIVITY_LIMIT with increasing ids", () => {
    const { state, ids } = makeRoom();
    let s = state;
    for (let i = 0; i < ACTIVITY_LIMIT + 5; i++) s = act(s, ids[0], { type: "SHUFFLE" });
    expect(s.activity).toHaveLength(ACTIVITY_LIMIT);
    const idsSeen = s.activity.map((a) => a.id);
    expect(idsSeen).toEqual([...idsSeen].sort((a, b) => a - b));
    expect(s.updatedAt).toBe(NOW + 1);
  });

  it("never names a hidden card in a long random-ish session", () => {
    const { state, ids } = makeRoom();
    let s = act(state, ids[0], { type: "DEAL", count: 5, faceUp: false });
    for (const c of s.players[ids[0]].hand) {
      s = act(s, ids[0], { type: "PLAY_CARD", uid: c.uid, x: 0.5, y: 0.5, faceUp: false });
    }
    s = act(s, ids[1], { type: "TAKE_CARD", uid: s.table[s.table.length - 1].uid });
    s = act(s, ids[0], { type: "DRAW_TO_TABLE", x: 0.1, y: 0.1, faceUp: false });
    for (const a of s.activity) expect(a.text).not.toMatch(/[♥♦♠♣]|Joker/);
  });
});

describe("buildSnapshot", () => {
  it("redacts hidden faces, hides sessionIds, sorts by seat, carries ackSeq", () => {
    const { state, ids } = makeRoom(["Ana", "Ben", "Cy"]);
    let s = act(state, ids[0], { type: "DEAL", count: 2, faceUp: false });
    s = act(s, ids[0], { type: "FLIP_HAND_CARD", uid: s.players[ids[0]].hand[0].uid });
    s = act(s, ids[1], { type: "PLAY_CARD", uid: s.players[ids[1]].hand[0].uid, x: 0.5, y: 0.5, faceUp: false });
    s = act(s, ids[1], { type: "PLAY_CARD", uid: s.players[ids[1]].hand[0].uid, x: 0.2, y: 0.2 });
    s = markGhost(s, ids[2], NOW + 100);

    const snap = buildSnapshot(s, ids[0], "ABCDE", 17);
    expect(JSON.stringify(snap)).not.toContain("sess-");
    expect(snap.ackSeq).toBe(17);
    expect(snap.roomCode).toBe("ABCDE");
    expect(snap.playerId).toBe(ids[0]);
    expect(snap.myHand[0].rank).toBeDefined();
    expect(snap.myHand[1]).toEqual({ uid: s.players[ids[0]].hand[1].uid, faceUp: false });
    expect(snap.table[0]).toEqual({ uid: s.table[0].uid, faceUp: false, x: 0.5, y: 0.5, playedBy: ids[1] });
    expect(snap.table[1].rank).toBeDefined();
    expect(snap.players.map((p) => p.seat)).toEqual([0, 1, 2]);
    expect(snap.players[2].connected).toBe(false);
    expect(snap.players[1].handCount).toBe(0);
    expect(snap.deckCount).toBe(52 - 6);
    expect(snap.deckPreset).toBe("standard52");
    expect(snap.settings).toEqual({ cardBack: "red", openDeckControls: false });
    expect(snap.activity.length).toBeGreaterThan(0);
    expect(connectedPlayers(s)).toHaveLength(2);
  });
});

// ---------------------------------------------------------------- persistence

describe("restoreState", () => {
  it("round-trips through JSON and ghosts everyone", () => {
    const { state, ids } = makeRoom(["Ana", "Ben"]);
    const s = act(state, ids[0], { type: "DEAL", count: 3 });
    const restored = restoreState(JSON.parse(JSON.stringify(s)), NOW + 10);
    expect(restored).not.toBeNull();
    assertConserved(restored!);
    expect(restored!.players[ids[0]].ghostUntil).toBe(NOW + 10 + GHOST_TTL_MS);
    expect(restored!.players[ids[0]].hand).toEqual(s.players[ids[0]].hand);
  });

  it("keeps an earlier existing ghostUntil", () => {
    const { state, ids } = makeRoom(["Ana"]);
    const s = markGhost(state, ids[0], NOW + 5);
    expect(restoreState(s, NOW)!.players[ids[0]].ghostUntil).toBe(NOW + 5);
  });

  it.each([
    null,
    "x",
    { deck: [], table: [], players: {}, phase: "lobby" }, // v1 shape
    { ...createEmptyRoom(), deck: [] }, // broken conservation
    { ...createEmptyRoom(), phase: "weird" },
  ])("rejects invalid shape %#", (raw) => {
    expect(restoreState(raw)).toBeNull();
  });
});
