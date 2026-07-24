import { Conversation } from "@elevenlabs/client";
import "./styles.css";

/** Per-platform placeholder agents (EU German agent; Global from ElevenLabs talk-to). */
const REGION_DEFAULT_AGENT_IDS = {
  eu: "agent_7201ky2fs4xtfwg9tn2x641n318p",
  global: "agent_0101kp3evekhf25tpfv24b3kf37w",
};

const BRANCH_DISABLED = import.meta.env.VITE_BRANCH_ID === "false";
/** Per-platform branch for token/agent-config; VITE_BRANCH_ID=false disables all. */
const REGION_DEFAULT_BRANCH_IDS = {
  eu: BRANCH_DISABLED
    ? ""
    : (import.meta.env.VITE_BRANCH_ID ?? "agtbrch_4301ky2fs5b2f3rs50hn9sq987d7"),
  global:
    BRANCH_DISABLED || import.meta.env.VITE_BRANCH_ID_GLOBAL === "false"
      ? ""
      : (import.meta.env.VITE_BRANCH_ID_GLOBAL ??
        "agtbrch_5401kp3evewjfdzvg4pzgd3cxcse"),
};

/** Platform / data residency — paired with server XI_API_KEY_GLOBAL vs XI_API_KEY_EU. */
const RESIDENCY_STORAGE_KEY = "productions-elevenlabs-residency";
/** SIMPLY vs DETAILED layout — client-side only, no reload. */
const PAGE_MODE_STORAGE_KEY = "productions-page-mode";
const PAGE_MODES = new Set(["simply", "detailed"]);
const REGION_ENDPOINTS = {
  global: {
    origin: "https://api.elevenlabs.io",
    livekitUrl: "wss://livekit.rtc.elevenlabs.io",
    label: "Global",
  },
  eu: {
    origin: "https://api.eu.residency.elevenlabs.io",
    livekitUrl: "wss://livekit.rtc.eu.residency.elevenlabs.io",
    label: "EU residency",
  },
};

function normalizeAgentId(value) {
  return String(value || "").trim();
}

function isValidAgentId(value) {
  return /^agent_[a-zA-Z0-9]+$/.test(value);
}

function normalizeResidency(value) {
  const raw = String(value || "")
    .trim()
    .toLowerCase();
  if (raw === "global" || raw === "us") return "global";
  if (raw === "eu" || raw === "eu-residency") return "eu";
  return "";
}

function defaultAgentIdFor(residency) {
  const key = normalizeResidency(residency) || "eu";
  return REGION_DEFAULT_AGENT_IDS[key] || REGION_DEFAULT_AGENT_IDS.eu;
}

function branchIdFor(residency) {
  const key = normalizeResidency(residency) || "eu";
  return REGION_DEFAULT_BRANCH_IDS[key] ?? "";
}

function readAgentIdFromUrl() {
  try {
    const fromQuery = new URLSearchParams(window.location.search).get("agent_id");
    const normalized = normalizeAgentId(fromQuery);
    return isValidAgentId(normalized) ? normalized : "";
  } catch {
    return "";
  }
}

function readResidencyFromUrl() {
  try {
    return normalizeResidency(
      new URLSearchParams(window.location.search).get("residency")
    );
  } catch {
    return "";
  }
}

function readResidencyFromStorage() {
  try {
    return normalizeResidency(localStorage.getItem(RESIDENCY_STORAGE_KEY));
  } catch {
    return "";
  }
}

/** Mutable: Global vs EU — URL ?residency= wins over localStorage; default EU (legacy). */
let currentResidency =
  readResidencyFromUrl() || readResidencyFromStorage() || "eu";
/** Mutable: set from the Agent ID field (or URL ?agent_id=) before loading config. */
let currentAgentId = readAgentIdFromUrl() || defaultAgentIdFor(currentResidency);

function getResidencyEndpoints() {
  return REGION_ENDPOINTS[currentResidency] || REGION_ENDPOINTS.eu;
}

function persistResidencyChoice(next) {
  const normalized = normalizeResidency(next) || "eu";
  currentResidency = normalized;
  try {
    localStorage.setItem(RESIDENCY_STORAGE_KEY, normalized);
  } catch {
    /* ignore quota / private mode */
  }
  try {
    const url = new URL(window.location.href);
    url.searchParams.set("residency", normalized);
    if (isValidAgentId(currentAgentId)) {
      url.searchParams.set("agent_id", currentAgentId);
    }
    window.history.replaceState({}, "", url);
  } catch {
    /* ignore */
  }
  const select = document.getElementById("residencySelect");
  if (select) select.value = normalized;
}

function normalizePageMode(value) {
  const raw = String(value || "")
    .trim()
    .toLowerCase();
  if (raw === "simply" || raw === "simple") return "simply";
  if (
    raw === "detailed" ||
    raw === "rozbudowana" ||
    raw === "full" ||
    raw === "expanded"
  ) {
    return "detailed";
  }
  return "";
}

function readPageModeFromStorage() {
  try {
    const raw = localStorage.getItem(PAGE_MODE_STORAGE_KEY);
    const normalized = normalizePageMode(raw);
    // Migrate legacy Polish key so existing users keep DETAILED.
    if (
      normalized === "detailed" &&
      String(raw || "").trim().toLowerCase() === "rozbudowana"
    ) {
      persistPageMode("detailed");
    }
    return normalized;
  } catch {
    return "";
  }
}

function persistPageMode(mode) {
  try {
    localStorage.setItem(PAGE_MODE_STORAGE_KEY, mode);
  } catch {
    /* ignore quota / private mode */
  }
}

