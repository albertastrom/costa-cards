"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { displaySize } from "@/domain/sprites";
import { snapToStack, stackOf } from "@/domain/table";
import type { CardBackId, ClientSnapshot } from "@/lib/types";
import { unlockAudio } from "@/lib/sound";
import { useRoom, type Action } from "@/hooks/useRoom";
import { useElementSize } from "@/hooks/useElementSize";
import { useWakeLock } from "@/hooks/useWakeLock";
import { useLocalPref } from "@/hooks/useLocalPref";
import {
  DragStore,
  clientToFelt,
  useDragEngine,
  type DragSource,
  type DropTarget,
} from "@/hooks/useDragEngine";
import { TableFelt } from "./Table";
import { HandFan } from "./Hand";
import { TopRail } from "./TopRail";
import { ActivityTicker } from "./ActivityTicker";
import { DragGhost } from "./DragGhost";
import { DeckSheet, StackSheet } from "./ActionSheets";
import { RoomSheet } from "./RoomSheet";
import { InviteSheet } from "./InviteSheet";
import { Toast } from "./Toast";
import { BlockScreen } from "./Screens";
import { CardFace } from "./Card";

type Anchor = { x: number; y: number };

const quantize = (n: number) => Math.round(n * 20) / 20;

export function RoomView({ roomCode, name }: { roomCode: string; name: string }) {
  const router = useRouter();
  const room = useRoom(roomCode, name);
  const { state, connection, block, act } = room;

  useWakeLock(!!state && !block);

  if (block) {
    return (
      <BlockScreen
        block={block}
        roomCode={roomCode}
        onPasscode={room.submitPasscode}
        onRetry={room.retry}
        onHome={() => router.push("/")}
      />
    );
  }

  if (!state) {
    return (
      <main className="grid flex-1 place-items-center text-sm text-muted">
        <div className="flex flex-col items-center gap-3">
          <div className="loading-cards" aria-hidden>
            <CardFace card={{ faceUp: false }} back="red" w={46} h={62} />
          </div>
          {connection === "reconnecting" ? "Reconnecting…" : `Joining ${roomCode}…`}
        </div>
      </main>
    );
  }

  return (
    <Board
      state={state}
      act={act}
      connection={connection}
      toast={room.toast}
      dismissToast={room.dismissToast}
      showToast={room.showToast}
      onLeave={() => {
        room.leave();
        router.push("/");
      }}
    />
  );
}

