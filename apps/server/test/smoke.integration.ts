/**
 * Integration smoke test — run against a live server:
 *   npx tsx test/smoke.integration.ts [baseUrl]
 * Default: http://localhost:2567
 */
import assert from "assert";
import { Client } from "@colyseus/sdk";
import type { WatchRoomState } from "../src/rooms/WatchRoom";

const BASE = process.argv[2] ?? "http://localhost:2567";
const WS_BASE = BASE.replace(/^http/, "ws");
const CHANNEL = "123456789012345678";

function wait(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  console.log(`Smoke testing ${BASE} ...`);

  const health = await fetch(`${BASE}/health`);
  assert.strictEqual(health.status, 200);
  const healthBody = await health.json();
  assert.strictEqual(healthBody.ok, true);
  console.log("✓ GET /health");

  const tokenRes = await fetch(`${BASE}/discord_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: "mock_code" }),
  });
  assert.strictEqual(tokenRes.status, 200);
  const { token, user } = await tokenRes.json();
  assert.ok(token);
  assert.ok(user?.id);
  console.log("✓ POST /discord_token (mock_code)");

  const searchRes = await fetch(`${BASE}/api/youtube/search?q=test`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.ok(searchRes.status === 503 || searchRes.status === 200);
  console.log(`✓ GET /api/youtube/search (status ${searchRes.status})`);

  const unauth = await fetch(`${BASE}/api/youtube/search?q=test`);
  assert.strictEqual(unauth.status, 401);
  console.log("✓ GET /api/youtube/search rejects missing auth");

  const client = new Client(WS_BASE);
  client.auth.token = token;

  const room = await client.joinOrCreate<WatchRoomState>("my_room", {
    channelId: CHANNEL,
  });
  assert.ok(room.sessionId);
  console.log("✓ joinOrCreate watch_room");

  await wait(200);
  assert.strictEqual(room.state.hostSessionId, room.sessionId);
  console.log("✓ host assigned correctly");

  room.send("loadVideo", { videoId: "dQw4w9WgXcQ", title: "Smoke Test" });
  await wait(300);
  assert.strictEqual(room.state.videoId, "dQw4w9WgXcQ");
  console.log("✓ loadVideo updates room state");

  room.send("addToQueue", { videoId: "9bZkp7q19f0", title: "Queued" });
  await wait(200);
  assert.strictEqual(room.state.queue.length, 1);
  console.log("✓ addToQueue works");

  await room.leave();
  console.log("\nAll smoke tests passed.");
  process.exit(0);
}

main().catch((err) => {
  console.error("\nSmoke test FAILED:", err.message ?? err);
  process.exit(1);
});