/** Apply layout mode without reload. Does not touch form / QC state. */
function setPageMode(mode, { persist = true } = {}) {
  const next = normalizePageMode(mode) || "detailed";
  if (!PAGE_MODES.has(next)) return;
  document.body.classList.toggle("page-mode-simply", next === "simply");
  document.body.classList.toggle("page-mode-detailed", next === "detailed");
  document.body.dataset.pageMode = next;
  if (els.pageModeSimplyBtn) {
    els.pageModeSimplyBtn.setAttribute("aria-pressed", next === "simply" ? "true" : "false");
  }
  if (els.pageModeDetailedBtn) {
    els.pageModeDetailedBtn.setAttribute(
      "aria-pressed",
      next === "detailed" ? "true" : "false"
    );
  }
  if (persist) persistPageMode(next);
}

function initPageModeToggle() {
  const initial = readPageModeFromStorage() || "detailed";
  setPageMode(initial, { persist: true });

  const onClick = (event) => {
    const btn = event.currentTarget;
    const mode = btn?.dataset?.pageMode;
    if (!mode) return;
    setPageMode(mode);
  };
  els.pageModeSimplyBtn?.addEventListener("click", onClick);
  els.pageModeDetailedBtn?.addEventListener("click", onClick);
}

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

/** Display names for ISO 639-1 codes used by Agents language / language_presets. */
const LANGUAGE_LABELS = {
  ar: "Arabic",
  bg: "Bulgarian",
  zh: "Chinese",
  hr: "Croatian",
  cs: "Czech",
  da: "Danish",
  nl: "Dutch",
  en: "English",
  fi: "Finnish",
  fr: "French",
  de: "German",
  el: "Greek",
  hi: "Hindi",
  hu: "Hungarian",
  id: "Indonesian",
  it: "Italian",
  ja: "Japanese",
  ko: "Korean",
  ms: "Malay",
  no: "Norwegian",
  pl: "Polish",
  pt: "Portuguese",
  ro: "Romanian",
  ru: "Russian",
  sk: "Slovak",
  es: "Spanish",
  sv: "Swedish",
  tr: "Turkish",
  uk: "Ukrainian",
  vi: "Vietnamese",
};

/** Agents-only models have no standalone TTS API — map to the closest HTTP TTS model. */
const TTS_QC_MODEL_FALLBACK = {
  eleven_v3_conversational: "eleven_v3",
};

/** Agents docs: expressive_mode / suggested_audio_tags apply to these TTS models. */
const V3_EXPRESSIVE_MODELS = new Set(["eleven_v3_conversational", "eleven_v3"]);

function resolveTtsQcModelId(modelId) {
  return TTS_QC_MODEL_FALLBACK[modelId] || modelId;
}

function isV3ExpressiveModel(modelId) {
  return V3_EXPRESSIVE_MODELS.has(modelId);
}

/** Serialize agent suggested_audio_tags for the Voices textarea. */
function formatSuggestedAudioTags(tags) {
  if (!Array.isArray(tags) || !tags.length) return "";
  return tags
    .map((item) => {
      const tag = String(item?.tag ?? "").trim();
      if (!tag) return "";
      const description = String(item?.description ?? "").trim();
      return description ? `${tag}: ${description}` : tag;
    })
    .filter(Boolean)
    .join("\n");
}

/** Parse textarea lines into Agents SuggestedAudioTag objects (max 20). */
function parseSuggestedAudioTags(text) {
  const lines = String(text || "").split("\n");
  const out = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const sep = trimmed.indexOf(":");
    let tag;
    let description = "";
    if (sep === -1) {
      tag = trimmed;
    } else {
      tag = trimmed.slice(0, sep).trim();
      description = trimmed.slice(sep + 1).trim();
    }
    tag = tag.slice(0, 30);
    if (!tag) continue;
    const entry = { tag };
    if (description) entry.description = description.slice(0, 200);
    out.push(entry);
    if (out.length >= 20) break;
  }
  return out;
}

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
  voiceId: document.getElementById("voiceId"),
  ttsModelSelect: document.getElementById("ttsModelSelect"),
  stability: document.getElementById("stability"),
  stabilityOut: document.getElementById("stabilityOut"),
  speed: document.getElementById("speed"),
  speedOut: document.getElementById("speedOut"),
  similarityBoost: document.getElementById("similarityBoost"),
  similarityOut: document.getElementById("similarityOut"),
  v3ExpressiveFields: document.getElementById("v3ExpressiveFields"),
  expressiveMode: document.getElementById("expressiveMode"),
  suggestedAudioTags: document.getElementById("suggestedAudioTags"),
  agentFetchStatus: document.getElementById("agentFetchStatus"),
  agentIdInput: document.getElementById("agentIdInput"),
  residencySelect: document.getElementById("residencySelect"),
  loadAgentBtn: document.getElementById("loadAgentBtn"),
  agentConfigBadge: document.getElementById("agentConfigBadge"),
  voiceConfigBadge: document.getElementById("voiceConfigBadge"),
  ttsQcText: document.getElementById("ttsQcText"),
  ttsQcGenerateBtn: document.getElementById("ttsQcGenerateBtn"),
  ttsQcAudio: document.getElementById("ttsQcAudio"),
  ttsQcError: document.getElementById("ttsQcError"),
  ttsQcMeta: document.getElementById("ttsQcMeta"),
  qcComments: document.getElementById("qcComments"),
  qcCommentsHint: document.getElementById("qcCommentsHint"),
  qcCommentsField: document.querySelector(".qc-comments-field"),
  qcWordingIssue: document.getElementById("qcWordingIssue"),
  instructionsModal: document.getElementById("instructionsModal"),
  openInstructionsBtn: document.getElementById("openInstructionsBtn"),
  closeInstructionsBtn: document.getElementById("closeInstructionsBtn"),
  dismissInstructionsBtn: document.getElementById("dismissInstructionsBtn"),
  confirmModal: document.getElementById("confirmModal"),
  confirmMessage: document.getElementById("confirmMessage"),
  confirmOkBtn: document.getElementById("confirmOkBtn"),
  confirmCancelBtn: document.getElementById("confirmCancelBtn"),
  confirmCloseBtn: document.getElementById("confirmCloseBtn"),
  alertModal: document.getElementById("alertModal"),
  alertHeading: document.getElementById("alert-heading"),
  alertMessage: document.getElementById("alertMessage"),
  alertOkBtn: document.getElementById("alertOkBtn"),
  alertCloseBtn: document.getElementById("alertCloseBtn"),
  pageModeSimplyBtn: document.getElementById("pageModeSimplyBtn"),
  pageModeDetailedBtn: document.getElementById("pageModeDetailedBtn"),
};

