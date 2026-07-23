import { Conversation } from "@elevenlabs/client";
import "./styles.css";
import germanPrompt from "./prompts/de.txt?raw";
import greekPrompt from "./prompts/el.txt?raw";
import norwegianPrompt from "./prompts/no.txt?raw";

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
const PROMPT_STORAGE_KEY = "elevenlabs-voice-test:system-prompt-draft";

/** Per-language system prompts (ISO codes match #languageSelect). Norwegian = Bokmål (`no`). */
const LANGUAGE_PROMPTS = {
  de: germanPrompt,
  el: greekPrompt,
  no: norwegianPrompt,
};

const languageSelect = document.getElementById("languageSelect");
const systemPrompt = document.getElementById("systemPrompt");
const resetPromptBtn = document.getElementById("resetPromptBtn");
const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const connStatus = document.getElementById("connStatus");
const modeStatus = document.getElementById("modeStatus");
const errorBox = document.getElementById("errorBox");
const callSurface = document.querySelector(".call-surface");
const callLabel = document.getElementById("callLabel");
const modeLine = document.getElementById("modeLine");

let conversation = null;

const sharedDefaultPrompt = systemPrompt.defaultValue;

function defaultPromptForLanguage(language) {
  return (LANGUAGE_PROMPTS[language] ?? sharedDefaultPrompt).trim();
}

function syncPromptUi(language) {
  const defaultPrompt = defaultPromptForLanguage(language);
  systemPrompt.defaultValue = defaultPrompt;

  if (LANGUAGE_PROMPTS[language]) {
    systemPrompt.value = defaultPrompt;
    return;
  }

  const savedPrompt = localStorage.getItem(PROMPT_STORAGE_KEY);
  systemPrompt.value = savedPrompt !== null ? savedPrompt : defaultPrompt;
}

syncPromptUi(languageSelect.value);

languageSelect.addEventListener("change", () => {
  syncPromptUi(languageSelect.value);
});

systemPrompt.addEventListener("input", () => {
  if (LANGUAGE_PROMPTS[languageSelect.value]) return;
  localStorage.setItem(PROMPT_STORAGE_KEY, systemPrompt.value);
});

resetPromptBtn.addEventListener("click", () => {
  systemPrompt.value = systemPrompt.defaultValue;
  if (!LANGUAGE_PROMPTS[languageSelect.value]) {
    localStorage.removeItem(PROMPT_STORAGE_KEY);
  }
});

function buildOverrides(language) {
  const overrides = {
    agent: {
      language,
    },
  };
  // Language-specific files win for de/el/no; otherwise use the textarea (shared default / draft).
  const promptText = (LANGUAGE_PROMPTS[language] ?? systemPrompt.value).trim();
  if (promptText) {
    overrides.agent.prompt = { prompt: promptText };
  }
  return overrides;
}

function showError(msg) {
  if (!msg) {
    errorBox.hidden = true;
    errorBox.textContent = "";
    return;
  }
  errorBox.hidden = false;
  errorBox.textContent = msg;
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

function buildCallbacks() {
  return {
    onConnect: () => {
      connStatus.textContent = "Connected";
      stopBtn.disabled = false;
      languageSelect.disabled = true;
      systemPrompt.disabled = true;
      resetPromptBtn.disabled = true;
      setCallUi("active");
    },
    onDisconnect: () => {
      connStatus.textContent = "Disconnected";
      startBtn.disabled = false;
      stopBtn.disabled = true;
      modeStatus.textContent = "—";
      languageSelect.disabled = false;
      systemPrompt.disabled = false;
      resetPromptBtn.disabled = false;
      conversation = null;
      setCallUi("idle");
    },
    onError: (err) => {
      console.error(err);
      showError(typeof err === "string" ? err : err?.message || String(err));
    },
    onModeChange: ({ mode }) => {
      modeStatus.textContent = mode === "speaking" ? "Speaking" : "Listening";
      if (callSurface?.dataset.state === "active" && modeLine) {
        modeLine.textContent =
          mode === "speaking" ? "Agent is speaking — wait for your turn." : "Listening — go ahead and talk.";
      }
    },
  };
}

function setCallUi(state) {
  if (!callSurface) return;
  callSurface.dataset.state = state;
  if (!callLabel || !modeLine) return;
  if (state === "idle") {
    callLabel.textContent = "Ready to connect";
    modeLine.textContent = "Microphone access is requested when you start.";
  } else if (state === "connecting") {
    callLabel.textContent = "Connecting…";
    modeLine.textContent = "Grant microphone access if the browser asks.";
  } else if (state === "active") {
    callLabel.textContent = "Live session";
    modeLine.textContent = "Speak naturally — the agent follows the system prompt on the left.";
  }
}

async function startConversation() {
  showError(null);

  const language = languageSelect.value;
  if (!language) {
    showError("Select a language before starting the call.");
    return;
  }

  startBtn.disabled = true;
  setCallUi("connecting");

  try {
    const overrides = buildOverrides(language);
    const callbacks = buildCallbacks();
    const residency = { origin: API_ORIGIN, livekitUrl: LIVEKIT_URL };

    const useLocalTokenServer =
      import.meta.env.DEV && import.meta.env.VITE_DEV_USE_TOKEN_SERVER !== "false";
    if (useLocalTokenServer) {
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
    startBtn.disabled = false;
    stopBtn.disabled = true;
    setCallUi("idle");
  }
}

async function stopConversation() {
  if (conversation) {
    await conversation.endSession();
    conversation = null;
  }
}

startBtn.addEventListener("click", startConversation);
stopBtn.addEventListener("click", stopConversation);
