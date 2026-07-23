import { Conversation } from "@elevenlabs/client";
import "./styles.css";

const AGENT_ID = "agent_7201ky2fs4xtfwg9tn2x641n318p";
const BRANCH_ID =
  import.meta.env.VITE_BRANCH_ID === "false"
    ? ""
    : (import.meta.env.VITE_BRANCH_ID ?? "agtbrch_4301ky2fs5b2f3rs50hn9sq987d7");

// Agent lives on EU data residency (eu.residency.elevenlabs.io) — global api.elevenlabs.io returns 404.
const API_ORIGIN =
  import.meta.env.VITE_ELEVENLABS_API_ORIGIN ?? "https://api.eu.residency.elevenlabs.io";
const LIVEKIT_URL =
  import.meta.env.VITE_ELEVENLABS_LIVEKIT_URL ?? "wss://livekit.rtc.eu.residency.elevenlabs.io";

const CONVAI_TOKEN_SOURCE = "js_sdk";
const CONVAI_TOKEN_VERSION = "1.2.1";

/** Optional absolute API origin (e.g. https://agents-test-mockup.onrender.com). Empty = same origin. */
const API_BASE = String(import.meta.env.VITE_API_BASE || "").replace(/\/$/, "");

function apiUrl(path) {
  return `${API_BASE}${path}`;
}

const LLM_LABELS = {
  "gemini-2.5-flash": "Gemini 2.5 Flash",
  "gemini-2.5-flash-lite": "Gemini 2.5 Flash Lite",
  "gemini-2.0-flash": "Gemini 2.0 Flash",
  "gpt-4o": "GPT-4o",
  "gpt-4o-mini": "GPT-4o Mini",
  "claude-sonnet-4": "Claude Sonnet 4",
  "claude-3-5-sonnet": "Claude 3.5 Sonnet",
};

const TTS_LABELS = {
  eleven_v3: "Eleven v3",
  eleven_v3_conversational: "Eleven v3 Conversational",
  eleven_flash_v2_5: "Eleven Flash v2.5",
  eleven_turbo_v2_5: "Eleven Turbo v2.5",
  eleven_multilingual_v2: "Eleven Multilingual v2",
};

const els = {
  languageSelect: document.getElementById("languageSelect"),
  systemPrompt: document.getElementById("systemPrompt"),
  firstMessage: document.getElementById("firstMessage"),
  llmSelect: document.getElementById("llmSelect"),
  resetAgentConfigBtn: document.getElementById("resetAgentConfigBtn"),
  resetVoiceBtn: document.getElementById("resetVoiceBtn"),
  startBtn: document.getElementById("startBtn"),
  stopBtn: document.getElementById("stopBtn"),
  connStatus: document.getElementById("connStatus"),
  modeStatus: document.getElementById("modeStatus"),
  errorBox: document.getElementById("errorBox"),
  callSurface: document.querySelector(".call-surface"),
  callLabel: document.getElementById("callLabel"),
  modeLine: document.getElementById("modeLine"),
  voiceVolume: document.getElementById("voiceVolume"),
  voiceVolumeOut: document.getElementById("voiceVolumeOut"),
  voiceId: document.getElementById("voiceId"),
  ttsModelSelect: document.getElementById("ttsModelSelect"),
  stability: document.getElementById("stability"),
  stabilityOut: document.getElementById("stabilityOut"),
  speed: document.getElementById("speed"),
  speedOut: document.getElementById("speedOut"),
  similarityBoost: document.getElementById("similarityBoost"),
  similarityOut: document.getElementById("similarityOut"),
  agentFetchStatus: document.getElementById("agentFetchStatus"),
  agentConfigBadge: document.getElementById("agentConfigBadge"),
  voiceConfigBadge: document.getElementById("voiceConfigBadge"),
  llmFoot: document.getElementById("llmFoot"),
  ttsFoot: document.getElementById("ttsFoot"),
  ttsQcText: document.getElementById("ttsQcText"),
  ttsQcGenerateBtn: document.getElementById("ttsQcGenerateBtn"),
  ttsQcStopBtn: document.getElementById("ttsQcStopBtn"),
  ttsQcAudio: document.getElementById("ttsQcAudio"),
  ttsQcError: document.getElementById("ttsQcError"),
  ttsQcMeta: document.getElementById("ttsQcMeta"),
  instructionsModal: document.getElementById("instructionsModal"),
  openInstructionsBtn: document.getElementById("openInstructionsBtn"),
  closeInstructionsBtn: document.getElementById("closeInstructionsBtn"),
  dismissInstructionsBtn: document.getElementById("dismissInstructionsBtn"),
  confirmModal: document.getElementById("confirmModal"),
  confirmMessage: document.getElementById("confirmMessage"),
  confirmOkBtn: document.getElementById("confirmOkBtn"),
  confirmCancelBtn: document.getElementById("confirmCancelBtn"),
  confirmCloseBtn: document.getElementById("confirmCloseBtn"),
};

