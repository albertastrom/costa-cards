"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type PartySocket from "partysocket";
import { createRoomSocket, parseServerMessage, sendClientMessage } from "@/lib/party";
import {
  clearSessionId,
  getOrCreateSessionId,
  getStoredPasscode,
  setStoredName,
  setStoredPasscode,
} from "@/lib/session";
import {
  displayState,
  dropSeq,
  isPredictable,
  prunePending,
  type PendingOp,
} from "@/lib/optimistic";
import { haptic, playSound } from "@/lib/sound";
import type { ClientMessage, ClientSnapshot, ServerMessage } from "@/lib/types";

export type ConnectionState = "connecting" | "open" | "reconnecting" | "closed";

export type RoomBlock =
  | { kind: "passcode"; bad: boolean }
  | { kind: "kicked" }
  | { kind: "full" }
  | { kind: "left" }
  | { kind: "elsewhere" };

export interface ToastMsg {
  id: number;
  text: string;
  tone: "info" | "error";
}

export type Action = Exclude<ClientMessage, { type: "JOIN" }>;

const TOAST_MS = 2600;
const PENDING_TTL_MS = 6000;

function soundFor(msg: Action) {
  switch (msg.type) {
    case "PLAY_CARD":
    case "MOVE_CARD":
    case "MOVE_STACK":
    case "TAKE_CARD":
    case "TAKE_STACK":
    case "DRAW_TO_TABLE":
      playSound("flick");
      haptic(8);
      break;
    case "FLIP_CARD":
    case "FLIP_STACK":
    case "FLIP_HAND_CARD":
      playSound("flip");
      haptic(6);
      break;
    case "SHUFFLE":
    case "DEAL":
    case "COLLECT_STACK":
    case "RESET_DECK":
      playSound("riffle");
      haptic([6, 30, 6]);
      break;
    case "DRAW":
      playSound("tick");
      haptic(6);
      break;
    default:
      break;
  }
}

