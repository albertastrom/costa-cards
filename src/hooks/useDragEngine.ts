"use client";

import { useCallback, useEffect, useRef, useSyncExternalStore, type RefObject } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { clamp01, snapToStack, stackOf } from "@/domain/table";
import { haptic, unlockAudio } from "@/lib/sound";
import type { ClientSnapshot } from "@/lib/types";

export type DragSource =
  | { kind: "hand"; uid: string }
  | { kind: "table"; uid: string; whole: boolean }
  | { kind: "deck" };

export type DropTarget =
  | { kind: "hand" }
  | { kind: "table"; x: number; y: number; snapped: boolean };

interface DragVisual {
  source: DragSource;
  x: number;
  y: number;
  target: DropTarget | null;
  hidden: string[];
  count: number;
}

interface StoreState {
  drag: DragVisual | null;
  settled: string;
}

export class DragStore {
  private state: StoreState = { drag: null, settled: "" };
  private listeners = new Set<() => void>();
  private settleTimer: ReturnType<typeof setTimeout> | null = null;

  get = () => this.state;
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  private emit() {
    this.listeners.forEach((l) => l());
  }
  setDrag(drag: DragVisual | null) {
    this.state = { ...this.state, drag };
    this.emit();
  }
  settle(uids: string[]) {
    if (this.settleTimer) clearTimeout(this.settleTimer);
    this.state = { ...this.state, settled: uids.join(",") };
    this.emit();
    this.settleTimer = setTimeout(() => {
      this.state = { ...this.state, settled: "" };
      this.emit();
    }, 400);
  }
}

const serverSnap = (): StoreState => ({ drag: null, settled: "" });
const SERVER_STATE = serverSnap();

export function useDragSelector<T>(store: DragStore, select: (s: StoreState) => T): T {
  return useSyncExternalStore(
    store.subscribe,
    () => select(store.get()),
    () => select(SERVER_STATE),
  );
}

const LIFT_DY = 12;
const DRAG_DIST = 6;
const TAP_DIST = 10;
const LONG_MS = 450;
const PEEK_MS = 220;
const FLICK_VY = -0.9;

interface Active {
  pointerId: number;
  pointerType: string;
  source: DragSource;
  sx: number;
  sy: number;
  x: number;
  y: number;
  offX: number;
  offY: number;
  dragging: boolean;
  consumed: boolean;
  peeking: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  samples: { y: number; t: number }[];
}

export interface DragEngineOptions {
  store: DragStore;
  rootRef: RefObject<HTMLElement | null>;
  feltRef: RefObject<HTMLElement | null>;
  handRef: RefObject<HTMLElement | null>;
  getState: () => ClientSnapshot | null;
  tableCardH: number;
  onDrop: (source: DragSource, target: DropTarget) => void;
  onTap: (source: DragSource) => void;
  onLongPress: (source: DragSource) => void;
  onPeek: (peeking: boolean) => void;
}

export function clientToFelt(el: HTMLElement, cx: number, cy: number) {
  const r = el.getBoundingClientRect();
  return {
    x: clamp01(r.width > 0 ? (cx - r.left) / r.width : 0.5),
    y: clamp01(r.height > 0 ? (cy - r.top) / r.height : 0.5),
  };
}

