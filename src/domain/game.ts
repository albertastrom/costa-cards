import type {
  ActivityEntry,
  Card,
  CardRank,
  CardSuit,
  CardUid,
  CardView,
  ClientMessage,
  ClientSnapshot,
  DeckPreset,
  Player,
  PlayerPublic,
  Rank,
  RoomSettings,
  RoomState,
  Suit,
  TableCard,
} from "../lib/types";
import {
  ACTIVITY_LIMIT,
  DEFAULT_SETTINGS,
  GHOST_TTL_MS,
  MAX_DEAL_COUNT,
  MAX_NAME_LENGTH,
  MAX_PLAYERS,
} from "../lib/types";
import { isCardBackId, isDeckPreset } from "../lib/protocol";
import { isTopOfStack, snapToStack, stackOf } from "./table";

export interface DomainOptions {
  random?: () => number;
  now?: number;
}

export type ActionResult =
  | { ok: true; state: RoomState }
  | { ok: false; reason: string; uid?: CardUid };

export type JoinResult =
  | { ok: true; state: RoomState; playerId: string; reconnected: boolean }
  | { ok: false; reason: string; code?: "ROOM_FULL" };

export type ActionMessage = Exclude<ClientMessage, { type: "JOIN" } | { type: "LEAVE" }>;

export const SUITS: readonly Suit[] = ["s", "h", "c", "d"];
export const RANKS: readonly Rank[] = [
  "A",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "10",
  "J",
  "Q",
  "K",
];
const ALL_RANKS: readonly CardRank[] = [...RANKS, "Joker"];
const ALL_SUITS: readonly CardSuit[] = [...SUITS, "joker"];

const RANK_ORDER: readonly CardRank[] = [
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "10",
  "J",
  "Q",
  "K",
  "A",
  "Joker",
];
const SUIT_ORDER: readonly CardSuit[] = ["s", "h", "c", "d", "joker"];
const SUIT_SYMBOL: Record<CardSuit, string> = { h: "♥", d: "♦", s: "♠", c: "♣", joker: "" };

export function deckSize(preset: DeckPreset): number {
  return preset === "standard52" ? 52 : preset === "jokers54" ? 54 : 104;
}

export function defaultRandom(): number {
  const c = globalThis.crypto;
  if (c && typeof c.getRandomValues === "function") {
    const buf = new Uint32Array(1);
    c.getRandomValues(buf);
    return buf[0] / 4294967296;
  }
  return Math.random();
}

const ID_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

export function randomId(prefix: string, random: () => number = defaultRandom, length = 8): string {
  let out = prefix;
  for (let i = 0; i < length; i++) {
    const r = Math.min(Math.max(random(), 0), 0.999999999);
    out += ID_ALPHABET[Math.floor(r * ID_ALPHABET.length)];
  }
  return out;
}

function uniqueId(prefix: string, used: Set<string>, random: () => number): string {
  for (let i = 0; i < 8; i++) {
    const id = randomId(prefix, random);
    if (!used.has(id)) {
      used.add(id);
      return id;
    }
  }
  for (;;) {
    const id = randomId(prefix, defaultRandom, 10);
    if (!used.has(id)) {
      used.add(id);
      return id;
    }
  }
}

export function shuffle<T>(items: readonly T[], random: () => number = defaultRandom): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.min(i, Math.floor(random() * (i + 1)));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function buildDeck(preset: DeckPreset, random: () => number = defaultRandom): Card[] {
  const faces: { rank: CardRank; suit: CardSuit }[] = [];
  const copies = preset === "double104" ? 2 : 1;
  for (let k = 0; k < copies; k++) {
    for (const suit of SUITS) for (const rank of RANKS) faces.push({ rank, suit });
  }
  if (preset === "jokers54") {
    faces.push({ rank: "Joker", suit: "joker" }, { rank: "Joker", suit: "joker" });
  }
  const used = new Set<string>();
  return shuffle(faces, random).map((f) => ({
    uid: uniqueId("c_", used, random),
    rank: f.rank,
    suit: f.suit,
    faceUp: false,
  }));
}