let conversation = null;
let ttsObjectUrl = null;
let liveConfigLoaded = false;

/** Live defaults from last successful /api/agent-config fetch — used by Reset buttons. */
let loadedDefaults = null;
let configSource = { agent: "loading", voice: "loading" };

const committedClientChoices = {
  language: "",
  llm: "",
};

function syncCommittedClientChoices() {
  committedClientChoices.language = els.languageSelect.value;
  committedClientChoices.llm = els.llmSelect.value;
}

/** Suppress Language/LLM confirmation while applying programmatic select updates. */
let suppressClientChoiceGuard = false;

function withSuppressedClientChoiceGuard(fn) {
  suppressClientChoiceGuard = true;
  try {
    fn();
  } finally {
    suppressClientChoiceGuard = false;
  }
}

function ensureSelectOption(select, value, label = value) {
  if (!value) return;
  const exists = [...select.options].some((opt) => opt.value === value);
  if (!exists) {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = label;
    select.appendChild(opt);
  }
  select.value = value;
}

function setBadge(el, source) {
  if (!el) return;
  el.classList.remove("badge-live", "badge-error", "badge-mock", "badge-muted");
  if (source === "live") {
    el.textContent = "Live";
    el.classList.add("badge-live");
  } else if (source === "loading") {
    el.textContent = "…";
    el.classList.add("badge-muted");
  } else {
    el.textContent = "Unavailable";
    el.classList.add("badge-error");
  }
}

function formatFixed(value, digits = 2) {
  return Number(value).toFixed(digits);
}

function syncRangeOutputs() {
  els.voiceVolumeOut.textContent = formatFixed(els.voiceVolume.value);
  els.stabilityOut.textContent = formatFixed(els.stability.value);
  els.speedOut.textContent = formatFixed(els.speed.value);
  els.similarityOut.textContent = formatFixed(els.similarityBoost.value);
}

function updateFooters() {
  const llm = els.llmSelect.value;
  const tts = els.ttsModelSelect.value;
  els.llmFoot.textContent = llm
    ? `LLM: ${LLM_LABELS[llm] || llm} · session override`
    : "LLM: — · waiting for live config";
  els.ttsFoot.textContent = tts
    ? `${TTS_LABELS[tts] || tts} · session voice settings`
    : "TTS: — · waiting for live config";
  els.ttsQcMeta.textContent = `Uses Voice ID “${els.voiceId.value || "—"}”, model ${
    TTS_LABELS[tts] || tts || "—"
  }, stability ${formatFixed(els.stability.value)}, speed ${formatFixed(
    els.speed.value
  )}, similarity ${formatFixed(els.similarityBoost.value)}.`;
}

function setConfigFieldsEnabled(enabled) {
  const fields = [
    els.languageSelect,
    els.systemPrompt,
    els.firstMessage,
    els.llmSelect,
    els.resetAgentConfigBtn,
    els.resetVoiceBtn,
    els.voiceVolume,
    els.voiceId,
    els.ttsModelSelect,
    els.stability,
    els.speed,
    els.similarityBoost,
    els.ttsQcGenerateBtn,
    els.ttsQcText,
  ];
  for (const el of fields) {
    if (el) el.disabled = !enabled;
  }
  els.startBtn.disabled = !enabled;
}

