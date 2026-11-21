import { STACK_SNAP_RADIUS } from "../lib/types";

export interface Placed {
  uid: string;
  x: number;
  y: number;
}

export function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0.5;
  return Math.max(0, Math.min(1, n));
}

export function snapToStack<T extends Placed>(
  table: readonly T[],
  x: number,
  y: number,
  exclude: ReadonlySet<string> = new Set(),
): { x: number; y: number; snapped: boolean } {
  const cx = clamp01(x);
  const cy = clamp01(y);
  let best: { x: number; y: number } | null = null;
  let bestD = STACK_SNAP_RADIUS;
  for (const c of table) {
    if (exclude.has(c.uid)) continue;
    const d = Math.hypot(c.x - cx, c.y - cy);
    if (d <= bestD) {
      bestD = d;
      best = { x: c.x, y: c.y };
    }
  }
  return best ? { ...best, snapped: true } : { x: cx, y: cy, snapped: false };
}

export function stackOf<T extends Placed>(table: readonly T[], uid: string): T[] {
  const card = table.find((c) => c.uid === uid);
  if (!card) return [];
  return table.filter((c) => c.x === card.x && c.y === card.y);
}

export function isTopOfStack<T extends Placed>(table: readonly T[], uid: string): boolean {
  const stack = stackOf(table, uid);
  return stack.length > 0 && stack[stack.length - 1].uid === uid;
}

export function groupStacks<T extends Placed>(table: readonly T[]): T[][] {
  const map = new Map<string, T[]>();
  for (const c of table) {
    const key = `${c.x},${c.y}`;
    const list = map.get(key);
    if (list) list.push(c);
    else map.set(key, [c]);
  }
  return [...map.values()];
}