export function cardLabel(card: { rank: CardRank; suit: CardSuit }): string {
  return card.rank === "Joker" ? "Joker" : `${card.rank}${SUIT_SYMBOL[card.suit]}`;
}

export function compareCards(a: Card, b: Card, by: "rank" | "suit"): number {
  const r = RANK_ORDER.indexOf(a.rank) - RANK_ORDER.indexOf(b.rank);
  const s = SUIT_ORDER.indexOf(a.suit) - SUIT_ORDER.indexOf(b.suit);
  return by === "rank" ? r || s : s || r;
}

/** Total cards across deck, table and all hands. */
export function totalCards(state: RoomState): number {
  let n = state.deck.length + state.table.length;
  for (const p of Object.values(state.players)) n += p.hand.length;
  return n;
}

// ---------------------------------------------------------------------------
// Room & players
// ---------------------------------------------------------------------------

export function createEmptyRoom(opts: DomainOptions & { deckPreset?: DeckPreset } = {}): RoomState {
  const preset = opts.deckPreset ?? "standard52";
  return {
    deck: buildDeck(preset, opts.random),
    table: [],
    players: {},
    phase: "lobby",
    deckPreset: preset,
    settings: { ...DEFAULT_SETTINGS },
    activity: [],
    nextActivityId: 1,
    nextSeat: 0,
    updatedAt: opts.now ?? Date.now(),
  };
}

/** Control characters, zero-width and bidi-override code points. */
function isInvisible(cp: number): boolean {
  return (
    cp <= 0x1f ||
    (cp >= 0x7f && cp <= 0x9f) ||
    (cp >= 0x200b && cp <= 0x200f) ||
    (cp >= 0x2028 && cp <= 0x202e) ||
    (cp >= 0x2066 && cp <= 0x2069) ||
    cp === 0xfeff
  );
}

/** Trim, strip control characters, collapse whitespace, cap length. Null if empty. */
export function sanitizeName(raw: string): string | null {
  const cleaned = Array.from(raw).filter((ch) => !isInvisible(ch.codePointAt(0) ?? 0)).join("");
  const name = Array.from(cleaned.replace(/\s+/g, " ").trim())
    .slice(0, MAX_NAME_LENGTH)
    .join("")
    .trim();
  return name || null;
}

export function isConnected(p: Player): boolean {
  return p.ghostUntil === undefined;
}

/** Connected (non-ghost) players in seat order. */
export function connectedPlayers(state: RoomState): Player[] {
  return Object.values(state.players)
    .filter(isConnected)
    .sort((a, b) => a.seat - b.seat);
}

export function findBySession(state: RoomState, sessionId: string): Player | undefined {
  return Object.values(state.players).find((p) => p.sessionId === sessionId);
}

/** Whether `playerId` may use SHUFFLE / DEAL / DRAW_TO_TABLE / COLLECT_STACK / RESET_DECK. */
export function canUseDeckControls(state: RoomState, playerId: string): boolean {
  const p = state.players[playerId];
  return !!p && (p.isHost || state.settings.openDeckControls);
}

/** Earliest ghost expiry, if any player is a ghost. */
export function nextGhostExpiry(state: RoomState): number | undefined {
  let min: number | undefined;
  for (const p of Object.values(state.players)) {
    if (p.ghostUntil !== undefined && (min === undefined || p.ghostUntil < min)) min = p.ghostUntil;
  }
  return min;
}

// ---------------------------------------------------------------------------
// Internal mutation context
// ---------------------------------------------------------------------------

interface Ctx {
  state: RoomState;
  random: () => number;
  now: number;
  used?: Set<string>;
}