function clearFormToEmptyState() {
  withSuppressedClientChoiceGuard(() => {
    els.systemPrompt.value = "";
    els.systemPrompt.defaultValue = "";
    els.firstMessage.value = "";
    els.voiceId.value = "";
    els.languageSelect.selectedIndex = -1;
    els.llmSelect.selectedIndex = -1;
    els.ttsModelSelect.selectedIndex = -1;
    els.voiceVolume.value = 0;
    els.stability.value = 0;
    els.speed.value = 0.7;
    els.similarityBoost.value = 0;
  });
  syncRangeOutputs();
  updateFooters();
  syncCommittedClientChoices();
}

function applyLoadedDefaultsToForm() {
  if (!loadedDefaults) {
    clearFormToEmptyState();
    setBadge(els.agentConfigBadge, configSource.agent);
    setBadge(els.voiceConfigBadge, configSource.voice);
    return;
  }

  const d = loadedDefaults;
  withSuppressedClientChoiceGuard(() => {
    if (d.language) ensureSelectOption(els.languageSelect, d.language);
    els.systemPrompt.defaultValue = d.prompt || "";
    els.systemPrompt.value = els.systemPrompt.defaultValue;
    els.firstMessage.value = d.firstMessage || "";
    if (d.llm) ensureSelectOption(els.llmSelect, d.llm, LLM_LABELS[d.llm] || d.llm);

    if (d.voice.volume != null) els.voiceVolume.value = d.voice.volume;
    els.voiceId.value = d.voice.voiceId || "";
    if (d.voice.modelId) {
      ensureSelectOption(
        els.ttsModelSelect,
        d.voice.modelId,
        TTS_LABELS[d.voice.modelId] || d.voice.modelId
      );
    }
    if (d.voice.stability != null) els.stability.value = d.voice.stability;
    if (d.voice.speed != null) els.speed.value = d.voice.speed;
    if (d.voice.similarityBoost != null) els.similarityBoost.value = d.voice.similarityBoost;
  });

  syncRangeOutputs();
  updateFooters();
  syncCommittedClientChoices();
  setBadge(els.agentConfigBadge, configSource.agent);
  setBadge(els.voiceConfigBadge, configSource.voice);
}

function readSessionConfig() {
  return {
    language: els.languageSelect.value,
    prompt: els.systemPrompt.value.trim(),
    firstMessage: els.firstMessage.value.trim(),
    llm: els.llmSelect.value,
    voice: {
      volume: Number(els.voiceVolume.value),
      voiceId: els.voiceId.value.trim(),
      modelId: els.ttsModelSelect.value,
      stability: Number(els.stability.value),
      speed: Number(els.speed.value),
      similarityBoost: Number(els.similarityBoost.value),
    },
  };
}

/**
 * Session-only overrides for Conversation.startSession.
 * Never persisted to the ElevenLabs agent (no PUT/PATCH).
 */
function buildOverrides(cfg) {
  const overrides = {
    agent: {
      language: cfg.language,
    },
    tts: {},
  };

  const promptText = cfg.prompt.trim();
  if (promptText || cfg.llm) {
    overrides.agent.prompt = {};
    if (promptText) overrides.agent.prompt.prompt = promptText;
    if (cfg.llm) overrides.agent.prompt.llm = cfg.llm;
  }
  if (cfg.firstMessage) {
    overrides.agent.firstMessage = cfg.firstMessage;
  }
  if (cfg.voice.voiceId) overrides.tts.voiceId = cfg.voice.voiceId;
  if (cfg.voice.modelId) overrides.tts.modelId = cfg.voice.modelId;
  if (Number.isFinite(cfg.voice.stability)) overrides.tts.stability = cfg.voice.stability;
  if (Number.isFinite(cfg.voice.speed)) overrides.tts.speed = cfg.voice.speed;
  if (Number.isFinite(cfg.voice.similarityBoost)) {
    overrides.tts.similarityBoost = cfg.voice.similarityBoost;
  }

  if (!Object.keys(overrides.tts).length) delete overrides.tts;

  return overrides;
}

