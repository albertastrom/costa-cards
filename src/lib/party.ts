import PartySocket from "partysocket";
import type { ClientMessage, ServerMessage } from "@/lib/types";

function getPartyHost(): string {
  return process.env.NEXT_PUBLIC_PARTYKIT_HOST ?? "127.0.0.1:1999";
}

export function createRoomSocket(roomCode: string): PartySocket {
  return new PartySocket({ host: getPartyHost(), room: roomCode.toUpperCase() });
}

export function sendClientMessage(socket: PartySocket, message: ClientMessage) {
  socket.send(JSON.stringify(message));
}

export function parseServerMessage(data: unknown): ServerMessage | null {
  if (typeof data !== "string") return null;
  try {
    const msg = JSON.parse(data) as ServerMessage;
    if (!msg || typeof msg !== "object" || typeof msg.type !== "string") return null;
    return msg;
  } catch {
    return null;
  }
}