function cloneState(state: RoomState): RoomState {
  return {
    ...state,
    deck: state.deck.map((c) => ({ ...c })),
    table: state.table.map((c) => ({ ...c })),
    players: Object.fromEntries(
      Object.entries(state.players).map(([id, p]) => [id, { ...p, hand: p.hand.map((c) => ({ ...c })) }]),
    ),
    settings: { ...state.settings },
    activity: state.activity.map((a) => ({ ...a })),
  };
}

function begin(state: RoomState, opts: DomainOptions = {}): Ctx {
  return { state: cloneState(state), random: opts.random ?? defaultRandom, now: opts.now ?? Date.now() };
}

function commit(ctx: Ctx): RoomState {
  ctx.state.updatedAt = ctx.now;
  return ctx.state;
}

// Uids are re-issued whenever a card enters the deck, enters a hand from the table, or turns face-down, so a uid seen face-up never identifies a hidden card.
function freshUid(ctx: Ctx): CardUid {
  if (!ctx.used) {
    const s = ctx.state;
    ctx.used = new Set([
      ...s.deck.map((c) => c.uid),
      ...s.table.map((c) => c.uid),
      ...Object.values(s.players).flatMap((p) => p.hand.map((c) => c.uid)),
    ]);
  }
  return uniqueId("c_", ctx.used, ctx.random);
}

/** A face-down deck card with a fresh uid. */
function toDeckCard(ctx: Ctx, c: Card): Card {
  return { uid: freshUid(ctx), rank: c.rank, suit: c.suit, faceUp: false };
}