function showError(msg) {
  if (!msg) {
    els.errorBox.hidden = true;
    els.errorBox.textContent = "";
    return;
  }
  els.errorBox.hidden = false;
  els.errorBox.textContent = msg;
}

function showTtsQcError(msg) {
  if (!msg) {
    els.ttsQcError.hidden = true;
    els.ttsQcError.textContent = "";
    return;
  }
  els.ttsQcError.hidden = false;
  els.ttsQcError.textContent = msg;
}

function parseTokenResponse(text, httpStatus) {
  if (!text) {
    throw new Error(`Token HTTP ${httpStatus}`);
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(text.slice(0, 200) || `Token HTTP ${httpStatus}`);
  }
  if (!data.token) {
    throw new Error("API response is missing the token field");
  }
  return data.token;
}

async function fetchConversationTokenFromDevServer() {
  const res = await fetch(apiUrl("/api/token"));
  const text = await res.text();
  if (!res.ok) {
    let detail = text;
    try {
      const j = JSON.parse(text);
      detail = j.detail?.map((d) => d.msg).join("; ") || JSON.stringify(j);
    } catch {
      /* raw text */
    }
    throw new Error(detail || `Token HTTP ${res.status}`);
  }
  return parseTokenResponse(text, res.status);
}

async function fetchConversationTokenFromBrowser() {
  const url = new URL(`${API_ORIGIN}/v1/convai/conversation/token`);
  url.searchParams.set("agent_id", AGENT_ID);
  if (BRANCH_ID) {
    url.searchParams.set("branch_id", BRANCH_ID);
  }
  url.searchParams.set("source", CONVAI_TOKEN_SOURCE);
  url.searchParams.set("version", CONVAI_TOKEN_VERSION);

  const res = await fetch(url.toString());
  const text = await res.text();
  if (!res.ok) {
    let detail = text;
    try {
      const j = JSON.parse(text);
      detail = j.detail?.map((d) => d.msg).join("; ") || JSON.stringify(j);
    } catch {
      /* raw text */
    }
    throw new Error(detail || `Token HTTP ${res.status}`);
  }
  return parseTokenResponse(text, res.status);
}

function isGitHubPagesHost() {
  return typeof location !== "undefined" && /\.github\.io$/i.test(location.hostname);
}

/** Dev proxy, production Express (Render), or explicit VITE_API_BASE — never put XI_API_KEY in the client. */
function shouldUseTokenServer() {
  if (String(import.meta.env.VITE_API_BASE || "").trim()) return true;
  if (import.meta.env.DEV) {
    return import.meta.env.VITE_DEV_USE_TOKEN_SERVER !== "false";
  }
  // Production on same-origin Node host (Render). Static GitHub Pages has no /api.
  return !isGitHubPagesHost();
}

function setSessionControlsDisabled(disabled) {
  const fields = [
    els.languageSelect,
    els.systemPrompt,
    els.firstMessage,
    els.llmSelect,
    els.resetAgentConfigBtn,
    els.resetVoiceBtn,
    els.voiceId,
    els.ttsModelSelect,
    els.stability,
    els.speed,
    els.similarityBoost,
  ];
  for (const el of fields) {
    if (el) el.disabled = disabled;
  }
  // Volume stays editable live via conversation.setVolume.
  els.voiceVolume.disabled = false;
}

function buildCallbacks(cfg) {
  return {
    onConnect: async () => {
      els.connStatus.textContent = "Connected";
      els.stopBtn.disabled = false;
      setSessionControlsDisabled(true);
      setCallUi("active", cfg);
      try {
        if (conversation?.setVolume) {
          await conversation.setVolume({ volume: cfg.voice.volume });
        }
      } catch (err) {
        console.warn("setVolume failed", err);
      }
    },
    onDisconnect: () => {
      els.connStatus.textContent = "Disconnected";
      els.startBtn.disabled = !liveConfigLoaded;
      els.stopBtn.disabled = true;
      els.modeStatus.textContent = "—";
      setSessionControlsDisabled(false);
      if (!liveConfigLoaded) setConfigFieldsEnabled(false);
      conversation = null;
      setCallUi("idle", cfg);
    },
    onError: (err) => {
      console.error(err);
      showError(typeof err === "string" ? err : err?.message || String(err));
    },
    onModeChange: ({ mode }) => {
      els.modeStatus.textContent = mode === "speaking" ? "Speaking" : "Listening";
      if (els.callSurface?.dataset.state === "active" && els.modeLine) {
        els.modeLine.textContent =
          mode === "speaking"
            ? "Agent is speaking — wait for your turn."
            : "Listening — speak when ready.";
      }
    },
  };
}

