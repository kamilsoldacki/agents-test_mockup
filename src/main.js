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
  textInputEnabled: document.getElementById("textInputEnabled"),
  conversationModeToggleEnabled: document.getElementById("conversationModeToggleEnabled"),
  modeToggleWrap: document.getElementById("modeToggleWrap"),
  modeVoiceBtn: document.getElementById("modeVoiceBtn"),
  modeTextBtn: document.getElementById("modeTextBtn"),
  chatPanel: document.getElementById("chatPanel"),
  chatLog: document.getElementById("chatLog"),
  chatForm: document.getElementById("chatForm"),
  chatInput: document.getElementById("chatInput"),
  chatSendBtn: document.getElementById("chatSendBtn"),
  chatModeBadge: document.getElementById("chatModeBadge"),
  agentFetchStatus: document.getElementById("agentFetchStatus"),
  agentConfigBadge: document.getElementById("agentConfigBadge"),
  voiceConfigBadge: document.getElementById("voiceConfigBadge"),
  widgetConfigBadge: document.getElementById("widgetConfigBadge"),
  llmFoot: document.getElementById("llmFoot"),
  ttsFoot: document.getElementById("ttsFoot"),
  ttsQcText: document.getElementById("ttsQcText"),
  ttsQcGenerateBtn: document.getElementById("ttsQcGenerateBtn"),
  ttsQcStopBtn: document.getElementById("ttsQcStopBtn"),
  ttsQcAudio: document.getElementById("ttsQcAudio"),
  ttsQcError: document.getElementById("ttsQcError"),
  ttsQcMeta: document.getElementById("ttsQcMeta"),
};

let conversation = null;
let preferredConversationMode = "voice"; // voice | text
let ttsObjectUrl = null;
let liveConfigLoaded = false;

/** Live defaults from last successful /api/agent-config fetch — used by Reset buttons. */
let loadedDefaults = null;
let configSource = { agent: "loading", voice: "loading", widget: "loading" };

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
    els.textInputEnabled,
    els.conversationModeToggleEnabled,
    els.ttsQcGenerateBtn,
    els.ttsQcText,
  ];
  for (const el of fields) {
    if (el) el.disabled = !enabled;
  }
  els.startBtn.disabled = !enabled;
}

function clearFormToEmptyState() {
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
  els.textInputEnabled.checked = false;
  els.conversationModeToggleEnabled.checked = false;
  syncRangeOutputs();
  updateFooters();
  syncMultimodalUi();
}

function applyLoadedDefaultsToForm() {
  if (!loadedDefaults) {
    clearFormToEmptyState();
    setBadge(els.agentConfigBadge, configSource.agent);
    setBadge(els.voiceConfigBadge, configSource.voice);
    setBadge(els.widgetConfigBadge, configSource.widget);
    return;
  }

  const d = loadedDefaults;
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

  if (d.widget.textInputEnabled != null) {
    els.textInputEnabled.checked = Boolean(d.widget.textInputEnabled);
  }
  if (d.widget.conversationModeToggleEnabled != null) {
    els.conversationModeToggleEnabled.checked = Boolean(d.widget.conversationModeToggleEnabled);
  }

  syncRangeOutputs();
  updateFooters();
  syncMultimodalUi();
  setBadge(els.agentConfigBadge, configSource.agent);
  setBadge(els.voiceConfigBadge, configSource.voice);
  setBadge(els.widgetConfigBadge, configSource.widget);
}

