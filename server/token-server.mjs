import "dotenv/config";
import express from "express";

const app = express();
const PORT = Number(process.env.TOKEN_SERVER_PORT || 3456);

const AGENT_ID =
  process.env.AGENT_ID || "agent_7201ky2fs4xtfwg9tn2x641n318p";
const BRANCH_ID =
  process.env.BRANCH_ID || "agtbrch_4301ky2fs5b2f3rs50hn9sq987d7";
const API_ORIGIN =
  process.env.ELEVENLABS_API_ORIGIN || "https://api.eu.residency.elevenlabs.io";

/**
 * WebRTC token with optional branch_id (see API: GET /v1/convai/conversation/token).
 * If the agent is public, XI_API_KEY may be omitted and the request is still attempted.
 */
app.get("/api/token", async (req, res) => {
  try {
    const url = new URL(`${API_ORIGIN}/v1/convai/conversation/token`);
    url.searchParams.set("agent_id", AGENT_ID);
    if (BRANCH_ID) {
      url.searchParams.set("branch_id", BRANCH_ID);
    }

    const headers = {};
    if (process.env.XI_API_KEY) {
      headers["xi-api-key"] = process.env.XI_API_KEY;
    }

    const upstream = await fetch(url.toString(), { headers });
    const text = await upstream.text();
    if (!upstream.ok) {
      return res.status(upstream.status).type("application/json").send(text);
    }
    res.type("application/json").send(text);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.listen(PORT, () => {
  console.log(`Token server http://127.0.0.1:${PORT} (agent ${AGENT_ID}, ${API_ORIGIN})`);
});
