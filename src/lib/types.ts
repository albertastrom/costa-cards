// Table x/y are normalized card centers; cards with identical x/y form a stack, top = last in table order.
export type Suit = "h" | "d" | "s" | "c";
export type Rank =
  | "A"
  | "2"
  | "3"
  | "4"
  | "5"
  | "6"
  | "7"
  | "8"
  | "9"
  | "10"
  | "J"
  | "Q"
  | "K";

export type CardRank = Rank | "Joker";
export type CardSuit = Suit | "joker";

export type CardUid = string;

export interface Card {
  uid: CardUid;
  rank: CardRank;
  suit: CardSuit;
  faceUp: boolean;
}

export interface TableCard extends Card {
  x: number;
  y: number;
  playedBy: string;
}

export interface Player {
  id: string;
  name: string;
  hand: Card[];
  isHost: boolean;
  sessionId: string;
  ghostUntil?: number;
  seat: number;
}

export type Phase = "lobby" | "playing";
export type DeckPreset = "standard52" | "jokers54" | "double104";
export type CardBackId =
  | "red"
  | "blue"
  | "gold"
  | "green"
  | "black"
  | "nebula"
  | "argyle"
  | "cosmic";

export interface RoomSettings {
  cardBack: CardBackId;
  openDeckControls: boolean;
}

export interface ActivityEntry {
  id: number;
  ts: number;
  text: string;
}

export interface RoomState {
  deck: Card[];
  table: TableCard[];
  players: Record<string, Player>;
  phase: Phase;
  deckPreset: DeckPreset;
  settings: RoomSettings;
  activity: ActivityEntry[];
  nextActivityId: number;
  nextSeat: number;
  updatedAt: number;
}

export interface CardView {
  uid: CardUid;
  faceUp: boolean;
  rank?: CardRank;
  suit?: CardSuit;
}

export interface TableCardView extends CardView {
  x: number;
  y: number;
  playedBy: string;
}

export interface PlayerPublic {
  id: string;
  name: string;
  handCount: number;
  isHost: boolean;
  connected: boolean;
  seat: number;
}

export interface ClientSnapshot {
  playerId: string;
  myHand: CardView[];
  table: TableCardView[];
  players: PlayerPublic[];
  deckCount: number;
  phase: Phase;
  roomCode: string;
  deckPreset: DeckPreset;
  settings: RoomSettings;
  activity: ActivityEntry[];
  ackSeq: number;
}

interface Seq {
  seq?: number;
}

export type ClientMessage = Seq &
  (
    | { type: "JOIN"; name: string; sessionId: string; passcode?: string }
    | { type: "LEAVE" }
    | { type: "SHUFFLE" }
    | { type: "RESET_DECK"; deckPreset?: DeckPreset }
    | { type: "DEAL"; count: number; faceUp?: boolean }
    | { type: "DRAW_TO_TABLE"; x: number; y: number; faceUp: boolean }
    | { type: "COLLECT_STACK"; uid: CardUid; keepTop: boolean; shuffle: boolean }
    | { type: "DRAW"; count?: number; faceUp?: boolean }
    | { type: "PLAY_CARD"; uid: CardUid; x: number; y: number; faceUp?: boolean }
    | { type: "TAKE_CARD"; uid: CardUid }
    | { type: "MOVE_CARD"; uid: CardUid; x: number; y: number }
    | { type: "FLIP_CARD"; uid: CardUid }
    | { type: "FLIP_HAND_CARD"; uid: CardUid }
    | { type: "TAKE_STACK"; uid: CardUid }
    | { type: "MOVE_STACK"; uid: CardUid; x: number; y: number }
    | { type: "FLIP_STACK"; uid: CardUid }
    | { type: "SORT_HAND"; by: "rank" | "suit" }
    | { type: "UPDATE_SETTINGS"; settings: Partial<RoomSettings> }
    | { type: "TRANSFER_HOST"; playerId: string }
    | { type: "KICK_PLAYER"; playerId: string }
  );

export type ClientMessageType = ClientMessage["type"];

export type ErrorCode =
  | "PASSCODE_REQUIRED"
  | "BAD_PASSCODE"
  | "ROOM_FULL"
  | "KICKED"
  | "INVALID_MESSAGE"
  | "NOT_JOINED";

export type ServerMessage =
  | { type: "SNAPSHOT"; snapshot: ClientSnapshot }
  | { type: "ERROR"; message: string; code?: ErrorCode }
  | { type: "REJECT"; reason: string; uid?: CardUid; seq?: number };

export const MAX_PLAYERS = 8;
export const MAX_NAME_LENGTH = 20;
export const MAX_MESSAGE_BYTES = 2048;
export const MAX_DEAL_COUNT = 26;
export const GHOST_TTL_MS = 15 * 60_000;
export const IDLE_ROOM_TTL_MS = 2 * 60 * 60_000;
export const STACK_SNAP_RADIUS = 0.045;
export const ACTIVITY_LIMIT = 8;
export const DEFAULT_SETTINGS: RoomSettings = {
  cardBack: "red",
  openDeckControls: false,
};
export const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const ROOM_CODE_LENGTH = 5;
