import type * as Party from "partykit/server";
import {
  applyAction,
  buildSnapshot,
  createEmptyRoom,
  expireGhosts,
  joinPlayer,
  markGhost,
  nextGhostExpiry,
  removePlayer,
  restoreState,
} from "../src/domain/game";
import { parseClientMessage } from "../src/lib/protocol";
import type { ClientMessage, ErrorCode, RoomState, ServerMessage } from "../src/lib/types";
import { GHOST_TTL_MS, IDLE_ROOM_TTL_MS } from "../src/lib/types";

const STORAGE_KEY = "room";
const ROOM_CODE_KEY = "roomCode";

function safeEqual(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

export default class CostaRoom implements Party.Server {
  state: RoomState = createEmptyRoom();
  private connToPlayer = new Map<string, string>();
  private playerToConn = new Map<string, string>();
  private lastSeq = new Map<string, number>();
  // onAlarm cannot read room.id, so the code is cached in storage.
  private roomCode = "";

  constructor(readonly room: Party.Room) {}

  async onStart() {
    let id: string | undefined;
    try {
      id = this.room.id;
    } catch {
    }
    this.roomCode = id || ((await this.room.storage.get<string>(ROOM_CODE_KEY)) ?? "");
    const now = Date.now();
    const stored = await this.room.storage.get(STORAGE_KEY);
    const restored = stored === undefined ? null : restoreState(stored, now);
    this.state = restored ? expireGhosts(restored, now) : createEmptyRoom({ now });
    await this.scheduleAlarm();
  }

  onConnect(conn: Party.Connection) {
    if (!this.roomCode) {
      this.roomCode = this.room.id;
      void this.room.storage.put(ROOM_CODE_KEY, this.roomCode);
    }
    this.lastSeq.set(conn.id, 0);
  }

  onClose(conn: Party.Connection) {
    this.disconnect(conn.id);
  }

  onError(conn: Party.Connection) {
    this.disconnect(conn.id);
  }

  async onAlarm() {
    const now = Date.now();
    const expired = expireGhosts(this.state, now);
    if (expired !== this.state) {
      this.state = expired;
      this.broadcastSnapshots();
      await this.persist();
    }
    if (this.isIdle(now)) {
      await this.room.storage.deleteAll();
      this.state = createEmptyRoom({ now });
      return;
    }
    await this.scheduleAlarm();
  }

  onMessage(raw: string | ArrayBuffer | ArrayBufferView, sender: Party.Connection) {
    const parsed = parseClientMessage(typeof raw === "string" ? raw : null);
    if (!parsed.ok) {
      this.ack(sender.id, parsed.seq);
      this.sendError(sender, `Invalid message: ${parsed.reason}`, "INVALID_MESSAGE");
      if (this.connToPlayer.has(sender.id)) this.sendSnapshot(sender);
      return;
    }
    const msg = parsed.msg;
    this.ack(sender.id, msg.seq);

    const now = Date.now();
    const expired = expireGhosts(this.state, now);
    if (expired !== this.state) this.commit(expired);

    if (msg.type === "JOIN") {
      this.handleJoin(sender, msg, now);
      return;
    }

    const playerId = this.connToPlayer.get(sender.id);
    if (!playerId || !this.state.players[playerId]) {
      this.sendError(sender, "Join the room first", "NOT_JOINED");
      return;
    }

    if (msg.type === "LEAVE") {
      this.unbind(sender.id);
      this.commit(removePlayer(this.state, playerId, { now }));
      this.closeQuietly(sender);
      return;
    }

    const result = applyAction(this.state, playerId, msg, { now });
    if (!result.ok) {
      this.send(sender, {
        type: "REJECT",
        reason: result.reason,
        ...(result.uid ? { uid: result.uid } : {}),
        ...(msg.seq !== undefined ? { seq: msg.seq } : {}),
      });
      this.sendSnapshot(sender);
      return;
    }

    if (msg.type === "KICK_PLAYER") {
      const kickedConnId = this.playerToConn.get(msg.playerId);
      if (kickedConnId) {
        const kicked = this.room.getConnection(kickedConnId);
        this.unbind(kickedConnId);
        if (kicked) {
          this.sendError(kicked, "You were removed from the room", "KICKED");
          this.closeQuietly(kicked);
        }
      }
    }
    this.commit(result.state);
  }

  private handleJoin(
    conn: Party.Connection,
    msg: Extract<ClientMessage, { type: "JOIN" }>,
    now: number,
  ) {
    const required = this.room.env.ROOM_PASSCODE;
    if (typeof required === "string" && required.length > 0) {
      if (msg.passcode === undefined || msg.passcode === "") {
        this.sendError(conn, "This room needs a passcode", "PASSCODE_REQUIRED");
        return;
      }
      if (!safeEqual(msg.passcode, required)) {
        this.sendError(conn, "Wrong passcode", "BAD_PASSCODE");
        return;
      }
    }

    const result = joinPlayer(this.state, msg.sessionId, msg.name, { now });
    if (!result.ok) {
      this.sendError(conn, result.reason, result.code);
      return;
    }
    let next = result.state;
    const { playerId } = result;

    // This socket was bound to a different player (re-JOIN with another session): ghost that one.
    const previous = this.connToPlayer.get(conn.id);
    if (previous && previous !== playerId) {
      this.unbind(conn.id);
      next = markGhost(next, previous, now + GHOST_TTL_MS, { now });
    }

    // Stale socket replacement: the session was bound to another live connection.
    const staleConnId = this.playerToConn.get(playerId);
    if (staleConnId && staleConnId !== conn.id) {
      this.unbind(staleConnId);
      const stale = this.room.getConnection(staleConnId);
      if (stale) this.closeQuietly(stale);
    }

    this.connToPlayer.set(conn.id, playerId);
    this.playerToConn.set(playerId, conn.id);
    this.commit(next);
  }

  // ---------------------------------------------------------------- helpers

  private disconnect(connId: string) {
    const playerId = this.connToPlayer.get(connId);
    const isCurrent = playerId !== undefined && this.playerToConn.get(playerId) === connId;
    this.unbind(connId);
    this.lastSeq.delete(connId);
    if (!isCurrent || !this.state.players[playerId]) return;
    const now = Date.now();
    this.commit(markGhost(this.state, playerId, now + GHOST_TTL_MS, { now }));
  }

  private unbind(connId: string) {
    const playerId = this.connToPlayer.get(connId);
    this.connToPlayer.delete(connId);
    if (playerId !== undefined && this.playerToConn.get(playerId) === connId) {
      this.playerToConn.delete(playerId);
    }
  }

  private ack(connId: string, seq: number | undefined) {
    if (seq === undefined) return;
    this.lastSeq.set(connId, Math.max(this.lastSeq.get(connId) ?? 0, seq));
  }

  /** Adopt a new state: broadcast, persist, re-arm the alarm. */
  private commit(next: RoomState) {
    this.state = next;
    this.broadcastSnapshots();
    void this.persist()
      .then(() => this.scheduleAlarm())
      .catch((err) => console.error("persist failed", err));
  }

  private async persist() {
    await this.room.storage.put(STORAGE_KEY, this.state);
  }

  private hasConnectedPlayers(): boolean {
    return this.playerToConn.size > 0;
  }

  private isIdle(now: number): boolean {
    return !this.hasConnectedPlayers() && now - this.state.updatedAt >= IDLE_ROOM_TTL_MS;
  }

  private async scheduleAlarm() {
    const candidates: number[] = [];
    const ghost = nextGhostExpiry(this.state);
    if (ghost !== undefined) candidates.push(ghost);
    if (!this.hasConnectedPlayers()) candidates.push(this.state.updatedAt + IDLE_ROOM_TTL_MS);
    if (candidates.length === 0) {
      await this.room.storage.deleteAlarm();
      return;
    }
    await this.room.storage.setAlarm(Math.max(Date.now(), Math.min(...candidates)));
  }

  private send(conn: Party.Connection, msg: ServerMessage) {
    try {
      conn.send(JSON.stringify(msg));
    } catch {
      /* socket already gone */
    }
  }

  private sendError(conn: Party.Connection, message: string, code?: ErrorCode) {
    this.send(conn, { type: "ERROR", message, ...(code ? { code } : {}) });
  }

  private closeQuietly(conn: Party.Connection) {
    try {
      conn.close();
    } catch {
      /* ignore */
    }
  }

  private sendSnapshot(conn: Party.Connection) {
    const playerId = this.connToPlayer.get(conn.id);
    if (!playerId || !this.state.players[playerId]) return;
    const snapshot = buildSnapshot(
      this.state,
      playerId,
      this.roomCode,
      this.lastSeq.get(conn.id) ?? 0,
    );
    this.send(conn, { type: "SNAPSHOT", snapshot });
  }

  private broadcastSnapshots() {
    for (const [connId] of this.connToPlayer) {
      const conn = this.room.getConnection(connId);
      if (conn) this.sendSnapshot(conn);
    }
  }
}

CostaRoom satisfies Party.Worker;
