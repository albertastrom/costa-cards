import { describe, expect, it } from "vitest";
import { parseClientMessage } from "./protocol";
import { MAX_MESSAGE_BYTES } from "./types";

function ok(payload: unknown) {
  const r = parseClientMessage(JSON.stringify(payload));
  if (!r.ok) throw new Error(`expected ok: ${r.reason}`);
  return r.msg;
}

function bad(raw: unknown): string {
  const r = parseClientMessage(typeof raw === "string" ? raw : JSON.stringify(raw));
  if (r.ok) throw new Error(`expected failure for ${String(raw)}`);
  return r.reason;
}

describe("parseClientMessage: envelope", () => {
  it("rejects non-strings, invalid JSON, non-objects", () => {
    expect(parseClientMessage(42).ok).toBe(false);
    expect(bad("{nope")).toBe("Invalid JSON");
    expect(bad("[]")).toMatch(/object/);
    expect(bad("null")).toMatch(/object/);
    expect(bad('"JOIN"')).toMatch(/object/);
  });

  it("rejects oversized frames (bytes, not chars)", () => {
    expect(bad(JSON.stringify({ type: "SHUFFLE", pad: "x".repeat(MAX_MESSAGE_BYTES) }))).toMatch(/large/);
    const multibyte = JSON.stringify({ type: "SHUFFLE", pad: "é".repeat(MAX_MESSAGE_BYTES / 2) });
    expect(multibyte.length).toBeLessThan(MAX_MESSAGE_BYTES + 30);
    expect(bad(multibyte)).toMatch(/large/);
  });

  it("rejects unknown and prototype-ish types", () => {
    expect(bad({ type: "HACK" })).toMatch(/Unknown/);
    expect(bad({ type: "toString" })).toMatch(/Unknown/);
    expect(bad({ type: "__proto__" })).toMatch(/Unknown/);
    expect(bad({})).toMatch(/Unknown/);
  });

  it("validates seq and keeps it", () => {
    expect(ok({ type: "SHUFFLE", seq: 0 })).toEqual({ type: "SHUFFLE", seq: 0 });
    expect(ok({ type: "SHUFFLE", seq: 12 })).toEqual({ type: "SHUFFLE", seq: 12 });
    expect(bad({ type: "SHUFFLE", seq: -1 })).toMatch(/seq/);
    expect(bad({ type: "SHUFFLE", seq: 1.5 })).toMatch(/seq/);
    expect(bad({ type: "SHUFFLE", seq: "3" })).toMatch(/seq/);
    expect(bad({ type: "SHUFFLE", seq: 2 ** 60 })).toMatch(/seq/);
  });

  it("recovers seq on field-level failures so the server can ack", () => {
    const r = parseClientMessage(JSON.stringify({ type: "DEAL", count: "x", seq: 9 }));
    expect(r).toMatchObject({ ok: false, seq: 9 });
  });

  it("strips unknown fields", () => {
    expect(ok({ type: "TAKE_CARD", uid: "c_1", evil: true, __proto__x: 1 })).toEqual({
      type: "TAKE_CARD",
      uid: "c_1",
    });
    const m = ok({ type: "UPDATE_SETTINGS", settings: { cardBack: "gold", admin: true } });
    expect(m).toEqual({ type: "UPDATE_SETTINGS", settings: { cardBack: "gold" } });
  });
});

describe("parseClientMessage: JOIN", () => {
  it("accepts valid joins with and without passcode", () => {
    expect(ok({ type: "JOIN", name: "Ana", sessionId: "s1" })).toEqual({
      type: "JOIN",
      name: "Ana",
      sessionId: "s1",
    });
    expect(ok({ type: "JOIN", name: "Ana", sessionId: "s1", passcode: "pw" })).toMatchObject({ passcode: "pw" });
  });

  it("rejects attack payloads", () => {
    expect(bad({ type: "JOIN", name: 123, sessionId: "s" })).toMatch(/name/);
    expect(bad({ type: "JOIN", name: { a: 1 }, sessionId: "s" })).toMatch(/name/);
    expect(bad({ type: "JOIN", name: "a".repeat(65), sessionId: "s" })).toMatch(/name/);
    expect(bad({ type: "JOIN", name: "A" })).toMatch(/sessionId/);
    expect(bad({ type: "JOIN", name: "A", sessionId: "" })).toMatch(/sessionId/);
    expect(bad({ type: "JOIN", name: "A", sessionId: "s".repeat(65) })).toMatch(/sessionId/);
    expect(bad({ type: "JOIN", name: "A", sessionId: "s", passcode: 1234 })).toMatch(/passcode/);
    expect(bad({ type: "JOIN", name: "A", sessionId: "s", passcode: "p".repeat(65) })).toMatch(/passcode/);
  });
});

