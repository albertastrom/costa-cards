import { MAX_NAME_LENGTH, ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from "@/lib/types";

const NAME_KEY = "costa-cards:name";
const PASSCODE_KEY = "costa-cards:passcode";
const MUTE_KEY = "costa-cards:muted";
const SHIELD_KEY = "costa-cards:shield";
const FACEDOWN_KEY = "costa-cards:play-face-down";

function sessionKey(roomCode: string) {
  return `costa-cards:session:${roomCode.toUpperCase()}`;
}

function read(key: string): string | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    /* storage unavailable */
  }
}

export function getStoredName(): string {
  return read(NAME_KEY) ?? "";
}

export function setStoredName(name: string) {
  write(NAME_KEY, name.trim().slice(0, MAX_NAME_LENGTH));
}

export function getStoredPasscode(): string {
  return read(PASSCODE_KEY) ?? "";
}

export function setStoredPasscode(code: string | null) {
  write(PASSCODE_KEY, code && code.trim() ? code.trim() : null);
}

export function getBoolPref(key: "muted" | "shield" | "faceDown"): boolean {
  const k = key === "muted" ? MUTE_KEY : key === "shield" ? SHIELD_KEY : FACEDOWN_KEY;
  return read(k) === "1";
}

export function setBoolPref(key: "muted" | "shield" | "faceDown", value: boolean) {
  const k = key === "muted" ? MUTE_KEY : key === "shield" ? SHIELD_KEY : FACEDOWN_KEY;
  write(k, value ? "1" : null);
}

function randomId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/** Private per-room reconnect token. */
export function getOrCreateSessionId(roomCode: string): string {
  const key = sessionKey(roomCode);
  let id = read(key);
  if (!id) {
    id = randomId();
    write(key, id);
  }
  return id;
}

export function clearSessionId(roomCode: string) {
  write(sessionKey(roomCode), null);
}

export function generateRoomCode(): string {
  const bytes = new Uint8Array(ROOM_CODE_LENGTH);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < ROOM_CODE_LENGTH; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  let code = "";
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    code += ROOM_CODE_ALPHABET[bytes[i] % ROOM_CODE_ALPHABET.length];
  }
  return code;
}

export function normalizeRoomCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
}