let conversation = null;
let ttsObjectUrl = null;
let liveConfigLoaded = false;

/** Session volume from live agent config; applied via conversation.setVolume on connect (no UI). */
let sessionVoiceVolume = 0.8;

/** Live defaults from last successful /api/agent-config fetch — used by Reset buttons. */
let loadedDefaults = null;
let configSource = { agent: "loading", voice: "loading" };

const committedClientChoices = {
  language: "",
  llm: "",
  voiceId: "",
  modelId: "",
  stability: "",
  speed: "",
  similarityBoost: "",
  expressiveMode: true,
  suggestedAudioTags: "",
};

function syncCommittedClientChoices() {
  committedClientChoices.language = els.languageSelect.value;
  committedClientChoices.llm = els.llmSelect.value;
  committedClientChoices.voiceId = els.voiceId.value;
  committedClientChoices.modelId = els.ttsModelSelect.value;
  committedClientChoices.stability = els.stability.value;
  committedClientChoices.speed = els.speed.value;
  committedClientChoices.similarityBoost = els.similarityBoost.value;
  committedClientChoices.expressiveMode = els.expressiveMode
    ? els.expressiveMode.checked
    : true;
  committedClientChoices.suggestedAudioTags = els.suggestedAudioTags?.value ?? "";
}

/** Suppress Language/LLM/Voices confirmation while applying programmatic updates. */
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

function languageLabel(code) {
  const key = String(code || "").trim().toLowerCase();
  if (!key) return "";
  return LANGUAGE_LABELS[key] || key.toUpperCase();
}

/**
 * Languages available for an agent: default `agent.language` plus
 * keys of `conversation_config.language_presets` (ElevenLabs Additional Languages).
 */
function collectAgentLanguages(agent) {
  const cfg = agent?.conversation_config || {};
  const primary = String(cfg.agent?.language ?? "").trim().toLowerCase();
  const presets = cfg.language_presets;
  const codes = new Set();
  if (primary) codes.add(primary);
  if (presets && typeof presets === "object" && !Array.isArray(presets)) {
    for (const key of Object.keys(presets)) {
      const code = String(key || "").trim().toLowerCase();
      if (code) codes.add(code);
    }
  }
  return [...codes].sort((a, b) => languageLabel(a).localeCompare(languageLabel(b)));
}

/** Replace Language <select> options from agent config; select default language. */
function rebuildLanguageSelect(languages, selected) {
  const select = els.languageSelect;
  if (!select) return;
  const codes = Array.isArray(languages)
    ? languages.map((c) => String(c || "").trim().toLowerCase()).filter(Boolean)
    : [];
  const unique = [...new Set(codes)];
  select.innerHTML = "";
  for (const code of unique) {
    const opt = document.createElement("option");
    opt.value = code;
    opt.textContent = languageLabel(code);
    select.appendChild(opt);
  }
  const pick = String(selected || "").trim().toLowerCase();
  if (pick && unique.includes(pick)) {
    select.value = pick;
  } else if (unique.length) {
    select.selectedIndex = 0;
  } else {
    select.selectedIndex = -1;
  }
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
  els.stabilityOut.textContent = formatFixed(els.stability.value);
  els.speedOut.textContent = formatFixed(els.speed.value);
  els.similarityOut.textContent = formatFixed(els.similarityBoost.value);
}

function syncV3ExpressiveVisibility() {
  const show = isV3ExpressiveModel(els.ttsModelSelect.value);
  if (els.v3ExpressiveFields) {
    els.v3ExpressiveFields.hidden = !show;
  }
}

function updateFooters() {
  els.ttsQcMeta.textContent = liveConfigLoaded
    ? "Plays with the same voice used in the call."
    : "Waiting for call setup…";
  syncV3ExpressiveVisibility();
}