function syncMultimodalUi() {
  const textOn = els.textInputEnabled.checked;
  const toggleOn = els.conversationModeToggleEnabled.checked;

  els.modeToggleWrap.hidden = !toggleOn;
  els.chatPanel.hidden = !textOn && preferredConversationMode !== "text";

  if (!toggleOn) {
    preferredConversationMode = "voice";
  }

  els.modeVoiceBtn.classList.toggle("is-active", preferredConversationMode === "voice");
  els.modeTextBtn.classList.toggle("is-active", preferredConversationMode === "text");

  const live = Boolean(conversation);
  const textOnlySession = preferredConversationMode === "text";
  els.chatModeBadge.textContent = textOnlySession
    ? "Text only"
    : textOn
      ? "Voice + text"
      : "Voice only";

  const canType = live && (textOn || textOnlySession);
  els.chatInput.disabled = !canType;
  els.chatSendBtn.disabled = !canType;

  if (!textOn && preferredConversationMode !== "text") {
    clearChatLog("Enable text input to use multimodal chat.");
  } else if (!els.chatLog.querySelector(".chat-bubble") && !els.chatLog.querySelector(".chat-empty")) {
    clearChatLog("Messages appear here during the session.");
  }
}

function clearChatLog(emptyText = "Messages appear here during the session.") {
  els.chatLog.innerHTML = "";
  const empty = document.createElement("p");
  empty.className = "chat-empty";
  empty.textContent = emptyText;
  els.chatLog.appendChild(empty);
}

function appendChatMessage(role, text) {
  if (!text) return;
  const empty = els.chatLog.querySelector(".chat-empty");
  if (empty) empty.remove();

  const bubble = document.createElement("div");
  bubble.className = "chat-bubble";
  bubble.dataset.role = role;
  const roleEl = document.createElement("span");
  roleEl.className = "chat-role";
  roleEl.textContent = role === "user" ? "You" : "Agent";
  const body = document.createElement("div");
  body.textContent = text;
  bubble.append(roleEl, body);
  els.chatLog.appendChild(bubble);
  els.chatLog.scrollTop = els.chatLog.scrollHeight;
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
    textInputEnabled: els.textInputEnabled.checked,
    conversationModeToggleEnabled: els.conversationModeToggleEnabled.checked,
    textOnly: preferredConversationMode === "text",
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
    conversation: {},
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
  if (cfg.textOnly) {
    overrides.conversation.textOnly = true;
  }

  if (!Object.keys(overrides.tts).length) delete overrides.tts;
  if (!Object.keys(overrides.conversation).length) delete overrides.conversation;

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
  const res = await fetch("/api/token");
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
    els.textInputEnabled,
    els.conversationModeToggleEnabled,
    els.modeVoiceBtn,
    els.modeTextBtn,
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
      syncMultimodalUi();
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
      syncMultimodalUi();
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
            ? "Agent is speaking — wait for your turn (or type if text input is on)."
            : "Listening — talk or type.";
      }
    },
    onMessage: ({ message, source }) => {
      const text = typeof message === "string" ? message : message?.message || message?.text;
      if (!text) return;
      const role = source === "user" || message?.role === "user" ? "user" : "agent";
      appendChatMessage(role, text);
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
      : cfg.textOnly
        ? "Text-only session — microphone will not be requested."
        : "Microphone access is requested when you start.";
  } else if (state === "connecting") {
    els.callLabel.textContent = "Connecting…";
    els.modeLine.textContent = cfg.textOnly
      ? "Starting text session…"
      : "Grant microphone access if the browser asks.";
  } else if (state === "active") {
    els.callLabel.textContent = "Live session";
    els.modeLine.textContent = cfg.textOnly
      ? "Text mode — type below. Agent replies in chat (and audio if not text-only)."
      : "Speak naturally — session overrides from the left apply now.";
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
    widget: {
      textInputEnabled:
        widgetCfg.text_input_enabled == null ? null : Boolean(widgetCfg.text_input_enabled),
      conversationModeToggleEnabled:
        widgetCfg.conversation_mode_toggle_enabled == null
          ? null
          : Boolean(widgetCfg.conversation_mode_toggle_enabled),
    },
  };
}

