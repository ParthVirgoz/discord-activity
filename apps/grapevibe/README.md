# Grapevibe

**Watch together. Same bunch, same sync.** — free online watch party with synced YouTube playback.

## Brand & SEO

- **Name:** Grapevibe
- **Tagline:** Watch together. Same bunch, same sync.
- Set `NEXT_PUBLIC_APP_URL` in production for canonical URLs, Open Graph, and sitemap.

## Hosting (important)

**Vercel cannot run this app.** Grapevibe needs a long-lived Node process with Socket.IO (`server.ts`). Vercel only runs `next build` serverless routes, so `/socket.io` returns **404**.

Deploy the **full app** on a platform that supports a custom Node server:

| Platform | How |
|----------|-----|
| [Render](https://render.com) | Connect repo → use included `render.yaml` |
| [Railway](https://railway.app) | Connect repo → start command `npm run start` |
| [Fly.io](https://fly.io) | `fly launch` with included `Dockerfile` |
| VPS / Docker | `docker build -t grapevibe . && docker run -p 3000:3000 grapevibe` |

```bash
npm run build
npm run start   # runs server.ts (Next.js + Socket.IO)
```

Set `NEXT_PUBLIC_APP_URL` to your public URL (e.g. `https://grapevibe.onrender.com`).

You can keep a Vercel project only for redirects or marketing pages — not for the watch-party app itself.

## Stack

Next.js · Socket.IO · Zustand · Piped/Invidious search (no YouTube API key)

## Dev

```bash
npm install
npm run dev
```

Set `NEXT_PUBLIC_APP_URL` in production for canonical URLs in SEO metadata.

See **[Hosting](#hosting-important)** above — do not deploy the room app to Vercel.

## Documentation

Full product docs: **[docs/GRAPEVIBE.md](docs/GRAPEVIBE.md)**  
**Deployment (Render + Vercel): [docs/DEPLOY.md](docs/DEPLOY.md)**