export function useRoom(roomCode: string, playerName: string | null) {
  const [server, setServer] = useState<ClientSnapshot | null>(null);
  const [pending, setPending] = useState<PendingOp[]>([]);
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [block, setBlock] = useState<RoomBlock | null>(null);
  const [toast, setToast] = useState<ToastMsg | null>(null);

  const socketRef = useRef<PartySocket | null>(null);
  const seqRef = useRef(0);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastId = useRef(0);
  const lastLocalAction = useRef(0);
  const lastActivityId = useRef<number | null>(null);
  const blockRef = useRef<RoomBlock | null>(null);
  const joinRef = useRef<(() => void) | null>(null);

  const updateBlock = useCallback((b: RoomBlock | null) => {
    blockRef.current = b;
    setBlock(b);
  }, []);

  const showToast = useCallback((text: string, tone: ToastMsg["tone"] = "info") => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastId.current += 1;
    setToast({ id: toastId.current, text, tone });
    toastTimer.current = setTimeout(() => {
      toastTimer.current = null;
      setToast(null);
    }, TOAST_MS);
  }, []);

  const dismissToast = useCallback(() => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = null;
    setToast(null);
  }, []);

  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    [],
  );

  useEffect(() => {
    if (pending.length === 0) return;
    const oldest = Math.min(...pending.map((p) => p.sentAt));
    const wait = Math.max(50, oldest + PENDING_TTL_MS - Date.now());
    const t = setTimeout(() => {
      const now = Date.now();
      setPending((ps) => ps.filter((p) => now - p.sentAt < PENDING_TTL_MS));
    }, wait);
    return () => clearTimeout(t);
  }, [pending]);

  useEffect(() => {
    const name = playerName?.trim();
    if (!roomCode || !name) return;

    setStoredName(name);
    const socket = createRoomSocket(roomCode);
    socketRef.current = socket;

    // Tabs share the session id, so the last tab to join takes the seat instead of looping on reconnects.
    const tabId = Math.random().toString(36).slice(2);
    const channel =
      typeof BroadcastChannel === "function" ? new BroadcastChannel(`costa-cards:${roomCode}`) : null;
    if (channel) {
      channel.onmessage = (ev: MessageEvent) => {
        const data = ev.data as { claim?: string } | null;
        if (!data?.claim || data.claim === tabId || blockRef.current) return;
        updateBlock({ kind: "elsewhere" });
        socket.close();
        setConnection("closed");
      };
    }

    const join = () => {
      if (socket.readyState !== WebSocket.OPEN) return;
      const passcode = getStoredPasscode();
      // Read fresh each time: a kick clears it, and a rejoin should take a new seat.
      const sessionId = getOrCreateSessionId(roomCode);
      channel?.postMessage({ claim: tabId });
      sendClientMessage(socket, {
        type: "JOIN",
        name,
        sessionId,
        ...(passcode ? { passcode } : {}),
      });
    };
    joinRef.current = join;

    const onOpen = () => {
      // seq / ackSeq are per socket: predictions sent on a previous socket are void.
      seqRef.current = 0;
      setPending([]);
      setConnection("open");
      join();
    };

    const onClose = () => {
      const b = blockRef.current;
      setConnection(b && b.kind !== "passcode" ? "closed" : "reconnecting");
    };

    const handle = (msg: ServerMessage) => {
      switch (msg.type) {
        case "SNAPSHOT": {
          const snap = msg.snapshot;
          if (blockRef.current?.kind === "passcode") updateBlock(null);
          setServer(snap);
          setPending((ps) => prunePending(ps, snap.ackSeq));
          // Subtle cue for other players' actions.
          const newest = snap.activity.at(-1)?.id ?? null;
          if (
            lastActivityId.current !== null &&
            newest !== null &&
            newest !== lastActivityId.current &&
            Date.now() - lastLocalAction.current > 600
          ) {
            playSound("tick");
          }
          lastActivityId.current = newest;
          break;
        }
        case "REJECT": {
          if (typeof msg.seq === "number") {
            const seq = msg.seq;
            setPending((ps) => dropSeq(ps, seq));
          }
          showToast(msg.reason, "error");
          haptic([20, 40, 20]);
          break;
        }
        case "ERROR": {
          switch (msg.code) {
            case "PASSCODE_REQUIRED":
              updateBlock({ kind: "passcode", bad: false });
              break;
            case "BAD_PASSCODE":
              setStoredPasscode(null);
              updateBlock({ kind: "passcode", bad: true });
              break;
            case "KICKED":
              updateBlock({ kind: "kicked" });
              clearSessionId(roomCode);
              setServer(null);
              socket.close();
              setConnection("closed");
              break;
            case "ROOM_FULL":
              updateBlock({ kind: "full" });
              socket.close();
              setConnection("closed");
              break;
            case "NOT_JOINED":
              join();
              break;
            default:
              showToast(msg.message || "Something went wrong", "error");
          }
          break;
        }
      }
    };

    const onMessage = (ev: MessageEvent) => {
      const msg = parseServerMessage(ev.data);
      if (msg) handle(msg);
    };

    socket.addEventListener("open", onOpen);
    socket.addEventListener("close", onClose);
    socket.addEventListener("message", onMessage);
    if (socket.readyState === WebSocket.OPEN) onOpen();

    return () => {
      socket.removeEventListener("open", onOpen);
      socket.removeEventListener("close", onClose);
      socket.removeEventListener("message", onMessage);
      channel?.close();
      socket.close();
      socketRef.current = null;
      joinRef.current = null;
    };
  }, [roomCode, playerName, showToast, updateBlock]);

  const act = useCallback(
    (msg: Action) => {
      const s = socketRef.current;
      if (!s || s.readyState !== WebSocket.OPEN) {
        showToast("Offline — reconnecting…", "error");
        return;
      }
      seqRef.current += 1;
      const seq = seqRef.current;
      sendClientMessage(s, { ...msg, seq } as ClientMessage);
      lastLocalAction.current = Date.now();
      soundFor(msg);
      if (isPredictable(msg)) {
        setPending((ps) => [...ps, { seq, msg, sentAt: Date.now() }]);
      }
    },
    [showToast],
  );

  const submitPasscode = useCallback(
    (code: string) => {
      setStoredPasscode(code);
      updateBlock(null);
      const s = socketRef.current;
      if (s && s.readyState === WebSocket.OPEN) joinRef.current?.();
      else s?.reconnect();
    },
    [updateBlock],
  );

  const retry = useCallback(() => {
    updateBlock(null);
    setConnection("connecting");
    socketRef.current?.reconnect();
  }, [updateBlock]);

  const leave = useCallback(() => {
    const s = socketRef.current;
    if (s && s.readyState === WebSocket.OPEN) sendClientMessage(s, { type: "LEAVE" });
    clearSessionId(roomCode);
    updateBlock({ kind: "left" });
    s?.close();
    setConnection("closed");
  }, [roomCode, updateBlock]);

  const state = useMemo(() => displayState(server, pending), [server, pending]);

  return { state, connection, block, toast, act, showToast, dismissToast, submitPasscode, retry, leave };
}
