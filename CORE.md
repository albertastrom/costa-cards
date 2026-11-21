# Costa Cards — Core Spec (stack-agnostic)

A free-form multiplayer virtual card table. No rules engine. No turn enforcement. Just a shuffled deck, a shared table, private hands, and a host who can deal.

This document and the `assets/` folder are enough to rebuild the product in **any** stack (web, native, game engine, etc.). Nothing here requires React, WebSockets brand X, or a particular host.

---

## Product intent

**Problem:** Friends want to play any physical card game together without a deck at hand.

**Solution:** A shared digital table where players control cards freely — same as sitting around a real table, not like a rules-enforced video game.

| What it is | What it is not |
|---|---|
| Shared 10×10 table grid | Poker / blackjack engine |
| Private hands | Turn system |
| Host deck controls | Automatic scoring |
| Flip / play / take / move | Forced legal-move validation |

**Primary experience target:** phone in portrait (touch-first). Desktop is fine; design for thumbs first.

**Room model:** create or join with a short room code; share code or invite link.

---

## Domain model

Language-neutral types. Field names are suggestions; the semantics matter.

### Card

| Field | Type | Notes |
|---|---|---|
| `id` | string | Stable identity, e.g. `Ah`, `10d`, `Ks` = `{rank}{suit}` |
| `rank` | enum | `A`, `2`…`10`, `J`, `Q`, `K` |
| `suit` | enum | `h` hearts, `d` diamonds, `s` spades, `c` clubs |
| `faceUp` | bool | Whether the face is visible |

There are exactly **52** unique ids (standard deck, no jokers).

### TableCard

Extends Card:

| Field | Type | Notes |
|---|---|---|
| `gridX` | int | Column **0…9** |
| `gridY` | int | Row **0…9** |
| `playedBy` | string | Player id who last put it on the table |

### Player

| Field | Type | Notes |
|---|---|---|
| `id` | string | Connection / seat id (may change on reconnect; see sessions) |
| `name` | string | Display name, trimmed, max 20 chars |
| `hand` | Card[] | Private |
| `isHost` | bool | Role for deck ops only |

### Game state (server authority)

| Field | Type | Notes |
|---|---|---|
| `deck` | Card[] | Remaining draw pile; face-down conceptually |
| `table` | TableCard[] | Order matters: later index = higher in stack |
| `players` | map id → Player | |
| `phase` | `lobby` \| `playing` | Becomes `playing` on first deal |

### What each client is allowed to know

| Data | Self | Others |
|---|---|---|
| Hand cards | Full `Card[]` | Count only (`handCount`) |
| Table | Full public list | Full public list |
| Deck | Count only | Count only |
| Player names / host | Yes | Yes |

Never broadcast another player’s hand contents.

---

## Rules that *are* enforced

These are the only hard rules. Everything else is free-form.

### Deck

1. Start: build 52 cards (`faceUp: false`), shuffle (Fisher–Yates or equivalent).
2. **DEAL(n)** (host): each player receives up to `n` cards from the top of the deck with `faceUp: true`. Clamp `n` to remaining deck size. If `n ≤ 0`, reject.
3. **DEAL_TO_SELF(n)** (host): only the host receives `n` cards with `faceUp: false` (secret / blind deal).
4. **SHUFFLE** (host): shuffle remaining deck in place.
5. **RESET_DECK** (host): new shuffled 52-card deck; clear all hands and the table.

### Table & hands

6. **PLAY_CARD(cardId, gridX, gridY)** (any player): card must be in that player’s hand. Clamp coords to 0…9. Remove from hand; append to `table` as `TableCard` (keep current `faceUp`).
7. **TAKE_CARD(cardId)** (any): card must be on the table **and** top of its cell. Remove from table; add to hand with `faceUp: true`.
8. **MOVE_TABLE_CARD(cardId, gridX, gridY)** (any): same top-card check; remove and re-append at new cell (becomes top of destination stack).
9. **FLIP_CARD(cardId)** (any): top table card only; toggle `faceUp`.
10. **FLIP_HAND_CARD(cardId)** (any): card in own hand; toggle `faceUp`. Only that player sees the result.

### Stacking (LIFO)

At a grid cell `(x, y)`, cards stacked in `table` array order. A card is **top** iff no later table entry shares the same `(gridX, gridY)`.

Only top cards accept take / move / flip-on-table.

### Names

- Trim whitespace; reject empty.
- Max length **20**.

### Host

- First joiner is host.
- Host disconnect or leave → promote another live player **immediately**.
- Former host who reconnects after promote does **not** steal host back (unless room has no host).

---

## Logical message protocol

Transport-agnostic. JSON over any bidirectional channel is fine (WebSocket, WebRTC data channel, local IPC for single-device tests).

### Client → server

