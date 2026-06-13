import { defineServer, defineRoom, WebSocketTransport } from "colyseus";
import { monitor } from "@colyseus/monitor";
import { playground } from "@colyseus/playground";
import { JWT } from "@colyseus/auth";
import express from "express";

/**
 * Import your Room files
 */
import { MyRoom } from "./rooms/MyRoom";
import youtubeRoutes from "./routes/youtube";
import { securityHeaders } from "./utils/securityHeaders";

export default defineServer({
    rooms: {
        // Production Railway uses "my_room" — single room name per voice channel (filterBy channelId)
        my_room: defineRoom(MyRoom, {
            filterBy: ['channelId'],
        } as { channelId?: string }),
    },

    /** Discord Activities background tabs may miss WS pings — use a lenient heartbeat. */
    transport: new WebSocketTransport({
        pingInterval: 25_000,
        pingMaxRetries: 24,
    }),

    express: (app) => {
        app.use(securityHeaders);
        app.use(express.json({ limit: "16kb" }));

        app.get("/", (_req, res) => {
            res.json({ ok: true, service: "watch-together" });
        });

        app.get("/health", (_req, res) => {
            res.json({
                ok: true,
                service: "watch-together",
                uptime: Math.floor(process.uptime()),
            });
        });

        app.get("/hello_world", (_req, res) => {
            res.send("It's time to kick ass and chew bubblegum!");
        });

        app.use("/api/youtube", youtubeRoutes);

        //
        // Discord Embedded SDK: Retrieve user token when under Discord/Embed
        //
        app.post('/discord_token', async (req, res) => {
          // Mock auth only in development for local browser testing
          if (
            process.env.NODE_ENV !== "production" &&
            req.body?.code === "mock_code"
          ) {
            const user = {
              id: Math.random().toString(36).slice(2, 10),
              username: `User ${Math.random().toString().slice(2, 10)}`,
            };
            res.send({ access_token: "mocked", token: await JWT.sign(user), user });
            return;
          }

          if (typeof req.body?.code !== "string" || req.body.code.length > 512) {
            res.status(400).send({ error: "Invalid authorization code" });
            return;
          }

          if (!process.env.DISCORD_CLIENT_ID || !process.env.DISCORD_CLIENT_SECRET) {
            res.status(500).send({ error: "Server misconfigured" });
            return;
          }

          try {
            //
            // Retrieve access token from Discord API
            //
            const response = await fetch(`https://discord.com/api/oauth2/token`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
              },
              body: new URLSearchParams({
                client_id: process.env.DISCORD_CLIENT_ID,
                client_secret: process.env.DISCORD_CLIENT_SECRET,
                code: req.body.code,
                grant_type: 'authorization_code',
              }),
            });

            const tokenData = await response.json();
            if (!response.ok || !tokenData.access_token) {
              res.status(401).send({ error: "Discord token exchange failed" });
              return;
            }
            const { access_token } = tokenData;

            //
            // Retrieve user data from Discord API
            // https://discord.com/developers/docs/resources/user#user-object
            //
            const profileResponse = await fetch(`https://discord.com/api/users/@me`, {
              method: "GET",
              headers: {
                'Authorization': `Bearer ${access_token}`,
              }
            });
            const profile = await profileResponse.json();
            if (!profileResponse.ok || !profile.id) {
              res.status(401).send({ error: "Failed to fetch Discord profile" });
              return;
            }

            const user = {
              id: profile.id,
              username: profile.username,
              avatar: profile.avatar ?? "",
            };

            res.send({
              access_token, // Discord Access Token
              token: await JWT.sign(user), // Colyseus JWT token
              user // User data
            });

          } catch (e: any) {
            res.status(400).send({ error: e.message });
          }
        });

        /**
         * Use @colyseus/playground
         * (It is not recommended to expose this route in a production environment)
         */
        if (process.env.NODE_ENV !== "production") {
            app.use("/", playground());
        }

        /**
         * Use @colyseus/monitor
         * It is recommended to protect this route with a password
         * Read more: https://docs.colyseus.io/tools/monitor/#restrict-access-to-the-panel-using-a-password
         */
        if (process.env.NODE_ENV !== "production") {
            app.use("/colyseus", monitor());
        }

        //
        // See more about the Authentication Module:
        // https://docs.colyseus.io/authentication/
        //
        // app.use(auth.prefix, auth.routes())
        //
    },
});
