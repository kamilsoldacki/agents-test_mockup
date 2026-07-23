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

app.use(express.json({ limit: "1mb" }));

function apiHeaders() {
  const headers = {};
  if (process.env.XI_API_KEY) {
    headers["xi-api-key"] = process.env.XI_API_KEY;
  }
  return headers;
}

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

    const upstream = await fetch(url.toString(), { headers: apiHeaders() });
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

/**
 * Live agent + widget config for the review UI.
 * Always fetched from ElevenLabs. Requires XI_API_KEY. Never returns repo mock defaults.
 * Read-only: GET only — nothing here writes or patches the agent.
 */
app.get("/api/agent-config", async (req, res) => {
  if (!process.env.XI_API_KEY) {
    return res.status(503).json({
      error: "XI_API_KEY not set — cannot load live agent config. Add it to .env and restart.",
      agent_id: AGENT_ID,
      branch_id: BRANCH_ID || null,
    });
  }

  try {
    const agentUrl = new URL(`${API_ORIGIN}/v1/convai/agents/${AGENT_ID}`);
    if (BRANCH_ID) {
      agentUrl.searchParams.set("branch_id", BRANCH_ID);
    }

    const widgetUrl = new URL(`${API_ORIGIN}/v1/convai/agents/${AGENT_ID}/widget`);
    if (BRANCH_ID) {
      widgetUrl.searchParams.set("branch_id", BRANCH_ID);
    }

    const headers = apiHeaders();
    const [agentRes, widgetRes] = await Promise.all([
      fetch(agentUrl.toString(), { headers }),
      fetch(widgetUrl.toString(), { headers }),
    ]);

    const agentText = await agentRes.text();
    if (!agentRes.ok) {
      return res.status(agentRes.status).json({
        error: agentText.slice(0, 500) || `Agent HTTP ${agentRes.status}`,
        agent_id: AGENT_ID,
      });
    }

    let agent;
    try {
      agent = JSON.parse(agentText);
    } catch {
      return res.status(502).json({ error: "Invalid agent JSON from upstream" });
    }

    let widget = null;
    if (widgetRes.ok) {
      try {
        widget = JSON.parse(await widgetRes.text());
      } catch {
        widget = null;
      }
    }

    res.json({
      agent_id: AGENT_ID,
      branch_id: BRANCH_ID || null,
      agent,
      widget,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e?.message || e) });
  }
});

/**
 * TTS QC: regenerate a sentence with the voice settings currently shown in the UI.
 * POST { text, voiceId, modelId, stability, speed, similarityBoost }
 * All voice fields are required from the client — no repo constant defaults.
 */
app.post("/api/tts", async (req, res) => {
  if (!process.env.XI_API_KEY) {
    return res.status(503).json({
      error: "XI_API_KEY not set — cannot generate TTS for QC. Add it to .env and restart npm run dev.",
    });
  }

  const { text, voiceId, modelId, stability, speed, similarityBoost } = req.body || {};

  if (!text || typeof text !== "string") {
    return res.status(400).json({ error: "Missing text" });
  }
  if (!voiceId || typeof voiceId !== "string") {
    return res.status(400).json({ error: "Missing voiceId" });
  }
  if (!modelId || typeof modelId !== "string") {
    return res.status(400).json({ error: "Missing modelId" });
  }
  if (!Number.isFinite(Number(stability))) {
    return res.status(400).json({ error: "Missing or invalid stability" });
  }
  if (!Number.isFinite(Number(speed))) {
    return res.status(400).json({ error: "Missing or invalid speed" });
  }
  if (!Number.isFinite(Number(similarityBoost))) {
    return res.status(400).json({ error: "Missing or invalid similarityBoost" });
  }

  try {
    const url = new URL(`${API_ORIGIN}/v1/text-to-speech/${encodeURIComponent(voiceId)}`);
    url.searchParams.set("output_format", "mp3_44100_128");

    const upstream = await fetch(url.toString(), {
      method: "POST",
      headers: {
        ...apiHeaders(),
        Accept: "audio/mpeg",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text,
        model_id: modelId,
        voice_settings: {
          stability: Number(stability),
          similarity_boost: Number(similarityBoost),
          speed: Number(speed),
        },
      }),
    });

    if (!upstream.ok) {
      const errText = await upstream.text();
      return res.status(upstream.status).json({
        error: errText.slice(0, 800) || `TTS HTTP ${upstream.status}`,
      });
    }

    const buffer = Buffer.from(await upstream.arrayBuffer());
    res.setHeader("Content-Type", upstream.headers.get("content-type") || "audio/mpeg");
    res.setHeader("Cache-Control", "no-store");
    res.send(buffer);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.listen(PORT, () => {
  console.log(`Token server http://127.0.0.1:${PORT} (agent ${AGENT_ID}, ${API_ORIGIN})`);
  console.log(
    process.env.XI_API_KEY
      ? "XI_API_KEY set — /api/agent-config (live GET) and /api/tts enabled"
      : "XI_API_KEY missing — /api/agent-config and /api/tts will return 503 (no mock fallback)"
  );
});
