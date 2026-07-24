import "dotenv/config";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const distDir = path.join(rootDir, "dist");

const app = express();
// Render / Railway / Fly inject PORT. Local dev keeps TOKEN_SERVER_PORT (default 3456).
const PORT = Number(process.env.PORT || process.env.TOKEN_SERVER_PORT || 3456);
const HOST = process.env.HOST || "0.0.0.0";

const DEFAULT_AGENT_ID =
  process.env.AGENT_ID || "agent_7201ky2fs4xtfwg9tn2x641n318p";
const BRANCH_ID =
  process.env.BRANCH_ID || "agtbrch_4301ky2fs5b2f3rs50hn9sq987d7";

/**
 * Region endpoints + API keys:
 * - Global: XI_API_KEY_GLOBAL  → https://api.elevenlabs.io
 * - EU:     XI_API_KEY_EU (preferred) or legacy XI_API_KEY → https://api.eu.residency.elevenlabs.io
 * Client passes ?residency=global|eu (POST /api/tts: body.residency).
 */
const REGION_PRESETS = {
  global: {
    id: "global",
    origin: "https://api.elevenlabs.io",
    keyEnvPreferred: "XI_API_KEY_GLOBAL",
  },
  eu: {
    id: "eu",
    origin: "https://api.eu.residency.elevenlabs.io",
    keyEnvPreferred: "XI_API_KEY_EU",
  },
};

function normalizeResidency(value) {
  const raw = String(value || "")
    .trim()
    .toLowerCase();
  if (raw === "global" || raw === "us") return "global";
  if (raw === "eu" || raw === "eu-residency") return "eu";
  return "";
}

function resolveResidency(req) {
  const fromQuery = normalizeResidency(req.query?.residency);
  if (fromQuery) return fromQuery;
  const fromBody = normalizeResidency(req.body?.residency);
  if (fromBody) return fromBody;
  return "eu";
}

function resolveRegion(req) {
  const residency = resolveResidency(req);
  const preset = REGION_PRESETS[residency];
  let apiKey = "";
  let keyEnv = preset.keyEnvPreferred;

  if (residency === "global") {
    apiKey = String(process.env.XI_API_KEY_GLOBAL || "").trim();
    keyEnv = "XI_API_KEY_GLOBAL";
  } else {
    // EU: prefer XI_API_KEY_EU; fall back to XI_API_KEY for existing Render/local setups.
    if (String(process.env.XI_API_KEY_EU || "").trim()) {
      apiKey = String(process.env.XI_API_KEY_EU).trim();
      keyEnv = "XI_API_KEY_EU";
    } else if (String(process.env.XI_API_KEY || "").trim()) {
      apiKey = String(process.env.XI_API_KEY).trim();
      keyEnv = "XI_API_KEY";
    } else {
      keyEnv = "XI_API_KEY_EU";
    }
  }

  return {
    residency,
    origin: preset.origin,
    apiKey,
    keyEnv,
  };
}

function resolveAgentId(req) {
  const fromQuery = String(req.query?.agent_id || "").trim();
  if (/^agent_[a-zA-Z0-9]+$/.test(fromQuery)) {
    return fromQuery;
  }
  return DEFAULT_AGENT_ID;
}

function missingKeyError(region) {
  if (region.residency === "global") {
    return "XI_API_KEY_GLOBAL not set — cannot call the global ElevenLabs API for the selected region.";
  }
  return "XI_API_KEY_EU (or legacy XI_API_KEY) not set — cannot call the EU residency API for the selected region.";
}

app.use(express.json({ limit: "1mb" }));

/**
 * CORS for cross-origin clients (e.g. GitHub Pages → Render via VITE_API_BASE).
 * Client fetch uses default credentials (omit), so * is safe. Never reflects secrets.
 */
app.use("/api", (req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }
  next();
});

function apiHeaders(apiKey) {
  const headers = {};
  if (apiKey) {
    headers["xi-api-key"] = apiKey;
  }
  return headers;
}

/** Liveness for Render health checks — never returns the API key. */
app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    has_xi_api_key_global: Boolean(String(process.env.XI_API_KEY_GLOBAL || "").trim()),
    has_xi_api_key_eu: Boolean(
      String(process.env.XI_API_KEY_EU || process.env.XI_API_KEY || "").trim()
    ),
    // Back-compat for older monitors
    has_xi_api_key: Boolean(
      String(
        process.env.XI_API_KEY_GLOBAL ||
          process.env.XI_API_KEY_EU ||
          process.env.XI_API_KEY ||
          ""
      ).trim()
    ),
    agent_id: DEFAULT_AGENT_ID,
    regions: {
      global: REGION_PRESETS.global.origin,
      eu: REGION_PRESETS.eu.origin,
    },
  });
});

/**
 * WebRTC token with optional branch_id (see API: GET /v1/convai/conversation/token).
 * If the agent is public, the matching regional key may be omitted and the request is still attempted.
 * Optional query: agent_id, residency=global|eu (falls back to env AGENT_ID / EU).
 */
