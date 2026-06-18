# Discord Activity (Grapevibe)

Watch YouTube together in a Discord voice channel. One room per voice channel — no manual join/create flow.

## Local development

```bash
cd apps/grapevibe
cp .env.example .env.local   # fill in Discord app credentials
npm install
npm run dev
```

Open `http://localhost:3000?user_id=123456789012345678&channel_id=987654321098765432` (use any 17–20 digit snowflakes). The mock Discord SDK uses these query params when not running inside Discord.

## Discord Developer Portal

1. Create an **Activity** mapping URL → your deployed Grapevibe origin.
2. Set **OAuth2 redirect** as required by Discord Activities.
3. Enable scopes used by the app: `identify`, `guilds`, `guilds.members.read`, `rpc.voice.read`.
4. Configure **URL mappings** in the Activity settings (or rely on client `patchUrlMappings`):
   - `/socket.io` → your backend host
   - `/api` → your backend host

## Environment variables

| Variable | Where | Purpose |
|----------|--------|---------|
| `NEXT_PUBLIC_DISCORD_CLIENT_ID` | Client | Discord application ID |
| `DISCORD_CLIENT_ID` | Server | Same as above |
| `DISCORD_CLIENT_SECRET` | Server | OAuth code exchange |
| `JWT_SECRET` | Server | Signs socket auth tokens (required in production) |
| `NEXT_PUBLIC_SERVER_HOST` | Client | Backend host for Discord iframe URL mappings (e.g. `grapevibe.example.com:443`) |
| `NEXT_PUBLIC_SERVER_URL` | Client | Optional full backend URL when split-deploying frontend/backend |
| `BACKEND_URL` | Vercel | Proxy `/api` and `/socket.io` to Node backend |

## Architecture

- **Room ID** = Discord voice channel snowflake (`discordSDK.channelId`).
- **User identity** = Discord user id, username, avatar (JWT on Socket.IO handshake).
- **First joiner** in a channel becomes host; host transfer and permissions unchanged from Grapevibe web.
- **Node.js + Socket.IO** in `server.ts` (Next.js custom server, same port as HTTP).

## Deploy

Run the full app on a platform that supports a persistent Node process (Railway, Render, Fly, Docker). Vercel alone cannot host Socket.IO — use `BACKEND_URL` rewrites or point the Activity URL directly at your Node host.

See also `docs/DEPLOY.md` for split Vercel + Render setup from the original Grapevibe project.
