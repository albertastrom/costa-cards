import { snapToStack, stackOf } from "@/domain/table";
import { compareCards } from "@/domain/game";
import type {
  Card,
  CardView,
  ClientMessage,
  ClientSnapshot,
  TableCardView,
} from "@/lib/types";

export interface PendingOp {
  seq: number;
  msg: ClientMessage;
  sentAt: number;
}

export function sortCards<T extends CardView>(cards: readonly T[], by: "rank" | "suit"): T[] {
  return [...cards].sort((a, b) => compareCards(a as unknown as Card, b as unknown as Card, by));
}

const known = (c: CardView) => c.rank !== undefined && c.suit !== undefined;

function hidden<T extends CardView>(c: T): T {
  const copy = { ...c, faceUp: false };
  delete copy.rank;
  delete copy.suit;
  return copy;
}

function withHand(s: ClientSnapshot, myHand: CardView[]): ClientSnapshot {
  return {
    ...s,
    myHand,
    players: s.players.map((p) => (p.id === s.playerId ? { ...p, handCount: myHand.length } : p)),
  };
}

function toHandCard(c: TableCardView): CardView {
  const out: CardView = { uid: c.uid, faceUp: true };
  if (c.rank !== undefined) out.rank = c.rank;
  if (c.suit !== undefined) out.suit = c.suit;
  return out;
}

export function isPredictable(msg: ClientMessage): boolean {
  switch (msg.type) {
    case "PLAY_CARD":
    case "MOVE_CARD":
    case "TAKE_CARD":
    case "FLIP_CARD":
    case "FLIP_HAND_CARD":
    case "MOVE_STACK":
    case "TAKE_STACK":
    case "FLIP_STACK":
    case "SORT_HAND":
      return true;
    default:
      return false;
  }
}

export function applyOptimistic(s: ClientSnapshot, msg: ClientMessage): ClientSnapshot {
  switch (msg.type) {
    case "PLAY_CARD": {
      const card = s.myHand.find((c) => c.uid === msg.uid);
      if (!card) return s;
      const faceUp = msg.faceUp ?? true;
      const pos = snapToStack(s.table, msg.x, msg.y);
      const base: CardView = faceUp ? { ...card, faceUp: true } : hidden(card);
      const placed: TableCardView = { ...base, x: pos.x, y: pos.y, playedBy: s.playerId };
      return withHand(
        { ...s, table: [...s.table, placed] },
        s.myHand.filter((c) => c.uid !== msg.uid),
      );
    }
    case "MOVE_CARD": {
      const card = s.table.find((c) => c.uid === msg.uid);
      if (!card) return s;
      const pos = snapToStack(s.table, msg.x, msg.y, new Set([msg.uid]));
      return {
        ...s,
        table: [
          ...s.table.filter((c) => c.uid !== msg.uid),
          { ...card, x: pos.x, y: pos.y, playedBy: s.playerId },
        ],
      };
    }
    case "TAKE_CARD": {
      const card = s.table.find((c) => c.uid === msg.uid);
      if (!card || !known(card) || !card.faceUp) return s;
      return withHand(
        { ...s, table: s.table.filter((c) => c.uid !== msg.uid) },
        [...s.myHand, toHandCard(card)],
      );
    }
    case "FLIP_CARD": {
      const idx = s.table.findIndex((c) => c.uid === msg.uid);
      if (idx < 0 || !s.table[idx].faceUp) return s;
      const table = s.table.slice();
      table[idx] = hidden(table[idx]);
      return { ...s, table };
    }
    case "FLIP_HAND_CARD": {
      const idx = s.myHand.findIndex((c) => c.uid === msg.uid);
      if (idx < 0 || !s.myHand[idx].faceUp) return s;
      const myHand = s.myHand.slice();
      myHand[idx] = hidden(myHand[idx]);
      return { ...s, myHand };
    }
    case "MOVE_STACK": {
      const stack = stackOf(s.table, msg.uid);
      if (stack.length === 0) return s;
      const ids = new Set(stack.map((c) => c.uid));
      const pos = snapToStack(s.table, msg.x, msg.y, ids);
      return {
        ...s,
        table: [
          ...s.table.filter((c) => !ids.has(c.uid)),
          ...stack.map((c) => ({ ...c, x: pos.x, y: pos.y, playedBy: s.playerId })),
        ],
      };
    }
    case "TAKE_STACK": {
      const stack = stackOf(s.table, msg.uid);
      if (stack.length === 0 || !stack.every((c) => c.faceUp && known(c))) return s;
      const ids = new Set(stack.map((c) => c.uid));
      return withHand(
        { ...s, table: s.table.filter((c) => !ids.has(c.uid)) },
        [...s.myHand, ...stack.map(toHandCard)],
      );
    }
    case "FLIP_STACK": {
      const stack = stackOf(s.table, msg.uid);
      if (stack.length === 0 || !stack.every((c) => c.faceUp)) return s;
      const ids = new Set(stack.map((c) => c.uid));
      const flipped = stack
        .slice()
        .reverse()
        .map((c) => hidden(c));
      return {
        ...s,
        table: [
          ...s.table.filter((c) => !ids.has(c.uid)),
          ...flipped.map((c) => ({ ...c, playedBy: s.playerId })),
        ],
      };
    }
    case "SORT_HAND": {
      if (!s.myHand.every(known)) return s;
      return { ...s, myHand: sortCards(s.myHand, msg.by) };
    }
    default:
      return s;
  }
}

export function prunePending(pending: readonly PendingOp[], ackSeq: number): PendingOp[] {
  return pending.filter((p) => p.seq > ackSeq);
}

export function dropSeq(pending: readonly PendingOp[], seq: number): PendingOp[] {
  return pending.filter((p) => p.seq !== seq);
}

export function displayState(
  server: ClientSnapshot | null,
  pending: readonly PendingOp[],
): ClientSnapshot | null {
  if (!server) return null;
  return [...pending].sort((a, b) => a.seq - b.seq).reduce((s, p) => applyOptimistic(s, p.msg), server);
}
