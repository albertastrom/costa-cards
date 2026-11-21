import type { CardBackId, CardRank, CardSuit, Rank, Suit } from "../lib/types";

const NATIVE_W = 69;
const NATIVE_H = 93;
const COL_STEP = 71;
const ROW_STEP = 95;

export const FACES_URL = "/cards/balatro_card_design.png";
export const BACKINGS_URL = "/cards/balatro_backings.png";
export const FACES_SHEET = { w: 923, h: 380 } as const;
export const BACKINGS_SHEET = { w: 497, h: 475 } as const;

export interface SpriteRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function cell(col: number, row: number): SpriteRect {
  return { x: col * COL_STEP, y: row * ROW_STEP, w: NATIVE_W, h: NATIVE_H };
}

const FACE_RANK_COLUMNS: readonly Rank[] = [
  "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A",
];

const FACE_SUIT_ROWS: Readonly<Record<Suit, number>> = { h: 0, c: 1, d: 2, s: 3 };

export const FACE_BASE_RECT = cell(1, 0);
export const JOKER_MARK_RECT = cell(5, 3);

const CARD_BACK_CELLS: Readonly<Record<CardBackId, readonly [number, number]>> = {
  red: [0, 0],
  nebula: [3, 0],
  blue: [0, 2],
  gold: [1, 2],
  green: [2, 2],
  black: [3, 2],
  argyle: [1, 3],
  cosmic: [3, 4],
};

export const CARD_BACKS: readonly { id: CardBackId; label: string }[] = [
  { id: "red", label: "Classic red" },
  { id: "blue", label: "Blue" },
  { id: "green", label: "Green" },
  { id: "gold", label: "Gold" },
  { id: "black", label: "Black" },
  { id: "argyle", label: "Argyle" },
  { id: "nebula", label: "Nebula" },
  { id: "cosmic", label: "Cosmic" },
];

export function backRect(back: CardBackId): SpriteRect {
  const [col, row] = CARD_BACK_CELLS[back] ?? CARD_BACK_CELLS.red;
  return cell(col, row);
}

export function isJoker(rank: CardRank | undefined, suit: CardSuit | undefined): boolean {
  return rank === "Joker" || suit === "joker";
}

export function faceRect(rank: CardRank, suit: CardSuit): SpriteRect | null {
  if (isJoker(rank, suit)) return null;
  const col = FACE_RANK_COLUMNS.indexOf(rank as Rank);
  const row = FACE_SUIT_ROWS[suit as Suit];
  if (col < 0 || row === undefined) return null;
  return cell(col, row);
}

export function displaySize(scale: number): { w: number; h: number } {
  return { w: Math.round(NATIVE_W * scale), h: Math.round(NATIVE_H * scale) };
}

const SUIT_NAMES: Record<CardSuit, string> = {
  h: "hearts",
  d: "diamonds",
  s: "spades",
  c: "clubs",
  joker: "joker",
};

export function spokenCardName(rank?: CardRank, suit?: CardSuit): string {
  if (!rank || !suit) return "Face-down card";
  if (isJoker(rank, suit)) return "Joker";
  return `${rank} of ${SUIT_NAMES[suit]}`;
}