function markConfigUnavailable(reason) {
  liveConfigLoaded = false;
  loadedDefaults = null;
  configSource = { agent: "error", voice: "error", widget: "error" };
  clearFormToEmptyState();
  setConfigFieldsEnabled(false);
  setBadge(els.agentConfigBadge, "error");
  setBadge(els.voiceConfigBadge, "error");
  setBadge(els.widgetConfigBadge, "error");
  els.agentFetchStatus.textContent = `Could not load live settings: ${reason}`;
  setCallUi("idle");
  showError(
    `Live agent config unavailable: ${reason}. Set XI_API_KEY in .env and ensure the token server can reach ElevenLabs. No repository mock defaults are used.`
  );
}

async function loadAgentConfig() {
  liveConfigLoaded = false;
  loadedDefaults = null;
  configSource = { agent: "loading", voice: "loading", widget: "loading" };
  setBadge(els.agentConfigBadge, "loading");
  setBadge(els.voiceConfigBadge, "loading");
  setBadge(els.widgetConfigBadge, "loading");
  setConfigFieldsEnabled(false);
  clearFormToEmptyState();
  els.agentFetchStatus.textContent = "Loading live agent config…";
  showError(null);

  try {
    const res = await fetch("/api/agent-config");
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
      widget: data.widget ? "live" : "error",
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
  clearChatLog(cfg.textInputEnabled || cfg.textOnly ? "Connecting…" : "Voice-only session.");
  setCallUi("connecting", cfg);
  syncMultimodalUi();

  try {
    // Session-only: overrides are passed to startSession and never written back to the agent.
    const overrides = buildOverrides(cfg);
    const callbacks = buildCallbacks(cfg);
    const residency = { origin: API_ORIGIN, livekitUrl: LIVEKIT_URL };
    const textOnly = Boolean(cfg.textOnly);

    const useLocalTokenServer =
      import.meta.env.DEV && import.meta.env.VITE_DEV_USE_TOKEN_SERVER !== "false";
    if (useLocalTokenServer) {
      const conversationToken = await fetchConversationTokenFromDevServer();
      conversation = await Conversation.startSession({
        conversationToken,
        ...residency,
        overrides,
        textOnly,
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
        textOnly,
        ...callbacks,
      });
      return;
    }

    if (import.meta.env.VITE_USE_AGENT_ID_ONLY === "true") {
      conversation = await Conversation.startSession({
        agentId: AGENT_ID,
        ...residency,
        overrides,
        textOnly,
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
        textOnly,
        ...callbacks,
      });
      return;
    }

    const conversationToken = await fetchConversationTokenFromBrowser();
    conversation = await Conversation.startSession({
      conversationToken,
      ...residency,
      overrides,
      textOnly,
      ...callbacks,
    });
  } catch (e) {
    console.error(e);
    showError(e instanceof Error ? e.message : String(e));
    els.startBtn.disabled = !liveConfigLoaded;
    els.stopBtn.disabled = true;
    setCallUi("idle", cfg);
    syncMultimodalUi();
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
    const res = await fetch("/api/tts", {
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
          `TTS HTTP ${res.status}. Set XI_API_KEY in .env for live QC playback.`
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
els.llmSelect.addEventListener("change", updateFooters);

els.textInputEnabled.addEventListener("change", syncMultimodalUi);
els.conversationModeToggleEnabled.addEventListener("change", syncMultimodalUi);

els.modeVoiceBtn.addEventListener("click", () => {
  preferredConversationMode = "voice";
  syncMultimodalUi();
  setCallUi(els.callSurface.dataset.state || "idle");
});
els.modeTextBtn.addEventListener("click", () => {
  preferredConversationMode = "text";
  syncMultimodalUi();
  setCallUi(els.callSurface.dataset.state || "idle");
});

els.chatForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const text = els.chatInput.value.trim();
  if (!text || !conversation) return;
  try {
    conversation.sendUserMessage(text);
    appendChatMessage("user", text);
    els.chatInput.value = "";
  } catch (err) {
    showError(err instanceof Error ? err.message : String(err));
  }
});

els.chatInput.addEventListener("input", () => {
  try {
    conversation?.sendUserActivity?.();
  } catch {
    /* ignore */
  }
});

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

clearChatLog();
setConfigFieldsEnabled(false);
loadAgentConfig();
