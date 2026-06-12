"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const tools_1 = require("@colyseus/tools");
const app_config_1 = __importDefault(require("./app.config"));
const port = Number(process.env.PORT || 2567);
function checkProductionEnv() {
    if (process.env.NODE_ENV !== "production")
        return;
    const missing = [];
    if (!process.env.JWT_SECRET)
        missing.push("JWT_SECRET");
    if (!process.env.DISCORD_CLIENT_ID)
        missing.push("DISCORD_CLIENT_ID");
    if (!process.env.DISCORD_CLIENT_SECRET)
        missing.push("DISCORD_CLIENT_SECRET");
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
(0, tools_1.listen)(app_config_1.default, port)
    .then(() => {
    console.log(`✅ Watch Together server listening on port ${port}`);
    console.log(`   Health check: GET /health`);
})
    .catch((err) => {
    console.error("❌ Server failed to start:", err);
    process.exit(1);
});
