import type {
  CardBackId,
  ClientMessage,
  ClientMessageType,
  DeckPreset,
  RoomSettings,
} from "./types";
import { MAX_MESSAGE_BYTES } from "./types";

export const DECK_PRESETS: readonly DeckPreset[] = ["standard52", "jokers54", "double104"];
export const CARD_BACK_IDS: readonly CardBackId[] = [
  "red",
  "blue",
  "gold",
  "green",
  "black",
  "nebula",
  "argyle",
  "cosmic",
];
export const SORT_MODES = ["rank", "suit"] as const;

export const MAX_RAW_NAME = 64;
export const MAX_UID = 32;
export const MAX_SESSION_ID = 64;
export const MAX_PASSCODE = 64;
export const MAX_PLAYER_ID = 32;

export function isDeckPreset(v: unknown): v is DeckPreset {
  return typeof v === "string" && (DECK_PRESETS as readonly string[]).includes(v);
}

export function isCardBackId(v: unknown): v is CardBackId {
  return typeof v === "string" && (CARD_BACK_IDS as readonly string[]).includes(v);
}

export type ParseResult =
  | { ok: true; msg: ClientMessage }
  | { ok: false; reason: string; seq?: number };

class Invalid extends Error {}

type Obj = Record<string, unknown>;

function fail(reason: string): never {
  throw new Invalid(reason);
}

function str(o: Obj, key: string, max: number, min = 1): string {
  const v = o[key];
  if (typeof v !== "string") fail(`${key} must be a string`);
  if (v.length < min) fail(`${key} is too short`);
  if (v.length > max) fail(`${key} is too long`);
  return v;
}

function optStr(o: Obj, key: string, max: number): string | undefined {
  return o[key] === undefined ? undefined : str(o, key, max, 0);
}

function num(o: Obj, key: string): number {
  const v = o[key];
  if (typeof v !== "number" || !Number.isFinite(v)) fail(`${key} must be a finite number`);
  return v;
}

function int(o: Obj, key: string): number {
  const v = num(o, key);
  if (!Number.isSafeInteger(v)) fail(`${key} must be an integer`);
  return v;
}

function optInt(o: Obj, key: string): number | undefined {
  return o[key] === undefined ? undefined : int(o, key);
}

function bool(o: Obj, key: string): boolean {
  const v = o[key];
  if (typeof v !== "boolean") fail(`${key} must be a boolean`);
  return v;
}

function optBool(o: Obj, key: string): boolean | undefined {
  return o[key] === undefined ? undefined : bool(o, key);
}

function isObj(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function readSeq(o: Obj): number | undefined {
  const v = o.seq;
  if (v === undefined) return undefined;
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 0) {
    fail("seq must be a non-negative integer");
  }
  return v;
}

function uid(o: Obj): string {
  return str(o, "uid", MAX_UID);
}

function settings(o: Obj): Partial<RoomSettings> {
  const s = o.settings;
  if (!isObj(s)) fail("settings must be an object");
  const out: Partial<RoomSettings> = {};
  if (s.cardBack !== undefined) {
    if (!isCardBackId(s.cardBack)) fail("Unknown cardBack");
    out.cardBack = s.cardBack;
  }
  const open = optBool(s, "openDeckControls");
  if (open !== undefined) out.openDeckControls = open;
  return out;
}

type DistOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type Body = DistOmit<ClientMessage, "seq">;