function setCallUi(state, cfg = readSessionConfig()) {
  if (!els.callSurface) return;
  els.callSurface.dataset.state = state;
  if (!els.callLabel || !els.modeLine) return;
  if (state === "idle") {
    els.callLabel.textContent = liveConfigLoaded ? "Ready to connect" : "Waiting for live config";
    els.modeLine.textContent = !liveConfigLoaded
      ? "Load agent settings from ElevenLabs before starting a session."
      : "Microphone access is requested when you start.";
  } else if (state === "connecting") {
    els.callLabel.textContent = "Connecting…";
    els.modeLine.textContent = "Grant microphone access if the browser asks.";
  } else if (state === "active") {
    els.callLabel.textContent = "Live session";
    els.modeLine.textContent = "Speak naturally — session overrides from this page apply now.";
  }
}

function pickPromptFromAgent(agent) {
  const prompt = agent?.conversation_config?.agent?.prompt;
  if (typeof prompt === "string") return prompt;
  if (prompt && typeof prompt === "object" && prompt.prompt) return prompt.prompt;
  return null;
}

/** Map live ElevenLabs agent + widget payloads into UI fields. No repo mock fills. */
function mapAgentPayload(agent, widget) {
  const cfg = agent?.conversation_config || {};
  const agentCfg = cfg.agent || {};
  const promptObj = agentCfg.prompt || {};
  const tts = cfg.tts || {};
  const widgetCfg = widget?.widget_config || widget || {};

  const promptRaw =
    (typeof promptObj === "string" ? promptObj : promptObj?.prompt) ||
    pickPromptFromAgent(agent) ||
    "";

  const toNum = (v) => (v == null || v === "" ? null : Number(v));

  return {
    prompt: String(promptRaw).trim(),
    firstMessage: agentCfg.first_message ?? "",
    language: agentCfg.language ?? "",
    llm: (typeof promptObj === "object" && promptObj.llm) || "",
    voice: {
      volume: toNum(widgetCfg.volume ?? tts.volume),
      voiceId: tts.voice_id || "",
      modelId: tts.model_id || "",
      stability: toNum(tts.stability),
      speed: toNum(tts.speed),
      similarityBoost: toNum(tts.similarity_boost),
    },
  };
}

function markConfigUnavailable(reason) {
  liveConfigLoaded = false;
  loadedDefaults = null;
  configSource = { agent: "error", voice: "error" };
  clearFormToEmptyState();
  setConfigFieldsEnabled(false);
  setBadge(els.agentConfigBadge, "error");
  setBadge(els.voiceConfigBadge, "error");
  els.agentFetchStatus.textContent = `Could not load live settings: ${reason}`;
  setCallUi("idle");
  showError(
    `Live agent config unavailable: ${reason}. Ensure XI_API_KEY is set on the server (Render env / local .env) and the API can reach ElevenLabs. No repository mock defaults are used.`
  );
}