function log(ctx: Ctx, text: string): void {
  const s = ctx.state;
  const entry: ActivityEntry = { id: s.nextActivityId, ts: ctx.now, text };
  s.nextActivityId += 1;
  s.activity.push(entry);
  if (s.activity.length > ACTIVITY_LIMIT) s.activity.splice(0, s.activity.length - ACTIVITY_LIMIT);
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/**
 * The single host-promotion rule: if a connected player holds host, they keep it and nobody else
 * does. Otherwise the connected player with the lowest seat becomes host. With nobody connected,
 * flags are left alone (so a lone host who reconnects is still host).
 */
function ensureHost(ctx: Ctx, announce = true): void {
  const connected = connectedPlayers(ctx.state);
  if (connected.length === 0) return;
  const holder = connected.find((p) => p.isHost) ?? connected[0];
  const promoted = !holder.isHost;
  for (const p of Object.values(ctx.state.players)) p.isHost = p.id === holder.id;
  if (promoted && announce) log(ctx, `${holder.name} is now the host`);
}

/**
 * Returns the player's hand face-down (fresh uids) to the bottom of the deck, deletes the player,
 * logs `${name}${suffix}`, then re-checks host.
 */
function removeInto(ctx: Ctx, playerId: string, describe: (name: string) => string): void {
  const p = ctx.state.players[playerId];
  if (!p) return;
  const returned = p.hand.map((c) => toDeckCard(ctx, c));
  ctx.state.deck.push(...returned);
  delete ctx.state.players[playerId];
  const n = returned.length;
  log(ctx, `${describe(p.name)}${n ? ` (${plural(n, "card")} returned to deck)` : ""}`);
  ensureHost(ctx);
}

export function joinPlayer(
  state: RoomState,
  sessionId: string,
  rawName: string,
  opts: DomainOptions = {},
): JoinResult {
  const name = sanitizeName(rawName);
  if (!name) return { ok: false, reason: "Invalid name" };
  if (!sessionId) return { ok: false, reason: "Missing session" };

  const ctx = begin(state, opts);
  const s = ctx.state;
  const existing = findBySession(s, sessionId);
  const connectedCount = connectedPlayers(s).length;

  if (existing) {
    const wasGhost = !isConnected(existing);
    if (wasGhost && connectedCount >= MAX_PLAYERS) {
      return { ok: false, reason: "Room is full", code: "ROOM_FULL" };
    }
    existing.name = name;
    delete existing.ghostUntil;
    if (wasGhost) log(ctx, `${name} reconnected`);
    ensureHost(ctx);
    return { ok: true, state: commit(ctx), playerId: existing.id, reconnected: true };
  }

  if (connectedCount >= MAX_PLAYERS) {
    return { ok: false, reason: "Room is full", code: "ROOM_FULL" };
  }
  const id = uniqueId("p_", new Set(Object.keys(s.players)), ctx.random);
  s.players[id] = { id, name, hand: [], isHost: false, sessionId, seat: s.nextSeat };
  s.nextSeat += 1;
  log(ctx, `${name} joined`);
  ensureHost(ctx, connectedCount > 0);
  return { ok: true, state: commit(ctx), playerId: id, reconnected: false };
}

/** Mark a player disconnected until `until`. Host passes to a connected player if any. */
export function markGhost(
  state: RoomState,
  playerId: string,
  until: number,
  opts: DomainOptions = {},
): RoomState {
  if (!state.players[playerId]) return state;
  const ctx = begin(state, opts);
  const p = ctx.state.players[playerId];
  p.ghostUntil = until;
  log(ctx, `${p.name} disconnected`);
  ensureHost(ctx);
  return commit(ctx);
}

/**
 * Remove a player (LEAVE / kick / expiry). Their hand goes face-down to the bottom of the deck.
 * `verb` drives the activity text: "Ben left", "Ben timed out".
 */
export function removePlayer(
  state: RoomState,
  playerId: string,
  opts: DomainOptions & { verb?: string } = {},
): RoomState {
  if (!state.players[playerId]) return state;
  const ctx = begin(state, opts);
  removeInto(ctx, playerId, (name) => `${name} ${opts.verb ?? "left"}`);
  return commit(ctx);
}

/** Remove ghosts whose ghostUntil has passed. Returns the same reference if nothing expired. */
export function expireGhosts(state: RoomState, now = Date.now(), opts: DomainOptions = {}): RoomState {
  let next = state;
  for (const p of Object.values(state.players)) {
    if (p.ghostUntil !== undefined && p.ghostUntil <= now) {
      next = removePlayer(next, p.id, { ...opts, now, verb: "timed out" });
    }
  }
  return next;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

interface Fail {
  reason: string;
  uid?: CardUid;
}
type Handler<M> = (ctx: Ctx, me: Player, msg: M) => Fail | void;
type Handlers = { [K in ActionMessage["type"]]: Handler<Extract<ActionMessage, { type: K }>> };

const DECK_OPS = new Set<ActionMessage["type"]>([
  "SHUFFLE",
  "DEAL",
  "DRAW_TO_TABLE",
  "COLLECT_STACK",
  "RESET_DECK",
]);
const HOST_OPS = new Set<ActionMessage["type"]>(["UPDATE_SETTINGS", "TRANSFER_HOST", "KICK_PLAYER"]);

function validCount(n: number): boolean {
  return Number.isInteger(n) && n >= 1 && n <= MAX_DEAL_COUNT;
}

function tableIndex(ctx: Ctx, uid: CardUid): number {
  return ctx.state.table.findIndex((c) => c.uid === uid);
}

/** Look up a table card that must be the top of its stack. */
function topCard(ctx: Ctx, uid: CardUid, verb: string): { idx: number } | Fail {
  const idx = tableIndex(ctx, uid);
  if (idx < 0) return { reason: "Card not on table", uid };
  if (!isTopOfStack(ctx.state.table, uid)) return { reason: `Only the top card can be ${verb}`, uid };
  return { idx };
}

/** Remove a stack's members from the table, returning them bottom → top. */
function liftStack(ctx: Ctx, uid: CardUid): TableCard[] {
  const members = stackOf(ctx.state.table, uid);
  const ids = new Set(members.map((c) => c.uid));
  ctx.state.table = ctx.state.table.filter((c) => !ids.has(c.uid));
  return members;
}

function intoHand(ctx: Ctx, c: Card): Card {
  return { uid: freshUid(ctx), rank: c.rank, suit: c.suit, faceUp: true };
}

const HANDLERS: Handlers = {
  SHUFFLE(ctx, me) {
    ctx.state.deck = shuffle(ctx.state.deck, ctx.random);
    log(ctx, `${me.name} shuffled the deck`);
  },

  RESET_DECK(ctx, me, msg) {
    const preset = msg.deckPreset ?? ctx.state.deckPreset;
    if (!isDeckPreset(preset)) return { reason: "Unknown deck preset" };
    const s = ctx.state;
    s.deckPreset = preset;
    s.deck = buildDeck(preset, ctx.random);
    s.table = [];
    for (const p of Object.values(s.players)) p.hand = [];
    s.phase = "lobby";
    ctx.used = undefined;
    log(ctx, `${me.name} reset the deck (${deckSize(preset)} cards)`);
  },

  DEAL(ctx, me, msg) {
    if (!validCount(msg.count)) return { reason: "Invalid deal count" };
    const s = ctx.state;
    if (s.deck.length === 0) return { reason: "Deck empty" };
    const faceUp = msg.faceUp ?? true;
    const targets = connectedPlayers(s);
    let dealt = 0;
    let passes = 0;
    outer: for (; passes < msg.count; passes++) {
      for (const p of targets) {
        const card = s.deck.shift();
        if (!card) break outer;
        p.hand.push({ ...card, faceUp });
        dealt++;
      }
    }
    s.phase = "playing";
    const suffix = faceUp ? "" : " face-down";
    log(
      ctx,
      passes === msg.count
        ? `${me.name} dealt ${msg.count} each${suffix}`
        : `${me.name} dealt ${plural(dealt, "card")}${suffix} (deck ran out)`,
    );
  },

  DRAW(ctx, me, msg) {
    const count = msg.count ?? 1;
    if (!validCount(count)) return { reason: "Invalid draw count" };
    const s = ctx.state;
    if (s.deck.length === 0) return { reason: "Deck empty" };
    const faceUp = msg.faceUp ?? true;
    const drawn = s.deck.splice(0, count).map((c) => ({ ...c, faceUp }));
    me.hand.push(...drawn);
    s.phase = "playing";
    log(ctx, `${me.name} drew ${plural(drawn.length, "card")}${faceUp ? "" : " blind"}`);
  },

  DRAW_TO_TABLE(ctx, me, msg) {
    const s = ctx.state;
    const card = s.deck.shift();
    if (!card) return { reason: "Deck empty" };
    const at = snapToStack(s.table, msg.x, msg.y);
    // Deck uids are never exposed, so the uid can be kept either way.
    s.table.push({ ...card, faceUp: msg.faceUp, x: at.x, y: at.y, playedBy: me.id });
    s.phase = "playing";
    log(
      ctx,
      msg.faceUp
        ? `${me.name} turned up ${cardLabel(card)} from the deck`
        : `${me.name} dealt a card face-down to the table`,
    );
  },

  COLLECT_STACK(ctx, me, msg) {
    const s = ctx.state;
    if (tableIndex(ctx, msg.uid) < 0) return { reason: "Card not on table", uid: msg.uid };
    const stack = liftStack(ctx, msg.uid);
    const top = msg.keepTop ? stack.pop() : undefined;
    if (stack.length === 0) {
      return { reason: "Nothing to collect", uid: msg.uid };
    }
    if (top) s.table.push(top);
    const returned = stack.map((c) => toDeckCard(ctx, c));
    s.deck = msg.shuffle ? shuffle([...s.deck, ...returned], ctx.random) : [...s.deck, ...returned];
    log(
      ctx,
      `${me.name} returned ${plural(returned.length, "card")} to the deck${msg.shuffle ? " and shuffled" : ""}`,
    );
  },

  PLAY_CARD(ctx, me, msg) {
    const idx = me.hand.findIndex((c) => c.uid === msg.uid);
    if (idx < 0) return { reason: "Card not in hand", uid: msg.uid };
    const faceUp = msg.faceUp ?? true;
    const [card] = me.hand.splice(idx, 1);
    const at = snapToStack(ctx.state.table, msg.x, msg.y);
    // Hand uids are only ever known to the owner, so hand → table keeps the uid.
    ctx.state.table.push({ ...card, faceUp, x: at.x, y: at.y, playedBy: me.id });
    log(ctx, faceUp ? `${me.name} played ${cardLabel(card)}` : `${me.name} played a card face-down`);
  },

  TAKE_CARD(ctx, me, msg) {
    const r = topCard(ctx, msg.uid, "taken");
    if ("reason" in r) return r;
    const [card] = ctx.state.table.splice(r.idx, 1);
    me.hand.push(intoHand(ctx, card));
    log(ctx, card.faceUp ? `${me.name} took ${cardLabel(card)}` : `${me.name} took a face-down card`);
  },

  MOVE_CARD(ctx, me, msg) {
    const r = topCard(ctx, msg.uid, "moved");
    if ("reason" in r) return r;
    const s = ctx.state;
    const [card] = s.table.splice(r.idx, 1);
    const at = snapToStack(s.table, msg.x, msg.y, new Set([card.uid]));
    s.table.push({ ...card, x: at.x, y: at.y, playedBy: me.id });
  },

  FLIP_CARD(ctx, me, msg) {
    const r = topCard(ctx, msg.uid, "flipped");
    if ("reason" in r) return r;
    const card = ctx.state.table[r.idx];
    card.faceUp = !card.faceUp;
    if (!card.faceUp) card.uid = freshUid(ctx);
    log(ctx, card.faceUp ? `${me.name} flipped ${cardLabel(card)}` : `${me.name} turned a card face-down`);
  },

  FLIP_HAND_CARD(_ctx, me, msg) {
    const card = me.hand.find((c) => c.uid === msg.uid);
    if (!card) return { reason: "Card not in hand", uid: msg.uid };
    card.faceUp = !card.faceUp;
  },

  TAKE_STACK(ctx, me, msg) {
    if (tableIndex(ctx, msg.uid) < 0) return { reason: "Card not on table", uid: msg.uid };
    const stack = liftStack(ctx, msg.uid);
    me.hand.push(...stack.map((c) => intoHand(ctx, c)));
    if (stack.length === 1) {
      const c = stack[0];
      log(ctx, c.faceUp ? `${me.name} took ${cardLabel(c)}` : `${me.name} took a face-down card`);
    } else {
      log(ctx, `${me.name} took the pile (${stack.length})`);
    }
  },

  MOVE_STACK(ctx, me, msg) {
    if (tableIndex(ctx, msg.uid) < 0) return { reason: "Card not on table", uid: msg.uid };
    const s = ctx.state;
    const members = stackOf(s.table, msg.uid);
    const at = snapToStack(s.table, msg.x, msg.y, new Set(members.map((c) => c.uid)));
    const stack = liftStack(ctx, msg.uid);
    s.table.push(...stack.map((c) => ({ ...c, x: at.x, y: at.y, playedBy: me.id })));
  },

  FLIP_STACK(ctx, me, msg) {
    if (tableIndex(ctx, msg.uid) < 0) return { reason: "Card not on table", uid: msg.uid };
    const stack = liftStack(ctx, msg.uid);
    const flipped = stack.reverse().map((c) => {
      const faceUp = !c.faceUp;
      return { ...c, faceUp, uid: faceUp ? c.uid : freshUid(ctx), playedBy: me.id };
    });
    ctx.state.table.push(...flipped);
    if (flipped.length === 1) {
      const c = flipped[0];
      log(ctx, c.faceUp ? `${me.name} flipped ${cardLabel(c)}` : `${me.name} turned a card face-down`);
    } else {
      log(ctx, `${me.name} flipped the pile (${flipped.length})`);
    }
  },

  SORT_HAND(_ctx, me, msg) {
    if (msg.by !== "rank" && msg.by !== "suit") return { reason: "Unknown sort" };
    me.hand.sort((a, b) => compareCards(a, b, msg.by));
  },

  UPDATE_SETTINGS(ctx, me, msg) {
    const patch = msg.settings;
    const next: RoomSettings = { ...ctx.state.settings };
    if (patch.cardBack !== undefined) {
      if (!isCardBackId(patch.cardBack)) return { reason: "Unknown card back" };
      next.cardBack = patch.cardBack;
    }
    if (patch.openDeckControls !== undefined) {
      if (typeof patch.openDeckControls !== "boolean") return { reason: "Invalid setting" };
      next.openDeckControls = patch.openDeckControls;
    }
    const prev = ctx.state.settings;
    if (next.cardBack === prev.cardBack && next.openDeckControls === prev.openDeckControls) {
      return { reason: "Nothing changed" };
    }
    ctx.state.settings = next;
    if (next.cardBack !== prev.cardBack) log(ctx, `${me.name} changed the card back`);
    if (next.openDeckControls !== prev.openDeckControls) {
      log(
        ctx,
        next.openDeckControls
          ? `${me.name} opened deck controls to everyone`
          : `${me.name} limited deck controls to the host`,
      );
    }
  },

  TRANSFER_HOST(ctx, me, msg) {
    const target = ctx.state.players[msg.playerId];
    if (!target) return { reason: "No such player" };
    if (target.id === me.id) return { reason: "Already host" };
    if (!isConnected(target)) return { reason: "Player is disconnected" };
    for (const p of Object.values(ctx.state.players)) p.isHost = p.id === target.id;
    log(ctx, `${me.name} made ${target.name} the host`);
  },

  KICK_PLAYER(ctx, me, msg) {
    const target = ctx.state.players[msg.playerId];
    if (!target) return { reason: "No such player" };
    if (target.id === me.id) return { reason: "Can't remove yourself" };
    removeInto(ctx, target.id, (name) => `${me.name} removed ${name}`);
  },
};

/**
 * Single dispatcher for every in-room action except JOIN / LEAVE.
 * Enforces actor presence, ghost status and permissions, then runs the handler on a clone.
 */
export function applyAction(
  state: RoomState,
  playerId: string,
  msg: ClientMessage,
  opts: DomainOptions = {},
): ActionResult {
  if (msg.type === "JOIN" || msg.type === "LEAVE") {
    return { ok: false, reason: "Unsupported action" };
  }
  const actor = state.players[playerId];
  if (!actor) return { ok: false, reason: "Not in room" };
  if (!isConnected(actor)) return { ok: false, reason: "Reconnecting…" };
  if (HOST_OPS.has(msg.type) && !actor.isHost) return { ok: false, reason: "Host only" };
  if (DECK_OPS.has(msg.type) && !canUseDeckControls(state, playerId)) {
    return { ok: false, reason: "Only the host can do that" };
  }
  const handler = HANDLERS[msg.type] as Handler<ActionMessage> | undefined;
  if (!handler) return { ok: false, reason: "Unknown action" };

  const ctx = begin(state, opts);
  const failed = handler(ctx, ctx.state.players[playerId], msg);
  if (failed) return { ok: false, reason: failed.reason, ...(failed.uid ? { uid: failed.uid } : {}) };
  return { ok: true, state: commit(ctx) };
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

function view(c: Card): CardView {
  return c.faceUp
    ? { uid: c.uid, faceUp: true, rank: c.rank, suit: c.suit }
    : { uid: c.uid, faceUp: false };
}

/** Private, redacted snapshot for one viewer. Never includes sessionIds or hidden faces. */
export function buildSnapshot(
  state: RoomState,
  playerId: string,
  roomCode: string,
  ackSeq = 0,
): ClientSnapshot {
  const me = state.players[playerId];
  const players: PlayerPublic[] = Object.values(state.players)
    .sort((a, b) => a.seat - b.seat)
    .map((p) => ({
      id: p.id,
      name: p.name,
      handCount: p.hand.length,
      isHost: p.isHost,
      connected: isConnected(p),
      seat: p.seat,
    }));
  return {
    playerId,
    myHand: me ? me.hand.map(view) : [],
    table: state.table.map((c) => ({ ...view(c), x: c.x, y: c.y, playedBy: c.playedBy })),
    players,
    deckCount: state.deck.length,
    phase: state.phase,
    roomCode,
    deckPreset: state.deckPreset,
    settings: { ...state.settings },
    activity: state.activity.map((a) => ({ ...a })),
    ackSeq,
  };
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isCard(v: unknown): v is Card {
  return (
    isObj(v) &&
    typeof v.uid === "string" &&
    (ALL_RANKS as readonly unknown[]).includes(v.rank) &&
    (ALL_SUITS as readonly unknown[]).includes(v.suit) &&
    typeof v.faceUp === "boolean"
  );
}

function isTableCard(v: unknown): v is TableCard {
  return (
    isCard(v) &&
    Number.isFinite((v as TableCard).x) &&
    Number.isFinite((v as TableCard).y) &&
    typeof (v as TableCard).playedBy === "string"
  );
}

function isPlayer(v: unknown): v is Player {
  return (
    isObj(v) &&
    typeof v.id === "string" &&
    typeof v.name === "string" &&
    typeof v.sessionId === "string" &&
    typeof v.isHost === "boolean" &&
    Number.isInteger(v.seat) &&
    (v.ghostUntil === undefined || Number.isFinite(v.ghostUntil)) &&
    Array.isArray(v.hand) &&
    v.hand.every(isCard)
  );
}

/**
 * Restore persisted state, or null if the shape is unrecognised (old schema, corruption, or a
 * broken card-conservation invariant). Since sockets never survive eviction, every player comes
 * back as a ghost (keeping an earlier ghostUntil if it had one).
 */
export function restoreState(raw: unknown, now = Date.now()): RoomState | null {
  if (!isObj(raw)) return null;
  const r = raw as Partial<RoomState> & Record<string, unknown>;
  if (
    !Array.isArray(r.deck) ||
    !r.deck.every(isCard) ||
    !Array.isArray(r.table) ||
    !r.table.every(isTableCard) ||
    !isObj(r.players) ||
    !Object.entries(r.players).every(([k, p]) => isPlayer(p) && p.id === k) ||
    (r.phase !== "lobby" && r.phase !== "playing") ||
    !isDeckPreset(r.deckPreset) ||
    !isObj(r.settings) ||
    !isCardBackId(r.settings.cardBack) ||
    typeof r.settings.openDeckControls !== "boolean" ||
    !Array.isArray(r.activity) ||
    !Number.isInteger(r.nextActivityId) ||
    !Number.isInteger(r.nextSeat) ||
    !Number.isFinite(r.updatedAt)
  ) {
    return null;
  }
  const state = cloneState(r as RoomState);
  state.activity = state.activity
    .filter((a) => isObj(a) && typeof a.text === "string" && Number.isFinite(a.ts) && Number.isInteger(a.id))
    .slice(-ACTIVITY_LIMIT);
  if (totalCards(state) !== deckSize(state.deckPreset)) return null;
  for (const p of Object.values(state.players)) {
    if (p.ghostUntil === undefined) p.ghostUntil = now + GHOST_TTL_MS;
  }
  return state;
}
