# Costa Cards

A free-form multiplayer virtual card table for small groups of friends. No rules engine — just a shared table, private hands, and a real deck everyone can reach.

Product rules live in [`CORE.md`](./CORE.md). Art atlas: [`public/cards/`](./public/cards/).

## Stack

| Piece | Tech | Host (free) |
|---|---|---|
| Web UI | Next.js (App Router) + Tailwind | Vercel Hobby |
| Realtime rooms | PartyKit (one party per room code) | PartyKit free tier |
| Authority | Pure TS domain in `src/domain` | Runs inside PartyKit |

Socket.IO / always-on Node is intentionally **not** used so the app stays deployable on free Vercel + PartyKit.

## Local development

```bash
npm install
cp .env.example .env.local   # if needed
npm run dev                  # Next + PartyKit together
```

- App: [http://localhost:3000](http://localhost:3000)
- PartyKit: `127.0.0.1:1999` (see `NEXT_PUBLIC_PARTYKIT_HOST`)

Or run separately:

```bash
npm run dev:party
npm run dev:next
```

```bash
npm test
```

## Deploy (free)

### 1. PartyKit

```bash
npx partykit login
npm run deploy:party
```

Note the host printed (e.g. `costa-cards.<you>.partykit.dev`).

### 2. Vercel

```bash
npx vercel
```

Set environment variable:

```
NEXT_PUBLIC_PARTYKIT_HOST=costa-cards.<you>.partykit.dev
```

Redeploy after setting the env var.

## How to play

1. Open the site, enter a name, **Create room**
2. Share the invite (QR code, link, or room code `/r/CODE`)
3. Tap the deck to draw; the host (or everyone, with "Anyone can deal") can deal, shuffle, and deal to the table
4. Drag a card up out of your hand to play it; drag table cards to move them or onto your hand to take them
5. Tap a pile for pile actions: take, flip, move, or recycle it into the deck

## Project map

```
party/server.ts       # Authoritative room (PartyKit): sockets, persistence, alarms, passcode
src/domain/           # Pure game logic, table geometry, sprite atlas + tests
src/lib/              # Protocol types, message validator, optimistic sync, client helpers
src/hooks/            # useRoom (connection + optimistic state), drag engine, wake lock
src/components/       # Table, hand, sheets, top rail
src/app/              # Next.js pages, manifest, metadata
public/cards/         # Sprite sheets
CORE.md               # Stack-agnostic product spec
```

## Private deployment

Set `ROOM_PASSCODE` on the PartyKit deployment (`npx partykit env add ROOM_PASSCODE`) to require a shared codeword. Players enter it once; it is remembered on their device. Locally: `npx partykit dev --var ROOM_PASSCODE=secret`.

## Notes

- Room state persists in PartyKit room storage and survives the server sleeping. Empty rooms are wiped 2 hours after the last change.
- A disconnected player keeps their seat and hand for 15 minutes; after that, or when they leave or are kicked, their cards go back into the deck.
- Max 8 players per room. Deck presets: 52, 54 (with jokers), 104 (two decks).
- If `next dev` starts spawning hundreds of PostCSS worker processes, delete `.next/dev` (corrupted Turbopack dev cache).
- Balatro-style assets are for personal rebuild convenience — verify licensing before public/commercial use.