async function loadAgentConfig() {
  liveConfigLoaded = false;
  loadedDefaults = null;
  configSource = { agent: "loading", voice: "loading" };
  setBadge(els.agentConfigBadge, "loading");
  setBadge(els.voiceConfigBadge, "loading");
  setConfigFieldsEnabled(false);
  clearFormToEmptyState();
  els.agentFetchStatus.textContent = "Loading live agent config…";
  showError(null);

  try {
    const res = await fetch(apiUrl("/api/agent-config"));
    const data = await res.json().catch(() => ({}));

    if (!res.ok || !data.agent) {
      const reason =
        data.error ||
        data.detail ||
        (res.status === 503
          ? "XI_API_KEY missing or agent fetch unavailable"
          : `Agent fetch HTTP ${res.status}`);
      markConfigUnavailable(reason);
      return;
    }

    const mapped = mapAgentPayload(data.agent, data.widget);
    loadedDefaults = mapped;
    liveConfigLoaded = true;
    configSource = {
      agent: "live",
      voice: data.agent?.conversation_config?.tts ? "live" : "error",
    };
    applyLoadedDefaultsToForm();
    setConfigFieldsEnabled(true);
    els.agentFetchStatus.textContent = `Loaded live from agent ${data.agent_id || AGENT_ID}${
      data.branch_id || BRANCH_ID ? " · branch" : ""
    }.`;
    setCallUi("idle");
  } catch (err) {
    console.warn(err);
    markConfigUnavailable(
      err instanceof Error ? err.message : "Token server unreachable"
    );
  }
}

async function startConversation() {
  showError(null);

  if (!liveConfigLoaded) {
    showError("Cannot start: live agent config has not been loaded.");
    return;
  }

  const cfg = readSessionConfig();
  if (!cfg.language) {
    showError("Select a language before starting the call.");
    return;
  }

  els.startBtn.disabled = true;
  setCallUi("connecting", cfg);

  try {
    // Session-only: overrides are passed to startSession and never written back to the agent.
    const overrides = buildOverrides(cfg);
    const callbacks = buildCallbacks(cfg);
    const residency = { origin: API_ORIGIN, livekitUrl: LIVEKIT_URL };

    if (shouldUseTokenServer()) {
      const conversationToken = await fetchConversationTokenFromDevServer();
      conversation = await Conversation.startSession({
        conversationToken,
        ...residency,
        overrides,
        ...callbacks,
      });
      return;
    }

    if (import.meta.env.VITE_USE_WEBSOCKET === "true") {
      conversation = await Conversation.startSession({
        agentId: AGENT_ID,
        connectionType: "websocket",
        ...residency,
        overrides,
        ...callbacks,
      });
      return;
    }

    if (import.meta.env.VITE_USE_AGENT_ID_ONLY === "true") {
      conversation = await Conversation.startSession({
        agentId: AGENT_ID,
        ...residency,
        overrides,
        ...callbacks,
      });
      return;
    }

    // GitHub Pages: same transport as pjatk workshop pages (WebSocket + agentId) — WebRTC often dies here.
    // Optional: VITE_PAGES_FORCE_WEBRTC=true in build to use token+branch+WebRTC on github.io anyway.
    if (isGitHubPagesHost() && import.meta.env.VITE_PAGES_FORCE_WEBRTC !== "true") {
      conversation = await Conversation.startSession({
        agentId: AGENT_ID,
        connectionType: "websocket",
        ...residency,
        overrides,
        ...callbacks,
      });
      return;
    }

    const conversationToken = await fetchConversationTokenFromBrowser();
    conversation = await Conversation.startSession({
      conversationToken,
      ...residency,
      overrides,
      ...callbacks,
    });
  } catch (e) {
    console.error(e);
    showError(e instanceof Error ? e.message : String(e));
    els.startBtn.disabled = !liveConfigLoaded;
    els.stopBtn.disabled = true;
    setCallUi("idle", cfg);
  }
}

async function stopConversation() {
  if (conversation) {
    await conversation.endSession();
    conversation = null;
  }
}