| Type | Payload | Who |
|---|---|---|
| `JOIN` | `name`, optional `sessionId` | Anyone connecting |
| `LEAVE` | — | Intentional exit |
| `DEAL` | `count` | Host |
| `DEAL_TO_SELF` | `count` | Host |
| `SHUFFLE` | — | Host |
| `RESET_DECK` | — | Host |
| `PLAY_CARD` | `cardId`, `gridX`, `gridY` | Player with card |
| `TAKE_CARD` | `cardId` | Anyone |
| `MOVE_TABLE_CARD` | `cardId`, `gridX`, `gridY` | Anyone |
| `FLIP_CARD` | `cardId` | Anyone |
| `FLIP_HAND_CARD` | `cardId` | Owner |

### Server → client

| Type | Payload | Notes |
|---|---|---|
| `SNAPSHOT` | private view (below) | Full resync for one client |
| `TABLE_UPDATE` | `table` | Public |
| `HAND_UPDATE` | `hand` | Only to owner |
| `DECK_COUNT` | `count` | Public |
| `PLAYER_JOIN` | id, name, handCount, isHost | |
| `PLAYER_LEAVE` | playerId, optional name | |
| `ERROR` | message | Hard failure (e.g. cannot join) |
| `REJECT` | reason, optional cardId | Soft fail; follow with SNAPSHOT |

### ClientSnapshot (inside SNAPSHOT)

```
playerId
myHand: Card[]
table: TableCard[]
players: [{ id, name, handCount, isHost }]
deckCount: number
phase: string
```

### Authority pattern

1. **Server is authoritative** for all mutations.
2. Clients may apply optimistic UI for their own actions.
3. On `REJECT`, discard optimism and apply a fresh `SNAPSHOT`.
4. Prefer private hand updates only to the owner; broadcast table/deck/roster as needed.

You may collapse partial updates into SNAPSHOT-only if that simplifies your first build.

---

## Sessions & reconnect (behavior)

| Scenario | Result |
|---|---|
| Network drop / refresh | Keep seat for a **ghost TTL** (~30s); same `sessionId` restores hand |
| Intentional `LEAVE` | No ghost; clear local session; next join = empty hand |
| Host drops | Promote another player immediately |
| Room empty (no players, no ghosts) | Optional idle cleanup (~45s) for capacity |

### Session identity

- Client generates a stable `sessionId` per room (store however you like: localStorage, keychain, etc.).
- Send it on `JOIN`. Server maps connection id ↔ session while connected.
- On unexpected disconnect: keep player data under old connection id until TTL or reconnect.
- On reconnect: reattach hand under new connection id; broadcast leave(old) + join(new) as needed so others update roster.

### Leave vs disconnect

- **Leave:** client sends `LEAVE` then clears session key → server removes immediately.
- **Disconnect:** no `LEAVE` → ghost timer; hand preserved until expiry.

---

## Table layout (client)

Grid is **10×10** cells (indices 0–9).

Place a card’s top-left (or center — pick one and stick to it) using:

```
left = gridX * (tableWidth  - cardWidth)  / 9
top  = gridY * (tableHeight - cardHeight) / 9
```

When `gridX`/`gridY` are 0 or 9, the card sits on opposite edges of the table. Intermediate cells interpolate evenly.

**Z-order:** later entries in `table[]` draw above earlier ones. Only the top card at a cell should be interactive.

---

## Interaction UX goals

Stack-free requirements for a good touch feel:

| Gesture | Intent |
|---|---|
| Short tap | Flip (hand or top table card) |
| Hold ~180ms then move | Start drag (play / move / take) |
| Horizontal swipe on hand strip | Scroll hand without dragging a card |

**Card scale tokens** (multiply native 69×93):

| Context | Scale |
|---|---|
| Phone (tight) | ~0.72 |
| Phone (comfortable) | ~0.78 |
| Desktop | ~1.0 |

Safe-area insets matter on notched phones. Portrait is the primary orientation.

---

## Card texture system

Assets live in `public/cards/`. Machine-readable map: `public/cards/sprites.json`.

### Files

| File | Size | Role |
|---|---|---|
| `balatro_card_design.png` | 923×380 | Face art (ranks × suits) |
| `balatro_backings.png` | 497×475 | Card back + face base panel |

### Constants

```
NATIVE_W = 69
NATIVE_H = 93
COL_STEP = 71   // 69 + 2px pad
ROW_STEP = 95   // 93 + 2px pad
```

### Face sheet layout

- **13 columns** left → right: `2 3 4 5 6 7 8 9 10 J Q K A`
- **4 rows** top → bottom: hearts `h`, clubs `c`, diamonds `d`, spades `s`

Column index for rank `r`:

```
rankCol = index of r in [2,3,4,5,6,7,8,9,10,J,Q,K,A]
```