describe("parseClientMessage: numbers", () => {
  it("rejects NaN / Infinity coordinates (sent as raw tokens or via null)", () => {
    expect(bad('{"type":"PLAY_CARD","uid":"c_1","x":NaN,"y":0.5}')).toBe("Invalid JSON");
    expect(bad({ type: "PLAY_CARD", uid: "c_1", x: NaN, y: 0.5 })).toMatch(/x/); // JSON → null
    expect(bad('{"type":"PLAY_CARD","uid":"c_1","x":1e999,"y":0.5}')).toMatch(/x/); // → Infinity
    expect(bad({ type: "MOVE_STACK", uid: "c_1", x: "0.5", y: 0.5 })).toMatch(/x/);
  });

  it("rejects NaN / non-integer counts", () => {
    expect(bad({ type: "DEAL", count: NaN })).toMatch(/count/);
    expect(bad({ type: "DEAL", count: 2.5 })).toMatch(/count/);
    expect(bad({ type: "DEAL" })).toMatch(/count/);
    expect(bad({ type: "DRAW", count: 1.1 })).toMatch(/count/);
    expect(ok({ type: "DEAL", count: 3 })).toEqual({ type: "DEAL", count: 3 });
    expect(ok({ type: "DRAW" })).toEqual({ type: "DRAW" });
  });
});

describe("parseClientMessage: every type", () => {
  it.each([
    { type: "LEAVE" },
    { type: "SHUFFLE" },
    { type: "RESET_DECK" },
    { type: "RESET_DECK", deckPreset: "double104" },
    { type: "DEAL", count: 5, faceUp: false },
    { type: "DRAW_TO_TABLE", x: 0.1, y: 0.9, faceUp: true },
    { type: "COLLECT_STACK", uid: "c_abc", keepTop: true, shuffle: false },
    { type: "DRAW", count: 2, faceUp: false },
    { type: "PLAY_CARD", uid: "c_abc", x: 0.5, y: 0.5 },
    { type: "PLAY_CARD", uid: "c_abc", x: 0.5, y: 0.5, faceUp: false },
    { type: "TAKE_CARD", uid: "c_abc" },
    { type: "MOVE_CARD", uid: "c_abc", x: 0, y: 1 },
    { type: "FLIP_CARD", uid: "c_abc" },
    { type: "FLIP_HAND_CARD", uid: "c_abc" },
    { type: "TAKE_STACK", uid: "c_abc" },
    { type: "MOVE_STACK", uid: "c_abc", x: 0.3, y: 0.3 },
    { type: "FLIP_STACK", uid: "c_abc" },
    { type: "SORT_HAND", by: "suit" },
    { type: "UPDATE_SETTINGS", settings: { cardBack: "cosmic", openDeckControls: true } },
    { type: "TRANSFER_HOST", playerId: "p_1" },
    { type: "KICK_PLAYER", playerId: "p_1" },
  ])("accepts $type", (msg) => {
    expect(ok({ ...msg, seq: 1 })).toEqual({ ...msg, seq: 1 });
  });

  it.each([
    [{ type: "RESET_DECK", deckPreset: "tarot" }, /deckPreset/],
    [{ type: "DRAW_TO_TABLE", x: 0.1, y: 0.9 }, /faceUp/],
    [{ type: "COLLECT_STACK", uid: "c", keepTop: "yes", shuffle: false }, /keepTop/],
    [{ type: "PLAY_CARD", uid: "c".repeat(33), x: 0, y: 0 }, /uid/],
    [{ type: "PLAY_CARD", uid: "", x: 0, y: 0 }, /uid/],
    [{ type: "TAKE_CARD", uid: 5 }, /uid/],
    [{ type: "SORT_HAND", by: "color" }, /sort/],
    [{ type: "UPDATE_SETTINGS", settings: { cardBack: "plaid" } }, /cardBack/],
    [{ type: "UPDATE_SETTINGS", settings: { openDeckControls: 1 } }, /openDeckControls/],
    [{ type: "UPDATE_SETTINGS", settings: null }, /settings/],
    [{ type: "UPDATE_SETTINGS" }, /settings/],
    [{ type: "TRANSFER_HOST", playerId: "p".repeat(33) }, /playerId/],
    [{ type: "KICK_PLAYER" }, /playerId/],
    [{ type: "DEAL", count: 1, faceUp: "true" }, /faceUp/],
  ])("rejects %j", (msg, reason) => {
    expect(bad(msg)).toMatch(reason);
  });
});
