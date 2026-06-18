# Grapevibe deployment guide

Grapevibe needs a **long-running Node server** (`server.ts`) for Socket.IO and in-memory rooms. Use **Render for the backend**, and optionally **Vercel as a frontend** that proxies API + sockets to Render.

---

## 1. Deploy the backend on Render (required)

This is the real app server. Do this first.

### Option A — Blueprint (recommended)

1. Push this repo to GitHub.
2. Open [Render Dashboard](https://dashboard.render.com) → **New** → **Blueprint**.
3. Connect the repo — Render reads `render.yaml` automatically.
4. Set environment variable:
   - `NEXT_PUBLIC_APP_URL` = your Render URL, e.g. `https://watchsync-xxxx.onrender.com`
5. Deploy and wait for **Build** + **Start** to finish.
6. Open the URL — landing page should load **without** 404 errors on `/_next/static/...`.
7. Create a room — connection banner should disappear (Socket.IO connected).

### Option B — Manual web service

| Setting | Value |
|---------|--------|
| **Runtime** | Node |
| **Build command** | `npm ci && npm run build` |
| **Start command** | `npm run start` |
| **Health check** | `/api/health` |

**Environment variables:**

| Variable | Value |
|----------|--------|
| `NODE_ENV` | `production` |
| `BIND_HOST` | `0.0.0.0` |
| `NEXT_PUBLIC_APP_URL` | `https://YOUR-SERVICE.onrender.com` |

**Do not set** `BACKEND_URL` on Render.

### Option C — Docker on Render / Fly.io

```bash
docker build -t grapevibe .
docker run -p 3000:3000 -e NEXT_PUBLIC_APP_URL=http://localhost:3000 grapevibe
```

---

## 2. Deploy the frontend on Vercel (optional)

Use Vercel only if you want a custom domain like `grapevibe.vercel.app`. The **backend must still run on Render**.

### Vercel environment variables

| Variable | Example | Required |
|----------|---------|----------|
| `BACKEND_URL` | `https://watchsync-xxxx.onrender.com` | **Yes** — proxies `/api/*` and `/socket.io/*` to Render |
| `NEXT_PUBLIC_APP_URL` | `https://grapevibe.vercel.app` | Yes — SEO / manifest |

**Do not set** `BACKEND_URL` on Render. **Do not set** `HOSTNAME=0.0.0.0` on Render (use `BIND_HOST` instead).

### Vercel project settings

| Setting | Value |
|---------|--------|
| **Framework** | Next.js |
| **Build command** | `npm run build` (default) |
| **Output** | default (not static export) |

After deploy:

1. Visit `https://grapevibe.vercel.app`
2. Create/join a room — should connect (no `/socket.io` 404)
3. If stuck on “Joining room…”, confirm `BACKEND_URL` is set and matches your live Render URL, then **redeploy** Vercel (rewrites are applied at build time).

### Alternative: skip Vercel

Point users directly to your Render URL, or add a custom domain on Render. Simpler and one less moving part.

---

## 3. Troubleshooting

### Render: `/_next/static/chunks/...` 404

Usually caused by:

- **Wrong start command** — must be `npm run start` (runs `server.ts`), not `next start` alone.
- **`HOSTNAME=0.0.0.0` passed to Next.js** — fixed in current `server.ts`; use `BIND_HOST=0.0.0.0` instead.
- **Stale deploy** — in Render, **Clear build cache & deploy**.

### Vercel: `/socket.io` 404

- Set `BACKEND_URL` to your Render service URL (no trailing slash).
- Redeploy Vercel after changing env vars.
- Render free tier sleeps after inactivity — wake it by opening the Render URL first.

### Manifest warning in console

Harmless; fixed by using `id: "/"` in the web manifest.
