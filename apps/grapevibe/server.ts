import { createServer } from "http";
import { parse } from "url";
import next from "next";
import { initSocketServer } from "./src/server/socket";

const port = parseInt(process.env.PORT || "3000", 10);
const bindHost = process.env.BIND_HOST || "0.0.0.0";
const dev = process.env.NODE_ENV !== "production";

// Do not pass hostname/port to next() — using "0.0.0.0" breaks static asset serving.
const app = next({ dev });
const handle = app.getRequestHandler();

app
  .prepare()
  .then(() => {
    const httpServer = createServer((req, res) => {
      const parsedUrl = parse(req.url!, true);
      void handle(req, res, parsedUrl).catch((err: unknown) => {
        console.error("Request error:", req.url, err);
        if (!res.headersSent) {
          res.statusCode = 500;
          res.end("Internal Server Error");
        }
      });
    });

    initSocketServer(httpServer);

    httpServer.listen(port, bindHost, () => {
      console.log(
        `Grapevibe ready → http://${bindHost}:${port} (${dev ? "development" : "production"})`
      );
    });
  })
  .catch((err: unknown) => {
    console.error("Failed to start Grapevibe:", err);
    process.exit(1);
  });