Row index for suit `s`:

```
suitRow = { h:0, c:1, d:2, s:3 }[s]
```

Pixel origin of that sprite (top-left of cell):

```
srcX = rankCol * COL_STEP
srcY = suitRow * ROW_STEP
// crop rect: (srcX, srcY, NATIVE_W, NATIVE_H)
```

### Backings sheet

| Use | Cell | Crop origin |
|---|---|---|
| Card back (face-down) | col 0, row 0 | `(0, 0)` |
| Face base (under face art) | col 1, row 0 | `(COL_STEP, 0)` = `(71, 0)` |

### How to draw a face-up card

1. Draw **face base** from backings at `(71, 0)`, size 69×93.
2. Draw **face art** from design sheet at `(rankCol*71, suitRow*95)`, size 69×93, on top.
3. Scale both by the same `scale` factor with **nearest-neighbor** filtering (`image-rendering: pixelated`, point sampling, etc.).

### How to draw a face-down card

1. Draw backings cell `(0, 0)` only, size 69×93, nearest-neighbor.

### Display size

```
displayW = round(69 * scale)
displayH = round(93 * scale)
```

### Worked examples

| Card id | rank | suit | rankCol | suitRow | face srcX,Y |
|---|---|---|---|---|---|
| `2h` | 2 | h | 0 | 0 | 0, 0 |
| `Ah` | A | h | 12 | 0 | 852, 0 |
| `10d` | 10 | d | 8 | 2 | 568, 190 |
| `Kc` | K | c | 11 | 1 | 781, 95 |
| back | — | — | — | — | backings 0, 0 |

### Pseudocode (any language)

```
function faceRect(rank, suit):
  col = RANK_ORDER.index(rank)   // ["2","3",...,"A"]
  row = SUIT_ROW[suit]           // h:0 c:1 d:2 s:3
  return (col * 71, row * 95, 69, 93)

function drawCard(card, scale):
  w, h = 69 * scale, 93 * scale
  if not card.faceUp:
    blit(backings, crop=(0,0,69,93), dest size=(w,h), filter=nearest)
  else:
    blit(backings, crop=(71,0,69,93), dest size=(w,h), filter=nearest)
    x,y,_,_ = faceRect(card.rank, card.suit)
    blit(faces, crop=(x,y,69,93), dest size=(w,h), filter=nearest)
```

---

## Deck helpers (reference algorithms)

### Build

```
for suit in [h, d, s, c]:
  for rank in [A,2,3,4,5,6,7,8,9,10,J,Q,K]:
    cards.append({ id: rank+suit, rank, suit, faceUp: false })
```

### Shuffle

Fisher–Yates in place on a copy of the array.

### Deal from top

```
dealt = deck[0..n) with faceUp = true
remaining = deck[n..)
```

Deal-to-self uses `faceUp = false` instead.

---

## Suggested rebuild order

Independent of stack — stop at any layer that already feels useful.

1. **Sprites** — one face, one back, from `public/cards` + `sprites.json`
2. **Local sandbox** — deck, hand, table grid; play / take / flip / move with no network
3. **Authority** — single authoritative room state; one or more clients
4. **Privacy** — hands never leak; snapshots as private views
5. **Host ops** — deal, deal-to-self, shuffle, reset
6. **Reconnect** — sessionId + ghost TTL
7. **Polish** — room codes, invite, mobile gestures, installable shell if desired

---

## Explicit non-goals (for v1)

- No suit/rank hand ranking, trump, or contract logic
- No forced turns or “must play” rules
- No public lobby of all rooms (privacy tradeoff)
- No multi-select drag (nice later)
- No dedicated discard/draw zones (table cells can stand in)

Optional later: configurable max rooms, manual host transfer, draw-from-deck button, multi-select.

---

## Stack freedom

Choose whatever fits your next build:

| Concern | Options (examples, not requirements) |
|---|---|
| UI | Web canvas/DOM, SwiftUI, Flutter, Godot, Unity, … |
| Realtime | Any WebSocket host, WebRTC, LAN, or offline-only |
| Persistence | None needed for core; optional room TTL |
| Auth | None required; name + sessionId is enough for friends |

This seed intentionally ships **no** framework project files.

---

## Asset note

The textures in `public/cards/` are **Balatro-style** pixel card art used by the previous prototype for personal rebuild convenience. If you ship commercially or publicly, verify licensing / replace with original art. The **system** (atlas layout, ids, layering) is what this project preserves; the PNGs are the working art pack.

---

## Folder map

```
seed/
  CORE.md                          ← this file
  assets/
    balatro/
      balatro_card_design.png      ← face sheet
      balatro_backings.png         ← back + face base
      sprites.json                 ← atlas data for code
```

Open this folder alone. Rebuild on your terms.
