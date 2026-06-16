# UNO Party — Discord Activity

**UNO Party** is a multiplayer UNO card game for Discord voice channels. Play **Classic UNO** or **UNO No Mercy** with **2–10 players** in the same voice channel — built on Colyseus + Discord Embedded App SDK.

## Game modes

### Classic UNO
Standard rules: match color or number, action cards (+2, Skip, Reverse), Wild and Wild +4, +2 stacking.

### UNO No Mercy
Harder variant with +1/+5 draw cards, Skip Everyone, Wild Draw +2, Wild Draw Color, and special 0/1/7 rules (simplified from the official deck).

## How to play

1. Join a **voice channel** and open the Activity
2. Wait for **2+ players** — host picks **Classic UNO** or **UNO No Mercy**
3. On your turn, **play a matching card** or **draw**
4. Tap **UNO!** when you have one card left — others can **Catch!** if you forget
5. First player to empty their hand **wins**

## Development

```bash
npm install
npm run start:server   # port 2567
npm run start:client   # Vite
```

Set `VITE_DISCORD_CLIENT_ID` (client) and `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `JWT_SECRET` (server).

## Deploy

Deploy **client** (Vercel) and **server** (Railway) together. Room name: `my_room`, one game per voice `channelId`.