function Board({
  state,
  act,
  connection,
  toast,
  dismissToast,
  showToast,
  onLeave,
}: {
  state: ClientSnapshot;
  act: (a: Action) => void;
  connection: ReturnType<typeof useRoom>["connection"];
  toast: ReturnType<typeof useRoom>["toast"];
  dismissToast: () => void;
  showToast: (t: string, tone?: "info" | "error") => void;
  onLeave: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const feltRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const handRef = useRef<HTMLDivElement>(null);
  const [store] = useState(() => new DragStore());

  const [muted, setMuted] = useLocalPref("muted");
  const [shield, setShield] = useLocalPref("shield");
  const [faceDown, setFaceDown] = useLocalPref("faceDown");
  const [peeking, setPeeking] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [stackAnchor, setStackAnchor] = useState<Anchor | null>(null);
  const [movingAnchor, setMovingAnchor] = useState<Anchor | null>(null);
  const [sheet, setSheet] = useState<null | "room" | "deck" | "invite">(null);

  const me = state.players.find((p) => p.id === state.playerId);
  const isHost = !!me?.isHost;
  const canDeck = isHost || state.settings.openDeckControls;
  const back: CardBackId = state.settings.cardBack;
  const concealed = shield && !peeking;

  // Card sizes follow the live felt / viewport size (no one-shot window reads).
  const felt = useElementSize(feltRef);
  const rootSize = useElementSize(rootRef);
  const tableScale = felt.width
    ? Math.max(0.55, Math.min(1.25, quantize(Math.min(felt.width / 6.2, felt.height / 6.4) / 69)))
    : 0.8;
  const handScale = rootSize.width ? Math.max(0.8, Math.min(1.2, quantize(rootSize.width / 400))) : 0.9;
  const tableCard = displaySize(tableScale);
  const handCard = displaySize(handScale);
  const insetX = Math.round(tableCard.w / 2 + 6);
  const insetY = Math.round(tableCard.h / 2 + 6);
  const contentW = Math.max(1, felt.width - insetX * 2);
  const contentH = Math.max(1, felt.height - insetY * 2);

  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  });

  // Drop a selection that no longer exists (played, reissued uid...).
  const selectedExists = !!selected && state.myHand.some((c) => c.uid === selected);
  const selectedUid = selectedExists ? selected : null;

  const stack = useMemo(() => {
    if (!stackAnchor) return null;
    const s = state.table.filter((c) => c.x === stackAnchor.x && c.y === stackAnchor.y);
    return s.length ? s : null;
  }, [state.table, stackAnchor]);

  const movingStackTop = useMemo(() => {
    if (!movingAnchor) return null;
    const s = state.table.filter((c) => c.x === movingAnchor.x && c.y === movingAnchor.y);
    return s.length ? s[s.length - 1].uid : null;
  }, [state.table, movingAnchor]);

  const deny = useCallback(() => showToast("Only the host can do that right now", "error"), [showToast]);

  const playFromHand = useCallback(
    (uid: string, x: number, y: number, down = faceDown) => {
      act({ type: "PLAY_CARD", uid, x, y, faceUp: !down });
      setSelected(null);
    },
    [act, faceDown],
  );

  const onDrop = useCallback(
    (source: DragSource, target: DropTarget) => {
      if (source.kind === "hand") {
        if (target.kind === "table") playFromHand(source.uid, target.x, target.y);
        return;
      }
      if (source.kind === "table") {
        const whole = source.whole;
        if (target.kind === "hand") {
          act(whole ? { type: "TAKE_STACK", uid: source.uid } : { type: "TAKE_CARD", uid: source.uid });
        } else {
          act(
            whole
              ? { type: "MOVE_STACK", uid: source.uid, x: target.x, y: target.y }
              : { type: "MOVE_CARD", uid: source.uid, x: target.x, y: target.y },
          );
        }
        if (whole) setMovingAnchor(null);
        return;
      }
      // deck
      if (stateRef.current.deckCount === 0) return showToast("The deck is empty");
      if (target.kind === "hand") act({ type: "DRAW", count: 1 });
      else if (canDeck) act({ type: "DRAW_TO_TABLE", x: target.x, y: target.y, faceUp: !faceDown });
      else deny();
    },
    [act, canDeck, deny, faceDown, playFromHand, showToast],
  );

  const onTap = useCallback(
    (source: DragSource) => {
      if (source.kind === "hand") {
        setSelected((s) => (s === source.uid ? null : source.uid));
      } else if (source.kind === "table") {
        const c = stateRef.current.table.find((t) => t.uid === source.uid);
        if (c) setStackAnchor({ x: c.x, y: c.y });
      } else if (stateRef.current.deckCount > 0) {
        act({ type: "DRAW", count: 1 });
      } else {
        showToast("The deck is empty");
      }
    },
    [act, showToast],
  );

  const onLongPress = useCallback((source: DragSource) => {
    if (source.kind === "table") {
      const c = stateRef.current.table.find((t) => t.uid === source.uid);
      if (c) setStackAnchor({ x: c.x, y: c.y });
    } else if (source.kind === "deck") {
      setSheet("deck");
    }
  }, []);

  const startEngine = useDragEngine({
    store,
    rootRef,
    feltRef: contentRef,
    handRef,
    getState: () => stateRef.current,
    tableCardH: tableCard.h,
    onDrop,
    onTap,
    onLongPress,
    onPeek: setPeeking,
  });
  // In "move pile" mode, grabbing that pile's top card drags the whole pile.
  const startDrag = useCallback(
    (e: React.PointerEvent<HTMLElement>, source: DragSource) =>
      startEngine(
        e,
        source.kind === "table" && source.uid === movingStackTop ? { ...source, whole: true } : source,
      ),
    [movingStackTop, startEngine],
  );

  const onFeltTap = useCallback(
    (cx: number, cy: number) => {
      setSelected(null);
      const el = contentRef.current;
      if (!movingAnchor || !el || !movingStackTop) return;
      const p = clientToFelt(el, cx, cy);
      const ids = new Set(stackOf(stateRef.current.table, movingStackTop).map((c) => c.uid));
      const snap = snapToStack(stateRef.current.table, p.x, p.y, ids);
      act({ type: "MOVE_STACK", uid: movingStackTop, x: snap.x, y: snap.y });
      setMovingAnchor(null);
    },
    [act, movingAnchor, movingStackTop],
  );

  const selectedCard = selectedUid ? state.myHand.find((c) => c.uid === selectedUid) : undefined;
  const closeSheet = useCallback(() => setSheet(null), []);
  const closeStack = useCallback(() => setStackAnchor(null), []);

  return (
    <div
      ref={rootRef}
      className="room-root fixed inset-0 flex flex-col overflow-hidden"
      onPointerDownCapture={unlockAudio}
      onContextMenu={(e) => e.preventDefault()}
    >
      <TopRail
        roomCode={state.roomCode}
        players={state.players}
        selfId={state.playerId}
        connection={connection}
        muted={muted}
        onToggleMute={() => setMuted(!muted)}
        onInvite={() => setSheet("invite")}
        onMenu={() => setSheet("room")}
      />

      <div className="relative flex min-h-0 flex-1 flex-col px-2">
        <TableFelt
          table={state.table}
          back={back}
          cardW={tableCard.w}
          cardH={tableCard.h}
          contentW={contentW}
          contentH={contentH}
          feltRef={feltRef}
          contentRef={contentRef}
          store={store}
          startDrag={startDrag}
          movingAnchor={movingStackTop ? movingAnchor : null}
          onFeltTap={onFeltTap}
        >
          <ActivityTicker activity={state.activity} />
          {movingStackTop && (
            <div className="absolute inset-x-0 bottom-2 z-[6000] flex justify-center px-3">
              <div className="flex items-center gap-2 rounded-full bg-black/70 py-1 pl-3 pr-1 text-xs text-cream">
                Tap the table to place the pile — or drag it
                <button type="button" className="chip" onClick={() => setMovingAnchor(null)}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </TableFelt>

        {selectedCard && (
          <div className="absolute inset-x-2 bottom-2 z-[6000] flex justify-center">
            <div className="sheet-panel flex items-center gap-1.5 rounded-full bg-[#121a17]/95 p-1 shadow-xl ring-1 ring-white/10">
              <button
                type="button"
                className="chip chip-on"
                onClick={() => {
                  const p = snapToStack(state.table, 0.5, 0.5);
                  playFromHand(selectedCard.uid, p.x, p.y, false);
                }}
              >
                Play
              </button>
              <button
                type="button"
                className="chip"
                onClick={() => {
                  const p = snapToStack(state.table, 0.5, 0.5);
                  playFromHand(selectedCard.uid, p.x, p.y, true);
                }}
              >
                Play face-down
              </button>
              <button
                type="button"
                className="chip"
                onClick={() => act({ type: "FLIP_HAND_CARD", uid: selectedCard.uid })}
              >
                {selectedCard.faceUp ? "Make blind" : "Reveal"}
              </button>
              <button type="button" className="chip px-2.5" aria-label="Deselect" onClick={() => setSelected(null)}>
                ✕
              </button>
            </div>
          </div>
        )}
      </div>

      <div ref={handRef} className="tray shrink-0 pb-[max(0.35rem,env(safe-area-inset-bottom))]">
        <div className="flex items-center gap-2 px-2 pt-2">
          <DeckPile
            count={state.deckCount}
            back={back}
            onPointerDown={(e) => startDrag(e, { kind: "deck" })}
            onMore={() => setSheet("deck")}
          />
          <div className="no-scrollbar flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto">
            <button type="button" className="chip" onClick={() => act({ type: "SORT_HAND", by: "rank" })}>
              Sort A–K
            </button>
            <button type="button" className="chip" onClick={() => act({ type: "SORT_HAND", by: "suit" })}>
              Sort ♠♥
            </button>
            <button
              type="button"
              aria-pressed={faceDown}
              className={`chip ${faceDown ? "chip-on" : ""}`}
              onClick={() => setFaceDown(!faceDown)}
              title="Cards you play land face-down"
            >
              Face-down
            </button>
            <button
              type="button"
              aria-pressed={shield}
              className={`chip ${shield ? "chip-on" : ""}`}
              onClick={() => setShield(!shield)}
              title="Hide your cards on screen; press and hold a card to peek"
            >
              {shield ? (peeking ? "Peeking" : "Shielded") : "Shield"}
            </button>
          </div>
        </div>
        <HandFan
          cards={state.myHand}
          back={back}
          cardW={handCard.w}
          cardH={handCard.h}
          selectedUid={selectedUid}
          concealed={concealed}
          store={store}
          startDrag={startDrag}
        />
      </div>

      <DragGhost
        store={store}
        state={state}
        back={back}
        w={tableCard.w}
        h={tableCard.h}
        faceDown={faceDown}
        concealed={concealed}
      />

      <StackSheet
        stack={stack}
        back={back}
        canDeck={canDeck}
        onClose={closeStack}
        act={act}
        onMovePile={() => stackAnchor && setMovingAnchor(stackAnchor)}
      />
      <DeckSheet
        open={sheet === "deck"}
        onClose={closeSheet}
        deckCount={state.deckCount}
        playerCount={state.players.filter((p) => p.connected).length}
        canDeck={canDeck}
        faceDown={faceDown}
        act={act}
      />
      <RoomSheet
        open={sheet === "room"}
        onClose={closeSheet}
        state={state}
        canDeck={canDeck}
        act={act}
        muted={muted}
        setMuted={setMuted}
        shield={shield}
        setShield={setShield}
        onInvite={() => setSheet("invite")}
        onLeave={onLeave}
      />
      <InviteSheet open={sheet === "invite"} onClose={closeSheet} roomCode={state.roomCode} />
      <Toast toast={toast} onDismiss={dismissToast} />
    </div>
  );
}

function DeckPile({
  count,
  back,
  onPointerDown,
  onMore,
}: {
  count: number;
  back: CardBackId;
  onPointerDown: (e: React.PointerEvent<HTMLElement>) => void;
  onMore: () => void;
}) {
  const layers = Math.min(3, Math.ceil(count / 18));
  return (
    <div className="flex shrink-0 items-center gap-1">
      <button
        type="button"
        aria-label={`Deck, ${count} cards. Tap to draw, hold for options, drag to place`}
        className="relative h-[46px] w-[38px] touch-none"
        onPointerDown={onPointerDown}
        onClick={(e) => e.preventDefault()}
      >
        {count === 0 ? (
          <span className="absolute inset-0 rounded-[4px] border border-dashed border-white/25" />
        ) : (
          Array.from({ length: layers }, (_, i) => (
            <CardFace
              key={i}
              card={{ faceUp: false }}
              back={back}
              w={32}
              h={43}
              className="card-shadow absolute"
              style={{ left: i * 1.5, top: (layers - 1 - i) * 1.5 }}
            />
          ))
        )}
        <span className="absolute -bottom-1 -right-1 min-w-[22px] rounded-full bg-gold px-1 text-center text-[11px] font-bold leading-[18px] tabular-nums text-ink">
          {count}
        </span>
      </button>
      <button type="button" className="icon-btn h-8 w-6" aria-label="Deck options" onClick={onMore}>
        <svg viewBox="0 0 4 16" className="h-3.5 w-1" fill="currentColor" aria-hidden>
          <circle cx="2" cy="2" r="1.6" />
          <circle cx="2" cy="8" r="1.6" />
          <circle cx="2" cy="14" r="1.6" />
        </svg>
      </button>
    </div>
  );
}