export function useDragEngine(opts: DragEngineOptions) {
  const optsRef = useRef(opts);
  useEffect(() => {
    optsRef.current = opts;
  });
  const active = useRef<Active | null>(null);
  const handlers = useRef<{
    move: (e: PointerEvent) => void;
    up: (e: PointerEvent) => void;
    cancel: (e: PointerEvent) => void;
  }>({ move: () => {}, up: () => {}, cancel: () => {} });
  const stableMove = useCallback((e: PointerEvent) => handlers.current.move(e), []);
  const stableUp = useCallback((e: PointerEvent) => handlers.current.up(e), []);
  const stableCancel = useCallback((e: PointerEvent) => handlers.current.cancel(e), []);

  const movedUids = useCallback((source: DragSource, state: ClientSnapshot | null): string[] => {
    if (source.kind === "hand") return [source.uid];
    if (source.kind === "table") {
      if (!source.whole) return [source.uid];
      return stackOf(state?.table ?? [], source.uid).map((c) => c.uid);
    }
    return [];
  }, []);

  const computeTarget = useCallback(
    (a: Active): DropTarget | null => {
      const o = optsRef.current;
      const hand = o.handRef.current?.getBoundingClientRect();
      if (hand && a.y >= hand.top && a.x >= hand.left && a.x <= hand.right) return { kind: "hand" };
      const felt = o.feltRef.current;
      if (!felt) return null;
      const p = clientToFelt(felt, a.x + a.offX, a.y + a.offY);
      const state = o.getState();
      const exclude = new Set(movedUids(a.source, state));
      return { kind: "table", ...snapToStack(state?.table ?? [], p.x, p.y, exclude) };
    },
    [movedUids],
  );

  const publish = useCallback(
    (a: Active) => {
      const o = optsRef.current;
      const state = o.getState();
      const hidden = movedUids(a.source, state);
      o.store.setDrag({
        source: a.source,
        x: a.x + a.offX,
        y: a.y + a.offY,
        target: computeTarget(a),
        hidden,
        count: Math.max(1, hidden.length),
      });
    },
    [computeTarget, movedUids],
  );

  const clearTimer = (a: Active) => {
    if (a.timer) clearTimeout(a.timer);
    a.timer = null;
  };

  const finish = useCallback(() => {
    const a = active.current;
    if (!a) return;
    clearTimer(a);
    if (a.peeking) optsRef.current.onPeek(false);
    try {
      optsRef.current.rootRef.current?.releasePointerCapture(a.pointerId);
    } catch {
    }
    active.current = null;
    optsRef.current.store.setDrag(null);
    window.removeEventListener("pointermove", stableMove, true);
    window.removeEventListener("pointerup", stableUp, true);
    window.removeEventListener("pointercancel", stableCancel, true);
  }, [stableCancel, stableMove, stableUp]);

  const beginDrag = useCallback(
    (a: Active) => {
      clearTimer(a);
      if (a.peeking) {
        a.peeking = false;
        optsRef.current.onPeek(false);
      }
      a.dragging = true;
      try {
        optsRef.current.rootRef.current?.setPointerCapture(a.pointerId);
      } catch {
      }
      haptic(5);
      publish(a);
    },
    [publish],
  );

  const onMove = useCallback(
    (e: PointerEvent) => {
      const a = active.current;
      if (!a || e.pointerId !== a.pointerId) return;
      a.x = e.clientX;
      a.y = e.clientY;
      a.samples.push({ y: e.clientY, t: e.timeStamp });
      if (a.samples.length > 6) a.samples.shift();
      if (a.dragging) {
        e.preventDefault();
        publish(a);
        return;
      }
      if (a.consumed) return;
      const dx = a.x - a.sx;
      const dy = a.y - a.sy;
      if (a.source.kind === "hand" && a.pointerType !== "mouse") {
        if (dy < -LIFT_DY && Math.abs(dy) > Math.abs(dx)) {
          e.preventDefault();
          beginDrag(a);
        } else if (Math.abs(dx) > TAP_DIST && Math.abs(dx) > Math.abs(dy)) {
          a.consumed = true;
          clearTimer(a);
        } else if (Math.hypot(dx, dy) > TAP_DIST) {
          clearTimer(a);
        }
      } else if (Math.hypot(dx, dy) > DRAG_DIST) {
        e.preventDefault();
        beginDrag(a);
      }
    },
    [beginDrag, publish],
  );

  const onUp = useCallback(
    (e: PointerEvent) => {
      const a = active.current;
      if (!a || e.pointerId !== a.pointerId) return;
      a.x = e.clientX;
      a.y = e.clientY;
      const o = optsRef.current;
      if (a.dragging) {
        let target = computeTarget(a);
        if (a.source.kind === "hand" && (!target || target.kind === "hand")) {
          const first = a.samples[0];
          const last = a.samples[a.samples.length - 1];
          const vy = first && last && last.t > first.t ? (last.y - first.y) / (last.t - first.t) : 0;
          if (vy < FLICK_VY) {
            target = { kind: "table", ...snapToStack(o.getState()?.table ?? [], 0.5, 0.5) };
          }
        }
        const moved = movedUids(a.source, o.getState());
        finish();
        if (target) {
          o.store.settle(moved);
          o.onDrop(a.source, target);
        }
        return;
      }
      const wasTap = !a.consumed && Math.hypot(a.x - a.sx, a.y - a.sy) < TAP_DIST;
      const source = a.source;
      finish();
      if (wasTap) o.onTap(source);
    },
    [computeTarget, finish, movedUids],
  );

  const onCancel = useCallback(
    (e: PointerEvent) => {
      const a = active.current;
      if (!a || e.pointerId !== a.pointerId) return;
      finish();
    },
    [finish],
  );

  useEffect(() => {
    handlers.current = { move: onMove, up: onUp, cancel: onCancel };
  });

  useEffect(() => finish, [finish]);

  useEffect(() => {
    const root = optsRef.current.rootRef.current;
    if (!root) return;
    // Hand cards allow pan-x; a non-passive listener is the only way to stop that scroll once a card is lifted.
    const onTouchMove = (e: TouchEvent) => {
      if (active.current?.dragging && e.cancelable) e.preventDefault();
    };
    root.addEventListener("touchmove", onTouchMove, { passive: false });
    return () => root.removeEventListener("touchmove", onTouchMove);
  }, []);

  const start = useCallback(
    (e: ReactPointerEvent<HTMLElement>, source: DragSource) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      if (active.current) return;
      unlockAudio();
      e.stopPropagation();
      if (source.kind !== "hand") e.preventDefault();

      const o = optsRef.current;
      const rect = e.currentTarget.getBoundingClientRect();
      const isHand = source.kind === "hand";
      const a: Active = {
        pointerId: e.pointerId,
        pointerType: e.pointerType,
        source,
        sx: e.clientX,
        sy: e.clientY,
        x: e.clientX,
        y: e.clientY,
        offX: isHand ? 0 : rect.left + rect.width / 2 - e.clientX,
        offY: isHand ? -o.tableCardH * 0.45 : rect.top + rect.height / 2 - e.clientY,
        dragging: false,
        consumed: false,
        peeking: false,
        timer: null,
        samples: [{ y: e.clientY, t: e.timeStamp }],
      };
      active.current = a;
      if (isHand) {
        a.timer = setTimeout(() => {
          if (active.current !== a || a.dragging) return;
          a.peeking = true;
          optsRef.current.onPeek(true);
        }, PEEK_MS);
      } else {
        a.timer = setTimeout(() => {
          if (active.current !== a || a.dragging) return;
          a.consumed = true;
          haptic(12);
          optsRef.current.onLongPress(source);
        }, LONG_MS);
      }
      window.addEventListener("pointermove", stableMove, { capture: true, passive: false });
      window.addEventListener("pointerup", stableUp, true);
      window.addEventListener("pointercancel", stableCancel, true);
    },
    [stableCancel, stableMove, stableUp],
  );

  return start;
}