function setConfigFieldsEnabled(enabled) {
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
    els.expressiveMode,
    els.suggestedAudioTags,
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
    rebuildLanguageSelect([], "");
    els.llmSelect.selectedIndex = -1;
    els.ttsModelSelect.selectedIndex = -1;
    sessionVoiceVolume = 0;
    els.stability.value = 0;
    els.speed.value = 0.7;
    els.similarityBoost.value = 0;
    if (els.expressiveMode) els.expressiveMode.checked = true;
    if (els.suggestedAudioTags) els.suggestedAudioTags.value = "";
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
    rebuildLanguageSelect(d.languages, d.language);
    els.systemPrompt.defaultValue = d.prompt || "";
    els.systemPrompt.value = els.systemPrompt.defaultValue;
    els.firstMessage.value = d.firstMessage || "";
    if (d.llm) ensureSelectOption(els.llmSelect, d.llm, LLM_LABELS[d.llm] || d.llm);

    if (d.voice.volume != null) sessionVoiceVolume = d.voice.volume;
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
    if (els.expressiveMode) {
      els.expressiveMode.checked =
        d.voice.expressiveMode == null ? true : Boolean(d.voice.expressiveMode);
    }
    if (els.suggestedAudioTags) {
      els.suggestedAudioTags.value = formatSuggestedAudioTags(d.voice.suggestedAudioTags);
    }
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
      volume: Number(sessionVoiceVolume),
      voiceId: els.voiceId.value.trim(),
      modelId: els.ttsModelSelect.value,
      stability: Number(els.stability.value),
      speed: Number(els.speed.value),
      similarityBoost: Number(els.similarityBoost.value),
      expressiveMode: els.expressiveMode ? els.expressiveMode.checked : true,
      suggestedAudioTags: parseSuggestedAudioTags(els.suggestedAudioTags?.value),
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
  // Agents TTS config fields (camelCase like other SDK overrides). Shown for v3 models.
  if (isV3ExpressiveModel(cfg.voice.modelId)) {
    if (typeof cfg.voice.expressiveMode === "boolean") {
      overrides.tts.expressiveMode = cfg.voice.expressiveMode;
    }
    if (Array.isArray(cfg.voice.suggestedAudioTags)) {
      overrides.tts.suggestedAudioTags = cfg.voice.suggestedAudioTags;
    }
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
  const url = new URL(apiUrl("/api/token"), window.location.origin);
  url.searchParams.set("agent_id", currentAgentId);
  url.searchParams.set("residency", currentResidency);
  const res = await fetch(url.toString());
  const text = await res.text();
  if (!res.ok) {
    let detail = text;
    try {
      const j = JSON.parse(text);
      detail =
        j.error ||
        j.detail?.map?.((d) => d.msg).join("; ") ||
        (Array.isArray(j.detail) ? JSON.stringify(j.detail) : j.detail) ||
        JSON.stringify(j);
    } catch {
      /* raw text */
    }
    throw new Error(detail || `Token HTTP ${res.status}`);
  }
  return parseTokenResponse(text, res.status);
}

async function fetchConversationTokenFromBrowser() {
  const { origin } = getResidencyEndpoints();
  const url = new URL(`${origin}/v1/convai/conversation/token`);
  url.searchParams.set("agent_id", currentAgentId);
  const branchId = branchIdFor(currentResidency);
  if (branchId) {
    url.searchParams.set("branch_id", branchId);
  }
  url.searchParams.set("source", CONVAI_TOKEN_SOURCE);
  url.searchParams.set("version", CONVAI_TOKEN_VERSION);

  const res = await fetch(url.toString());
  const text = await res.text();
  if (!res.ok) {
    let detail = text;
    try {
      const j = JSON.parse(text);
      detail =
        j.error ||
        j.detail?.map?.((d) => d.msg).join("; ") ||
        (Array.isArray(j.detail) ? JSON.stringify(j.detail) : j.detail) ||
        JSON.stringify(j);
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
    els.expressiveMode,
    els.suggestedAudioTags,
    els.agentIdInput,
    els.residencySelect,
    els.loadAgentBtn,
  ];
  for (const el of fields) {
    if (el) el.disabled = disabled;
  }
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
  const language = String(agentCfg.language ?? "").trim().toLowerCase();
  const languages = collectAgentLanguages(agent);

  return {
    prompt: String(promptRaw).trim(),
    firstMessage: agentCfg.first_message ?? "",
    language,
    languages,
    llm: (typeof promptObj === "object" && promptObj.llm) || "",
    voice: {
      volume: toNum(widgetCfg.volume ?? tts.volume),
      voiceId: tts.voice_id || "",
      modelId: tts.model_id || "",
      stability: toNum(tts.stability),
      speed: toNum(tts.speed),
      similarityBoost: toNum(tts.similarity_boost),
      expressiveMode:
        tts.expressive_mode == null ? null : Boolean(tts.expressive_mode),
      suggestedAudioTags: Array.isArray(tts.suggested_audio_tags)
        ? tts.suggested_audio_tags
            .map((item) => {
              const tag = String(item?.tag ?? "").trim();
              if (!tag) return null;
              const description = String(item?.description ?? "").trim();
              return description ? { tag, description } : { tag };
            })
            .filter(Boolean)
        : [],
    },
  };
}

const AGENT_ACCESS_ERROR_TYPES = new Set([
  "not_found",
  "document_not_found",
  "forbidden",
  "unauthorized",
  "permission_denied",
  "access_denied",
]);

/** Parse upstream / proxy error bodies that may be JSON strings or nested detail objects. */
function parseApiErrorPayload(raw) {
  if (raw == null || raw === "") {
    return { message: "", type: null };
  }

  let value = raw;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return { message: "", type: null };
    try {
      value = JSON.parse(trimmed);
    } catch {
      return { message: trimmed.slice(0, 280), type: null };
    }
  }

  if (typeof value !== "object") {
    return { message: String(value).slice(0, 280), type: null };
  }

  const detail = value.detail ?? value.error ?? value;
  if (typeof detail === "string") {
    return parseApiErrorPayload(detail);
  }
  if (detail && typeof detail === "object") {
    const type =
      typeof detail.type === "string"
        ? detail.type
        : typeof detail.status === "string"
          ? detail.status
          : null;
    const message =
      (typeof detail.message === "string" && detail.message) ||
      (typeof detail.msg === "string" && detail.msg) ||
      (typeof value.message === "string" && value.message) ||
      "";
    return { message: message.slice(0, 280), type };
  }

  const message =
    (typeof value.message === "string" && value.message) ||
    (typeof value.error === "string" && value.error) ||
    "";
  return {
    message: message.slice(0, 280),
    type: typeof value.type === "string" ? value.type : null,
  };
}

function isAgentAccessError(httpStatus, parsed) {
  if (httpStatus === 404 || httpStatus === 403 || httpStatus === 401) return true;
  if (parsed?.type && AGENT_ACCESS_ERROR_TYPES.has(String(parsed.type).toLowerCase())) {
    return true;
  }
  const haystack = `${parsed?.message || ""} ${parsed?.type || ""}`.toLowerCase();
  return (
    haystack.includes("not_found") ||
    haystack.includes("document_not_found") ||
    haystack.includes("does not exist") ||
    haystack.includes("not found")
  );
}

function residencyKeyHint() {
  return currentResidency === "global"
    ? "XI_API_KEY_GLOBAL"
    : "XI_API_KEY_EU (or legacy XI_API_KEY)";
}

/**
 * Map agent-config failure into UI-facing copy without dumping raw JSON.
 * @returns {{ kind: "agent_missing" | "other", statusLine: string, banner: string | null, modalTitle?: string, modalMessage?: string }}
 */
function describeAgentConfigFailure(rawReason, httpStatus) {
  const parsed = parseApiErrorPayload(rawReason);

  if (isAgentAccessError(httpStatus, parsed)) {
    return {
      kind: "agent_missing",
      statusLine: "Agent not found.",
      banner: null,
      modalTitle: "Agent unavailable",
      modalMessage: "Agent not found or you don't have access to it.",
    };
  }

  if (httpStatus === 503) {
    const keyHint = residencyKeyHint();
    const detail = parsed.message || `${keyHint} missing or agent fetch unavailable`;
    return {
      kind: "other",
      statusLine: "Could not load live settings.",
      banner: `Live agent config unavailable: ${detail}. Ensure ${keyHint} is set on the server for ${getResidencyEndpoints().label} and the API can reach ElevenLabs.`,
    };
  }

  const detail =
    parsed.message ||
    (httpStatus ? `Agent fetch HTTP ${httpStatus}` : "Token server unreachable");

  return {
    kind: "other",
    statusLine: "Could not load live settings.",
    banner: `Live agent config unavailable: ${detail}. No repository mock defaults are used.`,
  };
}

function markConfigUnavailable(rawReason, httpStatus = 0) {
  liveConfigLoaded = false;
  loadedDefaults = null;
  configSource = { agent: "error", voice: "error" };
  clearFormToEmptyState();
  setConfigFieldsEnabled(false);
  setBadge(els.agentConfigBadge, "error");
  setBadge(els.voiceConfigBadge, "error");
  setCallUi("idle");

  const ui = describeAgentConfigFailure(rawReason, httpStatus);
  els.agentFetchStatus.textContent = ui.statusLine;
  showError(ui.banner);
  if (ui.kind === "agent_missing" && ui.modalMessage) {
    showAlertModal(ui.modalMessage, ui.modalTitle);
  }
}

async function loadAgentConfig() {
  liveConfigLoaded = false;
  loadedDefaults = null;
  configSource = { agent: "loading", voice: "loading" };
  setBadge(els.agentConfigBadge, "loading");
  setBadge(els.voiceConfigBadge, "loading");
  setConfigFieldsEnabled(false);
  clearFormToEmptyState();
  els.agentFetchStatus.textContent = `Loading live agent config (${getResidencyEndpoints().label})…`;
  showError(null);

  try {
    const url = new URL(apiUrl("/api/agent-config"), window.location.origin);
    url.searchParams.set("agent_id", currentAgentId);
    url.searchParams.set("residency", currentResidency);
    const res = await fetch(url.toString());
    const data = await res.json().catch(() => ({}));

    if (!res.ok || !data.agent) {
      const reason =
        data.error ||
        data.detail ||
        (res.status === 503
          ? `${currentResidency === "global" ? "XI_API_KEY_GLOBAL" : "XI_API_KEY_EU"} missing or agent fetch unavailable`
          : `Agent fetch HTTP ${res.status}`);
      markConfigUnavailable(reason, res.status);
      return;
    }

    if (data.agent_id) {
      currentAgentId = data.agent_id;
      if (els.agentIdInput) els.agentIdInput.value = currentAgentId;
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
    const regionLabel = getResidencyEndpoints().label;
    els.agentFetchStatus.textContent = `Loaded live from agent ${data.agent_id || currentAgentId} · ${regionLabel}${
      data.branch_id || branchIdFor(currentResidency) ? " · branch" : ""
    }.`;
    setCallUi("idle");
  } catch (err) {
    console.warn(err);
    markConfigUnavailable(
      err instanceof Error ? err.message : "Token server unreachable",
      0
    );
  }
}

async function reloadAgentFromInput() {
  const nextId = normalizeAgentId(els.agentIdInput?.value);
  if (!isValidAgentId(nextId)) {
    showError("Enter a valid agent ID (e.g. agent_…).");
    els.agentFetchStatus.textContent = "Enter a valid agent ID to load live config.";
    return;
  }
  // Persist QC under the previous agent before switching the key.
  persistQcRatings();
  currentAgentId = nextId;
  if (els.agentIdInput) els.agentIdInput.value = nextId;
  persistResidencyChoice(currentResidency);
  restoreQcRatings();
  validateQcCommentsRequired();
  await loadAgentConfig();
}

async function onResidencyChange() {
  const next = normalizeResidency(els.residencySelect?.value) || "eu";
  if (next === currentResidency) return;
  const previous = currentResidency;
  persistQcRatings();

  // Soft-switch: only replace Agent ID when it still matches the previous region's default.
  const typed = normalizeAgentId(els.agentIdInput?.value) || currentAgentId;
  const nextDefault = defaultAgentIdFor(next);
  if (!typed || typed === defaultAgentIdFor(previous)) {
    currentAgentId = nextDefault;
    if (els.agentIdInput) els.agentIdInput.value = nextDefault;
  }
  if (els.agentIdInput) els.agentIdInput.placeholder = nextDefault;

  persistResidencyChoice(next);
  restoreQcRatings();
  validateQcCommentsRequired();
  await loadAgentConfig();
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
    const endpoints = getResidencyEndpoints();
    const residency = { origin: endpoints.origin, livekitUrl: endpoints.livekitUrl };

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
        agentId: currentAgentId,
        connectionType: "websocket",
        ...residency,
        overrides,
        ...callbacks,
      });
      return;
    }

    if (import.meta.env.VITE_USE_AGENT_ID_ONLY === "true") {
      conversation = await Conversation.startSession({
        agentId: currentAgentId,
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
        agentId: currentAgentId,
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
    showTtsQcError("Paste the sentence you want to hear again.");
    return;
  }

  if (!liveConfigLoaded) {
    showTtsQcError("Call setup isn’t ready yet — wait a moment, then try again.");
    return;
  }

  const cfg = readSessionConfig();
  if (!cfg.voice.voiceId) {
    showTtsQcError("Voice isn’t set up yet — ask the person who shared this page.");
    return;
  }
  if (!cfg.voice.modelId) {
    showTtsQcError("Voice isn’t set up yet — ask the person who shared this page.");
    return;
  }

  els.ttsQcGenerateBtn.disabled = true;

  try {
    const res = await fetch(apiUrl("/api/tts"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        voiceId: cfg.voice.voiceId,
        modelId: resolveTtsQcModelId(cfg.voice.modelId),
        stability: cfg.voice.stability,
        speed: cfg.voice.speed,
        similarityBoost: cfg.voice.similarityBoost,
        residency: currentResidency,
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
      const keyHint =
        currentResidency === "global" ? "XI_API_KEY_GLOBAL" : "XI_API_KEY_EU";
      throw new Error(
        detail ||
          `TTS HTTP ${res.status}. Set ${keyHint} on the server for live QC playback.`
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
  }
}

// —— UI wiring ——
els.resetAgentConfigBtn.addEventListener("click", () => {
  if (!loadedDefaults) return;
  withSuppressedClientChoiceGuard(() => {
    rebuildLanguageSelect(loadedDefaults.languages, loadedDefaults.language);
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
  withSuppressedClientChoiceGuard(() => {
    if (loadedDefaults.voice.volume != null) sessionVoiceVolume = loadedDefaults.voice.volume;
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
    if (els.expressiveMode) {
      els.expressiveMode.checked =
        loadedDefaults.voice.expressiveMode == null
          ? true
          : Boolean(loadedDefaults.voice.expressiveMode);
    }
    if (els.suggestedAudioTags) {
      els.suggestedAudioTags.value = formatSuggestedAudioTags(
        loadedDefaults.voice.suggestedAudioTags
      );
    }
  });
  syncRangeOutputs();
  syncCommittedClientChoices();
  updateFooters();
});

for (const range of [els.stability, els.speed, els.similarityBoost]) {
  range.addEventListener("input", syncRangeOutputs);
}

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

function closeAlertModal() {
  if (!els.alertModal || els.alertModal.hidden) return;
  els.alertModal.hidden = true;
  if (activeModal === "alert") {
    activeModal = null;
    setAppBlurred(false);
  }
  if (pendingInstructionsOnEntry) {
    pendingInstructionsOnEntry = false;
    maybeOpenInstructionsOnEntry();
  }
}

function showAlertModal(message, title = "Agent unavailable") {
  if (!els.alertModal) {
    window.alert(message);
    return;
  }
  if (activeModal === "confirm") closeConfirmModal(false);
  // Soft-close instructions without persisting dismissal — alert takes priority.
  if (activeModal === "instructions" && els.instructionsModal && !els.instructionsModal.hidden) {
    els.instructionsModal.hidden = true;
    activeModal = null;
  }
  if (els.alertHeading) els.alertHeading.textContent = title;
  if (els.alertMessage) els.alertMessage.textContent = message;
  els.alertModal.hidden = false;
  activeModal = "alert";
  setAppBlurred(true);
  els.alertOkBtn?.focus();
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

/**
 * Confirm before committing a client-agent field change.
 * Cancel reverts to the last committed value. Programmatic updates use suppressClientChoiceGuard.
 * With confirmOnEditAttempt (text fields), confirm on focus/edit attempt so the modal
 * appears before typing — not only on blur `change`.
 */
function guardClientChoiceControl(
  el,
  fieldKey,
  fieldLabel,
  {
    read = () => el.value,
    write = (v) => {
      el.value = v;
    },
    onAfter = () => {},
    confirmOnEditAttempt = false,
  } = {}
) {
  if (!el) return;

  let editConfirmed = false;
  let confirmInFlight = false;

  if (confirmOnEditAttempt) {
    el.addEventListener("focus", async () => {
      if (suppressClientChoiceGuard || editConfirmed || confirmInFlight) return;
      confirmInFlight = true;
      // Blur while the modal is open so the user cannot type behind it.
      el.blur();
      const ok = await askClientChoiceConfirm(fieldLabel);
      confirmInFlight = false;
      if (!ok) {
        withSuppressedClientChoiceGuard(() => {
          write(committedClientChoices[fieldKey]);
        });
        onAfter();
        updateFooters();
        return;
      }
      editConfirmed = true;
      el.focus();
    });

    el.addEventListener("blur", () => {
      // Defer so a successful confirm can refocus before we clear the unlock.
      requestAnimationFrame(() => {
        if (confirmInFlight || document.activeElement === el) return;
        editConfirmed = false;
      });
    });
  }

  el.addEventListener("change", async () => {
    if (suppressClientChoiceGuard) {
      onAfter();
      updateFooters();
      return;
    }
    const next = read();
    if (next === committedClientChoices[fieldKey]) {
      onAfter();
      updateFooters();
      return;
    }
    // Edit-attempt fields already confirmed on focus; skip a second modal on commit.
    if (!(confirmOnEditAttempt && editConfirmed)) {
      const ok = await askClientChoiceConfirm(fieldLabel);
      if (!ok) {
        // Revert only if still on this pending value; a newer change may have moved it.
        if (read() === next) {
          withSuppressedClientChoiceGuard(() => {
            write(committedClientChoices[fieldKey]);
          });
        }
        editConfirmed = false;
        onAfter();
        updateFooters();
        return;
      }
    }
    committedClientChoices[fieldKey] = next;
    editConfirmed = false;
    onAfter();
    updateFooters();
  });
}

function guardClientChoiceSelect(select, fieldKey, fieldLabel) {
  guardClientChoiceControl(select, fieldKey, fieldLabel);
}

guardClientChoiceSelect(els.languageSelect, "language", "Language");
guardClientChoiceSelect(els.llmSelect, "llm", "LLM");
guardClientChoiceSelect(els.ttsModelSelect, "modelId", "Model");
guardClientChoiceControl(els.voiceId, "voiceId", "Voice ID", {
  confirmOnEditAttempt: true,
});
guardClientChoiceControl(els.stability, "stability", "Stability", {
  onAfter: syncRangeOutputs,
});
guardClientChoiceControl(els.speed, "speed", "Speed", {
  onAfter: syncRangeOutputs,
});
guardClientChoiceControl(els.similarityBoost, "similarityBoost", "Similarity boost", {
  onAfter: syncRangeOutputs,
});
guardClientChoiceControl(els.expressiveMode, "expressiveMode", "Expressive mode", {
  read: () => els.expressiveMode.checked,
  write: (v) => {
    els.expressiveMode.checked = v;
  },
});
guardClientChoiceControl(els.suggestedAudioTags, "suggestedAudioTags", "Suggested audio tags");

els.confirmOkBtn?.addEventListener("click", () => closeConfirmModal(true));
els.confirmCancelBtn?.addEventListener("click", () => closeConfirmModal(false));
els.confirmCloseBtn?.addEventListener("click", () => closeConfirmModal(false));
els.confirmModal?.querySelector("[data-close-confirm]")?.addEventListener("click", () =>
  closeConfirmModal(false)
);

els.alertOkBtn?.addEventListener("click", () => closeAlertModal());
els.alertCloseBtn?.addEventListener("click", () => closeAlertModal());
els.alertModal?.querySelector("[data-close-alert]")?.addEventListener("click", () =>
  closeAlertModal()
);

els.ttsQcGenerateBtn.addEventListener("click", generateTtsQc);

els.startBtn.addEventListener("click", startConversation);
els.stopBtn.addEventListener("click", stopConversation);

function qcCacheKey() {
  return `productions-qc-ratings:${currentResidency}:${currentAgentId}`;
}
const QC_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
/** 1–3 scoring dimensions (comments also required when any is 1). */
const QC_SCORE_NAMES = [
  "qcAccent",
  "qcPronunciation",
  "qcNaturalness",
  "qcArtifacts",
  "qcTurnTaking",
  "qcLanguageIntegrity",
];
/** Non-score radios still persisted with the QC form. */
const QC_EXTRA_RADIO_NAMES = ["qcRepeatCount", "qcReplayTag"];

function getCheckedRadioValue(name) {
  const checked = document.querySelector(`input[name="${name}"]:checked`);
  return checked ? checked.value : "";
}

function setCheckedRadioValue(name, value) {
  document.querySelectorAll(`input[name="${name}"]`).forEach((input) => {
    input.checked = Boolean(value) && input.value === value;
  });
}

/** Normalize cached wording: old YES/NO radios → empty string (or keep free text). */
function normalizeWordingIssue(value) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed || trimmed === "no" || trimmed === "yes") return "";
  return trimmed;
}

function readQcFormState() {
  return {
    accent: getCheckedRadioValue("qcAccent"),
    pronunciation: getCheckedRadioValue("qcPronunciation"),
    naturalness: getCheckedRadioValue("qcNaturalness"),
    artifacts: getCheckedRadioValue("qcArtifacts"),
    turnTaking: getCheckedRadioValue("qcTurnTaking"),
    languageIntegrity: getCheckedRadioValue("qcLanguageIntegrity"),
    repeatCount: getCheckedRadioValue("qcRepeatCount"),
    replayTag: getCheckedRadioValue("qcReplayTag"),
    wordingIssue: (els.qcWordingIssue?.value || "").trim(),
    comments: (els.qcComments?.value || "").trim(),
  };
}

function applyQcFormState(state) {
  if (!state) return;
  setCheckedRadioValue("qcAccent", state.accent);
  setCheckedRadioValue("qcPronunciation", state.pronunciation);
  setCheckedRadioValue("qcNaturalness", state.naturalness);
  setCheckedRadioValue("qcArtifacts", state.artifacts);
  setCheckedRadioValue("qcTurnTaking", state.turnTaking);
  setCheckedRadioValue("qcLanguageIntegrity", state.languageIntegrity);
  setCheckedRadioValue("qcRepeatCount", state.repeatCount);
  setCheckedRadioValue("qcReplayTag", state.replayTag);
  if (els.qcWordingIssue) {
    els.qcWordingIssue.value = normalizeWordingIssue(state.wordingIssue);
  }
  if (els.qcComments) els.qcComments.value = state.comments || "";
}

function hasAnyScoreOfOne(state = readQcFormState()) {
  return [
    state.accent,
    state.pronunciation,
    state.naturalness,
    state.artifacts,
    state.turnTaking,
    state.languageIntegrity,
  ].includes("1");
}

function needsQcComments(state = readQcFormState()) {
  // Comments required for any dimension scored 1.
  return hasAnyScoreOfOne(state);
}

function validateQcCommentsRequired() {
  const needsComments = needsQcComments();
  const comments = (els.qcComments?.value || "").trim();
  const invalid = needsComments && !comments;
  if (els.qcCommentsHint) els.qcCommentsHint.hidden = !invalid;
  els.qcCommentsField?.classList.toggle("is-invalid", invalid);
  if (els.qcComments) {
    els.qcComments.setAttribute("aria-invalid", invalid ? "true" : "false");
    els.qcComments.required = needsComments;
  }
  return !invalid;
}

function persistQcRatings() {
  try {
    const payload = {
      savedAt: Date.now(),
      ...readQcFormState(),
    };
    localStorage.setItem(qcCacheKey(), JSON.stringify(payload));
  } catch {
    // Ignore private mode / quota errors.
  }
}

function clearQcForm() {
  applyQcFormState({
    accent: "",
    pronunciation: "",
    naturalness: "",
    artifacts: "",
    turnTaking: "",
    languageIntegrity: "",
    repeatCount: "",
    replayTag: "",
    wordingIssue: "",
    comments: "",
  });
}

function restoreQcRatings() {
  try {
    const raw = localStorage.getItem(qcCacheKey());
    if (!raw) {
      clearQcForm();
      return;
    }
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      clearQcForm();
      return;
    }
    const age = Date.now() - Number(parsed.savedAt || 0);
    if (!Number.isFinite(age) || age < 0 || age > QC_CACHE_TTL_MS) {
      localStorage.removeItem(qcCacheKey());
      clearQcForm();
      return;
    }
    applyQcFormState(parsed);
  } catch {
    // Ignore corrupt cache.
  }
}

function onQcFormChange() {
  validateQcCommentsRequired();
  persistQcRatings();
}

for (const name of [...QC_SCORE_NAMES, ...QC_EXTRA_RADIO_NAMES]) {
  document.querySelectorAll(`input[name="${name}"]`).forEach((input) => {
    input.addEventListener("change", onQcFormChange);
  });
}
els.qcWordingIssue?.addEventListener("input", onQcFormChange);
els.qcComments?.addEventListener("input", onQcFormChange);

restoreQcRatings();
validateQcCommentsRequired();

const INSTRUCTIONS_DISMISSED_KEY = "productions-review-instructions-dismissed";

function isInstructionsDismissed() {
  try {
    return localStorage.getItem(INSTRUCTIONS_DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

function persistInstructionsDismissed() {
  try {
    localStorage.setItem(INSTRUCTIONS_DISMISSED_KEY, "1");
  } catch {
    // Ignore private mode / quota errors; dismissal still closes the modal.
  }
}

function openInstructionsModal() {
  if (!els.instructionsModal) return;
  if (activeModal === "confirm") closeConfirmModal(false);
  if (activeModal === "alert") closeAlertModal();
  els.instructionsModal.hidden = false;
  activeModal = "instructions";
  setAppBlurred(true);
  (els.closeInstructionsBtn || els.dismissInstructionsBtn)?.focus();
}

function closeInstructionsModal() {
  if (!els.instructionsModal || els.instructionsModal.hidden) return;
  els.instructionsModal.hidden = true;
  persistInstructionsDismissed();
  if (activeModal === "instructions") {
    activeModal = null;
    setAppBlurred(false);
  }
  els.openInstructionsBtn?.focus();
}

let pendingInstructionsOnEntry = false;

function maybeOpenInstructionsOnEntry() {
  if (document.body.dataset.pageMode === "simply") return;
  if (isInstructionsDismissed()) return;
  if (activeModal === "alert") {
    pendingInstructionsOnEntry = true;
    return;
  }
  openInstructionsModal();
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
  if (activeModal === "alert") {
    closeAlertModal();
    return;
  }
  if (activeModal === "instructions") {
    closeInstructionsModal();
  }
});

if (els.agentIdInput) {
  els.agentIdInput.value = currentAgentId;
  els.agentIdInput.placeholder = defaultAgentIdFor(currentResidency);
}
persistResidencyChoice(currentResidency);

els.loadAgentBtn?.addEventListener("click", () => {
  void reloadAgentFromInput();
});
els.agentIdInput?.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    void reloadAgentFromInput();
  }
});
els.residencySelect?.addEventListener("change", () => {
  void onResidencyChange();
});

/** Soft-mute edit sections until clicked; Preview + QC Ratings stay fully active. */
function initEditGates() {
  const gates = Array.from(document.querySelectorAll("[data-edit-gate]"));
  if (!gates.length) return;

  const FOCUSABLE_SEL = "button, input, select, textarea, a[href], [tabindex]";

  function setDescendantsTabbable(gate, tabbable) {
    for (const el of gate.querySelectorAll(FOCUSABLE_SEL)) {
      if (tabbable) {
        if (el.dataset.editGateTab == null) continue;
        const prev = el.dataset.editGateTab;
        delete el.dataset.editGateTab;
        if (prev === "") el.removeAttribute("tabindex");
        else el.setAttribute("tabindex", prev);
      } else {
        if (el.dataset.editGateTab == null) {
          el.dataset.editGateTab = el.hasAttribute("tabindex") ? el.getAttribute("tabindex") : "";
        }
        el.setAttribute("tabindex", "-1");
      }
    }
  }

  function lockGate(gate) {
    const active = document.activeElement;
    if (active instanceof HTMLElement && gate.contains(active)) {
      active.blur();
    }
    gate.classList.remove("is-unlocked");
    gate.setAttribute("aria-disabled", "true");
    gate.setAttribute("tabindex", "0");
    setDescendantsTabbable(gate, false);
  }

  function unlockGate(gate) {
    gate.classList.add("is-unlocked");
    gate.setAttribute("aria-disabled", "false");
    gate.removeAttribute("tabindex");
    setDescendantsTabbable(gate, true);
  }

  for (const gate of gates) {
    lockGate(gate);
    gate.addEventListener("keydown", (event) => {
      if (gate.classList.contains("is-unlocked")) return;
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      unlockGate(gate);
    });
  }

  document.addEventListener(
    "pointerdown",
    (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest(".modal")) return;

      const hitGate = target.closest("[data-edit-gate]");
      for (const gate of gates) {
        if (gate === hitGate) {
          if (!gate.classList.contains("is-unlocked")) unlockGate(gate);
        } else if (gate.classList.contains("is-unlocked")) {
          lockGate(gate);
        }
      }
    },
    true
  );
}

initEditGates();
initPageModeToggle();

setConfigFieldsEnabled(false);
loadAgentConfig().finally(maybeOpenInstructionsOnEntry);
