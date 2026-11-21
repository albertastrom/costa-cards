"use client";

import type { CardBackId, CardView, ClientSnapshot } from "@/lib/types";
import { useDragSelector, type DragStore } from "@/hooks/useDragEngine";
import { CardFace } from "./Card";

export function DragGhost({
  store,
  state,
  back,
  w,
  h,
  faceDown,
  concealed,
}: {
  store: DragStore;
  state: ClientSnapshot;
  back: CardBackId;
  w: number;
  h: number;
  faceDown: boolean;
  concealed: boolean;
}) {
  const drag = useDragSelector(store, (s) => s.drag);
  if (!drag) return null;
  const { source } = drag;

  let card: Pick<CardView, "faceUp" | "rank" | "suit"> = { faceUp: false };
  let hint: string | null = null;
  if (source.kind === "hand") {
    const c = state.myHand.find((x) => x.uid === source.uid);
    if (c) card = faceDown ? { faceUp: false } : c;
    if (drag.target?.kind === "table") hint = faceDown ? "Play face-down" : "Play";
  } else if (source.kind === "table") {
    const c = state.table.find((x) => x.uid === source.uid);
    if (c) card = c;
    if (drag.target?.kind === "hand") hint = drag.count > 1 ? `Take ${drag.count}` : "Take";
  } else {
    if (drag.target?.kind === "hand") hint = "Draw";
    else if (drag.target) hint = faceDown ? "Place face-down" : "Turn up onto table";
  }

  const layers = Math.min(3, drag.count);
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed left-0 top-0 z-[150]"
      style={{ transform: `translate(${drag.x - w / 2}px, ${drag.y - h / 2}px)` }}
    >
      <div className="ghost-lift relative">
        {Array.from({ length: layers - 1 }, (_, i) => (
          <CardFace
            key={i}
            card={{ faceUp: false }}
            back={back}
            w={w}
            h={h}
            className="card-shadow absolute"
            style={{ left: (layers - 1 - i) * 1.5, top: (layers - 1 - i) * 2.5 }}
          />
        ))}
        <CardFace
          card={card}
          back={back}
          w={w}
          h={h}
          concealed={concealed && source.kind === "hand"}
          className="card-shadow-lifted relative"
        />
        {hint && (
          <span className="absolute -top-7 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-fg px-2 py-0.5 text-[11px] font-medium text-white">
            {hint}
          </span>
        )}
      </div>
    </div>
  );
}
