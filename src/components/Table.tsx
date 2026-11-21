"use client";

import { memo, useMemo, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from "react";
import { groupStacks } from "@/domain/table";
import type { CardBackId, TableCardView } from "@/lib/types";
import { useDragSelector, type DragSource, type DragStore } from "@/hooks/useDragEngine";
import { CardFace } from "./Card";

const MAX_LAYERS = 4;

type StartDrag = (e: ReactPointerEvent<HTMLElement>, source: DragSource) => void;

interface Props {
  table: TableCardView[];
  back: CardBackId;
  cardW: number;
  cardH: number;
  contentW: number;
  contentH: number;
  feltRef: RefObject<HTMLDivElement | null>;
  contentRef: RefObject<HTMLDivElement | null>;
  store: DragStore;
  startDrag: StartDrag;
  movingAnchor: { x: number; y: number } | null;
  onFeltTap: (clientX: number, clientY: number) => void;
  children?: ReactNode;
}

function px(n: number) {
  return Math.round(n * 100) / 100;
}

export function TableFelt({
  table,
  back,
  cardW,
  cardH,
  contentW,
  contentH,
  feltRef,
  contentRef,
  store,
  startDrag,
  movingAnchor,
  onFeltTap,
  children,
}: Props) {
  const hiddenKey = useDragSelector(store, (s) => (s.drag ? s.drag.hidden.join(",") : ""));
  const settledKey = useDragSelector(store, (s) => s.settled);

  const layout = useMemo(() => {
    const hidden = new Set(hiddenKey ? hiddenKey.split(",") : []);
    const zIndex = new Map(table.map((c, i) => [c.uid, i + 1]));
    const cards: { card: TableCardView; depth: number; top: boolean; z: number }[] = [];
    const badges: { key: string; x: number; y: number; count: number; topUid: string; z: number }[] = [];
    for (const stack of groupStacks(table)) {
      const visible = stack.filter((c) => !hidden.has(c.uid));
      const n = stack.length;
      stack.forEach((card, j) => {
        const visIdx = visible.indexOf(card);
        const depth = visIdx < 0 ? 0 : visible.length - 1 - visIdx;
        if (depth >= MAX_LAYERS) return;
        cards.push({ card, depth, top: j === n - 1, z: zIndex.get(card.uid) ?? 1 });
      });
      const top = stack[n - 1];
      if (visible.length > 1) {
        badges.push({
          key: `${top.x},${top.y}`,
          x: top.x,
          y: top.y,
          count: visible.length,
          topUid: top.uid,
          z: (zIndex.get(top.uid) ?? 1) + 1,
        });
      }
    }
    return { cards, badges, hidden };
  }, [table, hiddenKey]);

  const settled = useMemo(() => new Set(settledKey ? settledKey.split(",") : []), [settledKey]);
  const insetX = Math.round(cardW / 2 + 6);
  const insetY = Math.round(cardH / 2 + 6);

  return (
    <div
      ref={feltRef}
      className="felt relative isolate min-h-0 flex-1 overflow-hidden"
      onClick={(e) => {
        if (e.target === e.currentTarget || (e.target as HTMLElement).dataset.felt === "1") {
          onFeltTap(e.clientX, e.clientY);
        }
      }}
    >
      <div
        ref={contentRef}
        data-felt="1"
        className="absolute"
        style={{ left: insetX, right: insetX, top: insetY, bottom: insetY }}
      >
        {table.length === 0 && (
          <p className="pointer-events-none absolute inset-0 grid place-items-center px-6 text-center text-sm text-white/45">
            Swipe a card up from your hand to play it
          </p>
        )}
        {layout.cards.map(({ card, depth, top, z }) => (
          <TableCardEl
            key={card.uid}
            card={card}
            back={back}
            w={cardW}
            h={cardH}
            tx={px(card.x * contentW - cardW / 2 + depth * 1.2)}
            ty={px(card.y * contentH - cardH / 2 + depth * 2.2)}
            z={z}
            depth={depth}
            interactive={top}
            hidden={layout.hidden.has(card.uid)}
            instant={settled.has(card.uid)}
            highlight={
              top && !!movingAnchor && movingAnchor.x === card.x && movingAnchor.y === card.y
            }
            startDrag={startDrag}
          />
        ))}
        {layout.badges.map((b) => (
          <button
            key={b.key}
            type="button"
            aria-label={`Pile of ${b.count}. Drag to move the whole pile`}
            className="pile-badge absolute left-0 top-0"
            style={{
              transform: `translate(${px(b.x * contentW + cardW / 2 - 14)}px, ${px(b.y * contentH - cardH / 2 - 10)}px)`,
              zIndex: b.z + 1000,
            }}
            onPointerDown={(e) => startDrag(e, { kind: "table", uid: b.topUid, whole: true })}
          >
            {b.count}
          </button>
        ))}
        <DropRing store={store} contentW={contentW} contentH={contentH} w={cardW} h={cardH} />
      </div>
      {children}
    </div>
  );
}

const TableCardEl = memo(function TableCardEl({
  card,
  back,
  w,
  h,
  tx,
  ty,
  z,
  depth,
  interactive,
  hidden,
  instant,
  highlight,
  startDrag,
}: {
  card: TableCardView;
  back: CardBackId;
  w: number;
  h: number;
  tx: number;
  ty: number;
  z: number;
  depth: number;
  interactive: boolean;
  hidden: boolean;
  instant: boolean;
  highlight: boolean;
  startDrag: StartDrag;
}) {
  return (
    <div
      className={`table-card card-pop absolute left-0 top-0 rounded-[5px] ${instant ? "no-anim" : ""} ${
        interactive ? "cursor-grab touch-none" : "pointer-events-none"
      } ${highlight ? "ring-2 ring-white ring-offset-2 ring-offset-felt" : ""}`}
      style={{
        transform: `translate(${tx}px, ${ty}px)`,
        zIndex: z,
        opacity: hidden ? 0 : 1,
        filter: depth > 0 ? `brightness(${1 - depth * 0.07})` : undefined,
      }}
      onPointerDown={interactive ? (e) => startDrag(e, { kind: "table", uid: card.uid, whole: false }) : undefined}
    >
      <CardFace card={card} back={back} w={w} h={h} className="card-shadow" />
    </div>
  );
});

function DropRing({
  store,
  contentW,
  contentH,
  w,
  h,
}: {
  store: DragStore;
  contentW: number;
  contentH: number;
  w: number;
  h: number;
}) {
  const key = useDragSelector(store, (s) => {
    const t = s.drag?.target;
    return t && t.kind === "table" ? `${t.x}|${t.y}|${t.snapped ? 1 : 0}` : "";
  });
  if (!key) return null;
  const [x, y, snapped] = key.split("|");
  return (
    <div
      aria-hidden
      className={`drop-ring pointer-events-none absolute left-0 top-0 rounded-[7px] ${snapped === "1" ? "is-snapped" : ""}`}
      style={{
        width: w + 8,
        height: h + 8,
        transform: `translate(${px(Number(x) * contentW - w / 2 - 4)}px, ${px(Number(y) * contentH - h / 2 - 4)}px)`,
        zIndex: 5000,
      }}
    />
  );
}