const BUILDERS: { [K in ClientMessageType]: (o: Obj) => Extract<Body, { type: K }> } = {
  JOIN: (o) => {
    const passcode = optStr(o, "passcode", MAX_PASSCODE);
    return {
      type: "JOIN",
      name: str(o, "name", MAX_RAW_NAME, 0),
      sessionId: str(o, "sessionId", MAX_SESSION_ID),
      ...(passcode !== undefined ? { passcode } : {}),
    };
  },
  LEAVE: () => ({ type: "LEAVE" }),
  SHUFFLE: () => ({ type: "SHUFFLE" }),
  RESET_DECK: (o) => {
    if (o.deckPreset === undefined) return { type: "RESET_DECK" };
    if (!isDeckPreset(o.deckPreset)) fail("Unknown deckPreset");
    return { type: "RESET_DECK", deckPreset: o.deckPreset };
  },
  DEAL: (o) => {
    const faceUp = optBool(o, "faceUp");
    return { type: "DEAL", count: int(o, "count"), ...(faceUp !== undefined ? { faceUp } : {}) };
  },
  DRAW_TO_TABLE: (o) => ({
    type: "DRAW_TO_TABLE",
    x: num(o, "x"),
    y: num(o, "y"),
    faceUp: bool(o, "faceUp"),
  }),
  COLLECT_STACK: (o) => ({
    type: "COLLECT_STACK",
    uid: uid(o),
    keepTop: bool(o, "keepTop"),
    shuffle: bool(o, "shuffle"),
  }),
  DRAW: (o) => {
    const count = optInt(o, "count");
    const faceUp = optBool(o, "faceUp");
    return {
      type: "DRAW",
      ...(count !== undefined ? { count } : {}),
      ...(faceUp !== undefined ? { faceUp } : {}),
    };
  },
  PLAY_CARD: (o) => {
    const faceUp = optBool(o, "faceUp");
    return {
      type: "PLAY_CARD",
      uid: uid(o),
      x: num(o, "x"),
      y: num(o, "y"),
      ...(faceUp !== undefined ? { faceUp } : {}),
    };
  },
  TAKE_CARD: (o) => ({ type: "TAKE_CARD", uid: uid(o) }),
  MOVE_CARD: (o) => ({ type: "MOVE_CARD", uid: uid(o), x: num(o, "x"), y: num(o, "y") }),
  FLIP_CARD: (o) => ({ type: "FLIP_CARD", uid: uid(o) }),
  FLIP_HAND_CARD: (o) => ({ type: "FLIP_HAND_CARD", uid: uid(o) }),
  TAKE_STACK: (o) => ({ type: "TAKE_STACK", uid: uid(o) }),
  MOVE_STACK: (o) => ({ type: "MOVE_STACK", uid: uid(o), x: num(o, "x"), y: num(o, "y") }),
  FLIP_STACK: (o) => ({ type: "FLIP_STACK", uid: uid(o) }),
  SORT_HAND: (o) => {
    const by = o.by;
    if (by !== "rank" && by !== "suit") fail("Unknown sort");
    return { type: "SORT_HAND", by };
  },
  UPDATE_SETTINGS: (o) => ({ type: "UPDATE_SETTINGS", settings: settings(o) }),
  TRANSFER_HOST: (o) => ({ type: "TRANSFER_HOST", playerId: str(o, "playerId", MAX_PLAYER_ID) }),
  KICK_PLAYER: (o) => ({ type: "KICK_PLAYER", playerId: str(o, "playerId", MAX_PLAYER_ID) }),
};

function byteLength(s: string): number {
  return new TextEncoder().encode(s).length;
}

export function parseClientMessage(raw: unknown): ParseResult {
  if (typeof raw !== "string") return { ok: false, reason: "Message must be text" };
  // Cheap pre-check (UTF-16 length ≤ UTF-8 bytes) before encoding.
  if (raw.length > MAX_MESSAGE_BYTES || byteLength(raw) > MAX_MESSAGE_BYTES) {
    return { ok: false, reason: "Message too large" };
  }
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "Invalid JSON" };
  }
  if (!isObj(data)) return { ok: false, reason: "Message must be an object" };

  let seq: number | undefined;
  try {
    seq = readSeq(data);
  } catch (e) {
    if (e instanceof Invalid) return { ok: false, reason: e.message };
    throw e;
  }

  const type = data.type;
  if (typeof type !== "string" || !Object.prototype.hasOwnProperty.call(BUILDERS, type)) {
    return { ok: false, reason: "Unknown message type", seq };
  }
  try {
    const body = BUILDERS[type as ClientMessageType](data);
    const msg = (seq !== undefined ? { ...body, seq } : body) as ClientMessage;
    return { ok: true, msg };
  } catch (e) {
    if (e instanceof Invalid) return { ok: false, reason: e.message, seq };
    throw e;
  }
}
