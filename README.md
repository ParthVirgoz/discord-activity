# Discord Activity — Tic-Tac-Toe

Multiplayer **Tic-Tac-Toe** for Discord voice channels, built with Colyseus + the Discord Embedded App SDK.

Open the Activity while in a voice channel — the first two players become **X** and **O**; everyone else can watch.

## Project structure

- `apps/client/` — Vite + TypeScript UI (`GameApp`)
- `apps/server/` — Colyseus game room (`GameRoom`) + Discord OAuth

## Environment variables

- `apps/client/.env` — `VITE_DISCORD_CLIENT_ID`
- `apps/server/.env` — `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `JWT_SECRET`

## Local development

```bash
npm install
npm run start:server   # terminal 1 — port 2567
npm run start:client   # terminal 2 — Vite dev server
```

Use a tunnel (`cloudflared` / `ngrok`) and map URLs in the [Discord Developer Portal](https://discord.com/developers/applications) to test inside Discord.

## Deploy

Deploy **both** client (Vercel) and server (Railway). The server registers room `my_room` filtered by voice `channelId` — one game per channel.

> **Note:** The previous Watch Together / SyncTube code is still in the repo under `WatchRoom.ts` and `WatchApp.ts` but is no longer used. This Activity is now a party game.

## How to play

1. Join a Discord voice channel
2. Launch the Activity
3. First joiner is **X**, second is **O**
4. Tap squares on your turn; use **Play again** after a win or draw
