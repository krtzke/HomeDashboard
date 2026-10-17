# Home Dashboard

A self-hosted start page for the household, running on a Raspberry Pi. It has rearrangeable widgets for to-do and shopping lists, a calendar, a day timeline and timers. It's an installable PWA that **works offline** and syncs when the server is reachable again.

## Features

- **Lists**: To-do and shopping lists. 📌 **Persistent** items (e.g. "Milk") stay on the list and are only unchecked by *Clear checked*. One-time items are removed.
- **Calendar**: Month view. Click a day to see its appointments, and click *＋ Event* (or double-click a day) to add one. Events can span **several days** (e.g. vacation) and have a **color**. In the month view they show as colored bars that continue across days.
- **Day timeline**: Today's appointments on a time axis with a "now" line. Multi-day events show as chips ("Vacation · day 3/7"). Click an hour to add an event there, and the next 7 days are listed below.
- **Notepad**: Click ✎ to edit and *Done* to view. Use the toolbar or shortcuts: `**bold**` (Ctrl+B), `*italic*` (Ctrl+I), `++underline++` (Ctrl+U), `~~strike~~` (Ctrl+Shift+X), `{red|colored text}`, `[label](https://…)` (Ctrl+K). Bare `https://…` and `www.…` addresses become links. Also `# heading`, `- list`, `1. list` and `> quote`. HTML is never rendered.
- **Clock & date**: Large time, date and calendar week. ⚙ adds seconds and an optional second time zone.
- **Countdown**: Days until dates you add (＋, with an emoji). ⚙ can also count down to calendar events of one color.
- **Quick links**: Tiles with the site's icon, an emoji or a letter. Manage them with ⚙. `192.168.x.x`, `fritz.box` and other LAN addresses get `http://` automatically.
- **Recurring chores**: "every N days/weeks". Tap the circle when done, tap ✓ again to undo. Overdue chores turn red, and the header counts what's due.
- **Birthdays**: Upcoming birthdays with age (if the year is known). Click a row to edit or delete.
- **Weather**: Search your town with ⚙. Shows current conditions, the next 12 hours and 5 days (Open-Meteo, no API key). The last forecast is shown offline.
- **Waste collection**: Paste your municipality's iCal/ICS (or `webcal://`) URL, which the Pi fetches, or upload an `.ics` file. Shows a "Tomorrow — put it out tonight" alert and color-coded bin types. Works offline from the saved copy.
- **Pi status**: CPU temperature, load, memory, disk, uptime and the Pi's under-voltage/throttling flags (`vcgencmd`).
- **Timers**: Presets or custom durations (`5`, `5:30`, `1:00:00`), with sound, notification and vibration. Timers belong to the device that started them and don't sync.
- **Layout**: *✎ Edit* lets you drag widgets by their header, resize them, add and remove them. The layout syncs to all devices. Phones show the widgets in one column.
- **Offline + sync**: All data is stored in the browser (IndexedDB) first. The sync button shows the state and the number of pending changes, and the app syncs automatically on reconnect, when opened, and every 30 s.

## Development (Windows/macOS/Linux)

Requires Node.js 24+.

```bash
npm install
npm run dev        # API on :3000 + Vite dev server on :5173 (http://localhost:5173)
npm test           # server sync tests
npm run typecheck
npm run build      # production build → client/dist
npm start          # serves API + built app on http://localhost:3000
```

The Service Worker (offline mode) is only active in the production build (`npm run build && npm start`).

## How it works

```
Browser (PWA)                               Raspberry Pi
  React UI ─ reads/writes ─▶ IndexedDB        Caddy (HTTPS, tls internal)
  Service Worker (offline app shell)            └▶ Fastify :3000
  outbox of pending changes ── POST /api/sync ──▶ SQLite (node:sqlite)
```

- Every synced record has `id`, `updatedAt` and `deleted`. A deletion is stored as a tombstone so it reaches other devices.
- `POST /api/sync { since, changes }`: the server applies changes with **last-write-wins** by `updatedAt`, gives each one an increasing `version`, and returns all records with `version > since`.
- The client clears outbox entries only if they weren't edited again during the request.

## Project layout

| Path | Contents |
|---|---|
| `shared/src/types.ts` | Record and sync types used by both sides |
| `server/src/` | Fastify server, SQLite migrations (`db.ts`), sync logic (`sync.ts`) |
| `server/test/` | Sync tests (`node --test`) |
| `client/src/db.ts`, `data.ts`, `sync.ts` | Local DB, write helpers (stamp + outbox), sync engine |
| `client/src/widgets/` | Widgets + `registry.ts`. Register a new widget type there |
| `deploy/` | Pi setup: [deploy/README.md](deploy/README.md) |

## Deploy to the Raspberry Pi

See **[deploy/README.md](deploy/README.md)**. In short: push this repo to Git, clone it on the Pi, run `bash deploy/install.sh`, set up Caddy, and install the root certificate on your devices once.
