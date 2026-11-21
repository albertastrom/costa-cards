"use client";

import { memo, useRef, type PointerEvent as ReactPointerEvent } from "react";
import type { CardBackId, CardView } from "@/lib/types";
import { useElementSize } from "@/hooks/useElementSize";
import { useDragSelector, type DragSource, type DragStore } from "@/hooks/useDragEngine";
import { CardFace } from "./Card";

type StartDrag = (e: ReactPointerEvent<HTMLElement>, source: DragSource) => void;

const LIFT = 14;
const SIDE_PAD = 10;

export function HandFan({
  cards,
  back,
  cardW,
  cardH,
  selectedUid,
  concealed,
  store,
  startDrag,
}: {
  cards: CardView[];
  back: CardBackId;
  cardW: number;
  cardH: number;
  selectedUid: string | null;
  concealed: boolean;
  store: DragStore;
  startDrag: StartDrag;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const { width } = useElementSize(scrollRef);
  const hiddenKey = useDragSelector(store, (s) =>
    s.drag?.source.kind === "hand" ? s.drag.source.uid : "",
  );

  const n = cards.length;
  const avail = Math.max(cardW, width - SIDE_PAD * 2);
  const minStep = Math.max(22, Math.round(cardW * 0.4));
  const maxStep = cardW + 6;
  const step = n <= 1 ? 0 : Math.max(minStep, Math.min(maxStep, (avail - cardW) / (n - 1)));
  const innerW = n === 0 ? 0 : Math.round(cardW + step * (n - 1));

  return (
    <div
      ref={scrollRef}
      className="no-scrollbar relative w-full overflow-x-auto overflow-y-hidden"
      style={{ height: cardH + LIFT + 10, touchAction: "pan-x" }}
    >
      {n === 0 ? (
        <p className="grid h-full place-items-center text-xs text-cream/35">
          Your hand is empty — tap the deck to draw
        </p>
      ) : (
        <div
          className="relative mx-auto"
          style={{ width: innerW + SIDE_PAD * 2, height: "100%", paddingInline: SIDE_PAD }}
        >
          {cards.map((card, i) => (
            <HandCard
              key={card.uid}
              card={card}
              back={back}
              w={cardW}
              h={cardH}
              left={SIDE_PAD + Math.round(i * step)}
              z={i + 1}
              selected={card.uid === selectedUid}
              hidden={card.uid === hiddenKey}
              concealed={concealed}
              startDrag={startDrag}
            />
          ))}
        </div>
      )}
    </div>
  );
}

const HandCard = memo(function HandCard({
  card,
  back,
  w,
  h,
  left,
  z,
  selected,
  hidden,
  concealed,
  startDrag,
}: {
  card: CardView;
  back: CardBackId;
  w: number;
  h: number;
  left: number;
  z: number;
  selected: boolean;
  hidden: boolean;
  concealed: boolean;
  startDrag: StartDrag;
}) {
  const blind = !card.faceUp;
  return (
    <div
      className="hand-card card-pop absolute rounded-[5px]"
      style={{
        left,
        top: LIFT + 4,
        zIndex: z,
        opacity: hidden ? 0 : 1,
        transform: selected ? `translateY(-${LIFT}px)` : undefined,
        touchAction: "pan-x",
      }}
      onPointerDown={(e) => startDrag(e, { kind: "hand", uid: card.uid })}
      onContextMenu={(e) => e.preventDefault()}
    >
      <CardFace
        card={card}
        back={back}
        w={w}
        h={h}
        concealed={concealed}
        className={`card-shadow ${selected ? "ring-2 ring-gold" : ""}`}
      />
      {blind && !concealed && (
        <span className="absolute bottom-1 left-1/2 -translate-x-1/2 rounded bg-black/60 px-1 text-[9px] font-semibold uppercase tracking-wider text-cream/80">
          blind
        </span>
      )}
    </div>
  );
});
