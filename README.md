# Bluff Party — Discord Activity

**Bluff Party** is a Fibbage-style party game for Discord voice channels. Write convincing lies, vote for the truth, and fool your friends — the same kind of game people love in **Jackbox**, **Gartic Phone**, and **Sketch Heads** on Discord.

## Why this game?

- Works great with **3–12 players** in voice
- **No video streaming** — pure social fun, reliable in Discord Activities
- Short rounds, lots of laughs, easy to pick up
- Built on Colyseus + Discord Embedded App SDK

## How to play

1. Join a **voice channel** and open the Activity
2. Wait for **3+ players** — host taps **Start game**
3. **Submit** a fake answer to the prompt
4. **Vote** for what you think is the real answer
5. Score **+2** for finding truth, **+1** for each friend fooled by your lie
6. **5 rounds** — highest score wins

## Development

```bash
npm install
npm run start:server   # port 2567
npm run start:client   # Vite
```

Set `VITE_DISCORD_CLIENT_ID` (client) and `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `JWT_SECRET` (server).

## Deploy

Deploy **client** (Vercel) and **server** (Railway) together. Room name: `my_room`, one game per voice `channelId`.