async function generateTtsQc() {
  showTtsQcError(null);
  const text = els.ttsQcText.value.trim();
  if (!text) {
    showTtsQcError("Paste a sentence to regenerate.");
    return;
  }

  if (!liveConfigLoaded) {
    showTtsQcError("Load live agent config before running TTS QC.");
    return;
  }

  const cfg = readSessionConfig();
  if (!cfg.voice.voiceId) {
    showTtsQcError("Voice ID is empty — check live agent TTS settings.");
    return;
  }
  if (!cfg.voice.modelId) {
    showTtsQcError("TTS model is empty — check live agent TTS settings.");
    return;
  }

  els.ttsQcGenerateBtn.disabled = true;
  els.ttsQcStopBtn.disabled = false;

  try {
    const res = await fetch(apiUrl("/api/tts"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        voiceId: cfg.voice.voiceId,
        modelId: cfg.voice.modelId,
        stability: cfg.voice.stability,
        speed: cfg.voice.speed,
        similarityBoost: cfg.voice.similarityBoost,
      }),
    });

    if (!res.ok) {
      let detail = await res.text();
      try {
        const j = JSON.parse(detail);
        detail = j.error || j.detail || detail;
      } catch {
        /* raw */
      }
      throw new Error(
        detail ||
          `TTS HTTP ${res.status}. Set XI_API_KEY on the server for live QC playback.`
      );
    }

    const blob = await res.blob();
    if (ttsObjectUrl) URL.revokeObjectURL(ttsObjectUrl);
    ttsObjectUrl = URL.createObjectURL(blob);
    els.ttsQcAudio.hidden = false;
    els.ttsQcAudio.src = ttsObjectUrl;
    await els.ttsQcAudio.play();
  } catch (err) {
    console.error(err);
    showTtsQcError(err instanceof Error ? err.message : String(err));
  } finally {
    els.ttsQcGenerateBtn.disabled = !liveConfigLoaded;
    // Stop only stays enabled while audio is actually playing.
    els.ttsQcStopBtn.disabled = els.ttsQcAudio.paused;
  }
}

function stopTtsQc() {
  els.ttsQcAudio.pause();
  els.ttsQcAudio.currentTime = 0;
  els.ttsQcStopBtn.disabled = true;
}

// —— UI wiring ——
els.resetAgentConfigBtn.addEventListener("click", () => {
  if (!loadedDefaults) return;
  withSuppressedClientChoiceGuard(() => {
    if (loadedDefaults.language) {
      ensureSelectOption(els.languageSelect, loadedDefaults.language);
    }
    if (loadedDefaults.llm) {
      ensureSelectOption(
        els.llmSelect,
        loadedDefaults.llm,
        LLM_LABELS[loadedDefaults.llm] || loadedDefaults.llm
      );
    }
    els.systemPrompt.defaultValue = loadedDefaults.prompt || "";
    els.systemPrompt.value = els.systemPrompt.defaultValue;
    els.firstMessage.value = loadedDefaults.firstMessage || "";
  });
  syncCommittedClientChoices();
  updateFooters();
});

els.resetVoiceBtn.addEventListener("click", () => {
  if (!loadedDefaults) return;
  if (loadedDefaults.voice.volume != null) els.voiceVolume.value = loadedDefaults.voice.volume;
  els.voiceId.value = loadedDefaults.voice.voiceId || "";
  if (loadedDefaults.voice.modelId) {
    ensureSelectOption(
      els.ttsModelSelect,
      loadedDefaults.voice.modelId,
      TTS_LABELS[loadedDefaults.voice.modelId] || loadedDefaults.voice.modelId
    );
  }
  if (loadedDefaults.voice.stability != null) {
    els.stability.value = loadedDefaults.voice.stability;
  }
  if (loadedDefaults.voice.speed != null) els.speed.value = loadedDefaults.voice.speed;
  if (loadedDefaults.voice.similarityBoost != null) {
    els.similarityBoost.value = loadedDefaults.voice.similarityBoost;
  }
  syncRangeOutputs();
  updateFooters();
});

for (const range of [els.voiceVolume, els.stability, els.speed, els.similarityBoost]) {
  range.addEventListener("input", () => {
    syncRangeOutputs();
    updateFooters();
  });
}

els.voiceId.addEventListener("input", updateFooters);
els.ttsModelSelect.addEventListener("change", updateFooters);

let confirmResolver = null;
let activeModal = null;

function setAppBlurred(open) {
  document.body.classList.toggle("modal-open", open);
}

function closeConfirmModal(result) {
  if (!els.confirmModal || els.confirmModal.hidden) return;
  els.confirmModal.hidden = true;
  if (activeModal === "confirm") {
    activeModal = null;
    setAppBlurred(false);
  }
  const resolve = confirmResolver;
  confirmResolver = null;
  resolve?.(result);
}