app.get("/api/token", async (req, res) => {
  try {
    const agentId = resolveAgentId(req);
    const region = resolveRegion(req);
    const url = new URL(`${region.origin}/v1/convai/conversation/token`);
    url.searchParams.set("agent_id", agentId);
    if (BRANCH_ID) {
      url.searchParams.set("branch_id", BRANCH_ID);
    }

    const upstream = await fetch(url.toString(), {
      headers: apiHeaders(region.apiKey),
    });
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
 * Always fetched from ElevenLabs. Requires the API key for the selected residency.
 * Never returns repo mock defaults. Read-only: GET only.
 * Optional query: agent_id, residency=global|eu.
 */
app.get("/api/agent-config", async (req, res) => {
  const agentId = resolveAgentId(req);
  const region = resolveRegion(req);

  if (!region.apiKey) {
    return res.status(503).json({
      error: missingKeyError(region),
      agent_id: agentId,
      branch_id: BRANCH_ID || null,
      residency: region.residency,
      key_env: region.keyEnv,
    });
  }

  try {
    const agentUrl = new URL(`${region.origin}/v1/convai/agents/${agentId}`);
    if (BRANCH_ID) {
      agentUrl.searchParams.set("branch_id", BRANCH_ID);
    }

    const widgetUrl = new URL(`${region.origin}/v1/convai/agents/${agentId}/widget`);
    if (BRANCH_ID) {
      widgetUrl.searchParams.set("branch_id", BRANCH_ID);
    }

    const headers = apiHeaders(region.apiKey);
    const [agentRes, widgetRes] = await Promise.all([
      fetch(agentUrl.toString(), { headers }),
      fetch(widgetUrl.toString(), { headers }),
    ]);

    const agentText = await agentRes.text();
    if (!agentRes.ok) {
      return res.status(agentRes.status).json({
        error: agentText.slice(0, 500) || `Agent HTTP ${agentRes.status}`,
        agent_id: agentId,
        residency: region.residency,
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
      agent_id: agentId,
      branch_id: BRANCH_ID || null,
      residency: region.residency,
      agent,
      widget,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e?.message || e) });
  }
});

/** Agents-only models have no standalone TTS API — map to the closest HTTP TTS model. */
const TTS_QC_MODEL_FALLBACK = {
  eleven_v3_conversational: "eleven_v3",
};

function resolveTtsQcModelId(modelId) {
  return TTS_QC_MODEL_FALLBACK[modelId] || modelId;
}

/**
 * TTS QC: regenerate a sentence with the voice settings currently shown in the UI.
 * POST { text, voiceId, modelId, stability, speed, similarityBoost, residency? }
 * All voice fields are required from the client — no repo constant defaults.
 */
app.post("/api/tts", async (req, res) => {
  const region = resolveRegion(req);

  if (!region.apiKey) {
    return res.status(503).json({
      error: missingKeyError(region),
      residency: region.residency,
      key_env: region.keyEnv,
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

  const ttsModelId = resolveTtsQcModelId(modelId);

  try {
    const url = new URL(
      `${region.origin}/v1/text-to-speech/${encodeURIComponent(voiceId)}`
    );
    url.searchParams.set("output_format", "mp3_44100_128");

    const upstream = await fetch(url.toString(), {
      method: "POST",
      headers: {
        ...apiHeaders(region.apiKey),
        Accept: "audio/mpeg",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text,
        model_id: ttsModelId,
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
        residency: region.residency,
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

// Production: serve the Vite build from the same origin as /api/* (no key in static assets).
const distReady = fs.existsSync(path.join(distDir, "index.html"));
if (distReady) {
  app.use(express.static(distDir, { index: false, maxAge: "1h" }));
  app.get(/^(?!\/api\/).*/, (_req, res) => {
    res.sendFile(path.join(distDir, "index.html"));
  });
}

app.listen(PORT, HOST, () => {
  const euKey = Boolean(String(process.env.XI_API_KEY_EU || process.env.XI_API_KEY || "").trim());
  const globalKey = Boolean(String(process.env.XI_API_KEY_GLOBAL || "").trim());
  console.log(
    `Token server http://${HOST}:${PORT} (default agent ${DEFAULT_AGENT_ID}, dual-region)`
  );
  console.log(
    globalKey
      ? "XI_API_KEY_GLOBAL set — global region enabled"
      : "XI_API_KEY_GLOBAL missing — residency=global will return 503 for agent-config/tts"
  );
  console.log(
    euKey
      ? "XI_API_KEY_EU (or legacy XI_API_KEY) set — EU region enabled"
      : "XI_API_KEY_EU / XI_API_KEY missing — residency=eu will return 503 for agent-config/tts"
  );
  console.log(
    distReady
      ? `Serving static UI from ${distDir}`
      : `No dist/ yet — API only (run npm run build for production UI)`
  );
});
