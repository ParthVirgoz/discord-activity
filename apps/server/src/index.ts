import { listen } from "@colyseus/tools";
import app from "./app.config";

const port = Number(process.env.PORT || 2567);

function checkProductionEnv(): void {
  if (process.env.NODE_ENV !== "production") return;

  const missing: string[] = [];
  if (!process.env.JWT_SECRET) missing.push("JWT_SECRET");
  if (!process.env.DISCORD_CLIENT_ID) missing.push("DISCORD_CLIENT_ID");
  if (!process.env.DISCORD_CLIENT_SECRET) missing.push("DISCORD_CLIENT_SECRET");

  if (missing.length > 0) {
    console.error("❌ Missing required Railway environment variables:");
    for (const name of missing) {
      console.error(`   - ${name}`);
    }
    console.error("Add them in Railway → your service → Variables → Redeploy.");
    process.exit(1);
  }
}

checkProductionEnv();

listen(app, port)
  .then(() => {
    console.log(`✅ Watch Together server listening on port ${port}`);
    console.log(`   Health check: GET /health`);
  })
  .catch((err) => {
    console.error("❌ Server failed to start:", err);
    process.exit(1);
  });
