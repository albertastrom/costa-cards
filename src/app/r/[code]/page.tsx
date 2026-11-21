"use client";

import { use, useState, useSyncExternalStore } from "react";
import { RoomView } from "@/components/RoomView";
import { NameGate } from "@/components/Screens";
import { getStoredName, normalizeRoomCode, setStoredName } from "@/lib/session";

const noopSubscribe = () => () => {};

export default function RoomPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const roomCode = normalizeRoomCode(code);
  const stored = useSyncExternalStore(noopSubscribe, getStoredName, () => null);
  const [chosen, setChosen] = useState<string | null>(null);

  if (stored === null) return <main className="flex-1" />;
  const name = chosen ?? (stored || null);
  if (!name) {
    return (
      <NameGate
        roomCode={roomCode}
        onSubmit={(n) => {
          setStoredName(n);
          setChosen(n);
        }}
      />
    );
  }
  return <RoomView roomCode={roomCode} name={name} />;
}