function askClientChoiceConfirm(fieldLabel) {
  return new Promise((resolve) => {
    if (!els.confirmModal) {
      resolve(
        window.confirm(
          `${fieldLabel} is set by the client. Change it for this session only?`
        )
      );
      return;
    }
    if (confirmResolver) {
      confirmResolver(false);
      confirmResolver = null;
    }
    confirmResolver = resolve;
    els.confirmMessage.textContent = `${fieldLabel} comes from the client agent. Changing it only affects the next session on this page — nothing is saved back to the agent. Continue?`;
    els.confirmModal.hidden = false;
    activeModal = "confirm";
    setAppBlurred(true);
    els.confirmCancelBtn?.focus();
  });
}

function guardClientChoiceSelect(select, fieldKey, fieldLabel) {
  select.addEventListener("change", async () => {
    if (suppressClientChoiceGuard) {
      updateFooters();
      return;
    }
    const next = select.value;
    if (next === committedClientChoices[fieldKey]) {
      updateFooters();
      return;
    }
    const ok = await askClientChoiceConfirm(fieldLabel);
    if (!ok) {
      // Revert only if still on this pending value; a newer change may have moved it.
      if (select.value === next) {
        withSuppressedClientChoiceGuard(() => {
          select.value = committedClientChoices[fieldKey];
        });
      }
      updateFooters();
      return;
    }
    committedClientChoices[fieldKey] = next;
    updateFooters();
  });
}

guardClientChoiceSelect(els.languageSelect, "language", "Language");
guardClientChoiceSelect(els.llmSelect, "llm", "LLM");

els.confirmOkBtn?.addEventListener("click", () => closeConfirmModal(true));
els.confirmCancelBtn?.addEventListener("click", () => closeConfirmModal(false));
els.confirmCloseBtn?.addEventListener("click", () => closeConfirmModal(false));
els.confirmModal?.querySelector("[data-close-confirm]")?.addEventListener("click", () =>
  closeConfirmModal(false)
);

els.voiceVolume.addEventListener("change", async () => {
  if (!conversation?.setVolume) return;
  try {
    await conversation.setVolume({ volume: Number(els.voiceVolume.value) });
  } catch (err) {
    console.warn(err);
  }
});

els.ttsQcGenerateBtn.addEventListener("click", generateTtsQc);
els.ttsQcStopBtn.addEventListener("click", stopTtsQc);
els.ttsQcAudio.addEventListener("play", () => {
  els.ttsQcStopBtn.disabled = false;
});
els.ttsQcAudio.addEventListener("ended", () => {
  els.ttsQcStopBtn.disabled = true;
});

els.startBtn.addEventListener("click", startConversation);
els.stopBtn.addEventListener("click", stopConversation);

function openInstructionsModal() {
  if (!els.instructionsModal) return;
  if (activeModal === "confirm") closeConfirmModal(false);
  els.instructionsModal.hidden = false;
  activeModal = "instructions";
  setAppBlurred(true);
  (els.closeInstructionsBtn || els.dismissInstructionsBtn)?.focus();
}

function closeInstructionsModal() {
  if (!els.instructionsModal || els.instructionsModal.hidden) return;
  els.instructionsModal.hidden = true;
  if (activeModal === "instructions") {
    activeModal = null;
    setAppBlurred(false);
  }
  els.openInstructionsBtn?.focus();
}

els.openInstructionsBtn?.addEventListener("click", openInstructionsModal);
els.closeInstructionsBtn?.addEventListener("click", closeInstructionsModal);
els.dismissInstructionsBtn?.addEventListener("click", closeInstructionsModal);
els.instructionsModal?.querySelector("[data-close-instructions]")?.addEventListener("click", closeInstructionsModal);

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (activeModal === "confirm") {
    closeConfirmModal(false);
    return;
  }
  if (activeModal === "instructions") {
    closeInstructionsModal();
  }
});

setConfigFieldsEnabled(false);
loadAgentConfig();
