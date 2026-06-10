"use strict";

const DEFAULT_SECONDS = 10;
const MIN_SECONDS = 5;
const MAX_SECONDS = 3600;
const DEFAULT_MAX_URLS = 5;
const MIN_URLS = 1;
const MAX_URLS = 100;

const serviceStatus = document.getElementById("serviceStatus");
const currentStateText = document.getElementById("currentStateText");
const spinner = document.getElementById("spinner");
const refreshSecondsInput = document.getElementById("refreshSeconds");
const maxUrlsInput = document.getElementById("maxUrls");
const toggleButton = document.getElementById("toggleButton");
const closeButton = document.getElementById("closeButton");
const flowLogs = document.getElementById("flowLogs");
const message = document.getElementById("message");

let serviceRunning = false;

function sanitizeSeconds(value) {
  const numeric = Number(value);

  if (!Number.isFinite(numeric)) {
    return DEFAULT_SECONDS;
  }

  return Math.min(
    MAX_SECONDS,
    Math.max(MIN_SECONDS, Math.floor(numeric))
  );
}

function sanitizeMaxUrls(value) {
  const numeric = Number(value);

  if (!Number.isFinite(numeric)) {
    return DEFAULT_MAX_URLS;
  }

  return Math.min(
    MAX_URLS,
    Math.max(MIN_URLS, Math.floor(numeric))
  );
}

function renderStatus(isRunning) {
  serviceRunning = isRunning;

  serviceStatus.textContent = isRunning ? "ATIVO" : "PARADO";
  serviceStatus.style.color = isRunning ? "#216e4e" : "#ae2e24";

  toggleButton.textContent = isRunning
    ? "Parar serviço"
    : "Iniciar serviço";

  toggleButton.classList.toggle("start", !isRunning);
  toggleButton.classList.toggle("stop", isRunning);

  refreshSecondsInput.disabled = isRunning;
  maxUrlsInput.disabled = isRunning;
}

function renderCurrentState(state, nextCycleSeconds) {
  const isLoading = state?.status === "loading";
  spinner.classList.toggle("visible", isLoading);

  if (!state) {
    currentStateText.textContent = serviceRunning
      ? "Aguardando processamento."
      : "Serviço parado.";
    return;
  }

  let text = state.message || "";

  if (
    serviceRunning &&
    state.status === "waiting" &&
    Number.isInteger(nextCycleSeconds)
  ) {
    text += ` Próximo ciclo em ${nextCycleSeconds}s.`;
  }

  currentStateText.textContent = text;
}

function renderLogs(logs) {
  if (!Array.isArray(logs) || logs.length === 0) {
    flowLogs.textContent = "Nenhuma ação executada.";
    return;
  }

  flowLogs.innerHTML = "";

  const icons = {
    success: "✅",
    warning: "⚠️",
    loading: "⏳",
    stopped: "⛔",
    info: "•"
  };

  for (const log of logs) {
    const row = document.createElement("div");
    row.className = "log-row";
    row.textContent = `${icons[log.type] || "•"} ${log.message}`;
    flowLogs.appendChild(row);
  }

  flowLogs.scrollTop = flowLogs.scrollHeight;
}

async function loadState() {
  const data = await chrome.storage.local.get([
    "serviceRunning",
    "refreshSeconds",
    "maxUrls",
    "flowLogs",
    "currentFlowState",
    "nextCycleSeconds"
  ]);

  renderStatus(data.serviceRunning === true);

  refreshSecondsInput.value = sanitizeSeconds(
    data.refreshSeconds ?? DEFAULT_SECONDS
  );

  maxUrlsInput.value = sanitizeMaxUrls(
    data.maxUrls ?? DEFAULT_MAX_URLS
  );

  renderCurrentState(
    data.currentFlowState,
    data.nextCycleSeconds
  );

  renderLogs(data.flowLogs);
}

async function reloadActiveGoogleChatTab() {
  const tabs = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });

  const activeTab = tabs[0];

  if (!activeTab?.id || !activeTab.url?.startsWith("https://chat.google.com/")) {
    return false;
  }

  await chrome.tabs.reload(activeTab.id);
  return true;
}

async function startService() {
  const refreshSeconds = sanitizeSeconds(refreshSecondsInput.value);
  const maxUrls = sanitizeMaxUrls(maxUrlsInput.value);

  refreshSecondsInput.value = refreshSeconds;
  maxUrlsInput.value = maxUrls;

  await chrome.storage.local.set({
    serviceRunning: true,
    refreshSeconds,
    maxUrls,
    flowLogs: [],
    currentFlowState: {
      status: "starting",
      message: "Serviço iniciado. Preparando o primeiro ciclo.",
      updatedAt: new Date().toISOString()
    }
  });

  renderStatus(true);
  spinner.classList.add("visible");
  currentStateText.textContent = "Serviço iniciado. Preparando o primeiro ciclo.";

  const reloaded = await reloadActiveGoogleChatTab();

  message.textContent = reloaded
    ? "O Google Chat foi atualizado."
    : "Abra ou atualize o Google Chat para começar.";
}

async function stopService() {
  await chrome.storage.local.set({
    serviceRunning: false,
    currentFlowState: {
      status: "stopped",
      message: "Serviço parado.",
      updatedAt: new Date().toISOString()
    }
  });

  renderStatus(false);
  spinner.classList.remove("visible");
  currentStateText.textContent = "Serviço parado.";

  await reloadActiveGoogleChatTab();
  message.textContent = "Serviço parado.";
}

async function shutdownAndClose() {
  await stopService();
  window.close();
}

toggleButton.addEventListener("click", () => {
  message.textContent = "";

  const action = serviceRunning
    ? stopService()
    : startService();

  void action.catch((error) => {
    message.textContent = `Erro: ${error.message}`;
  });
});

closeButton.addEventListener("click", () => {
  void shutdownAndClose().catch((error) => {
    message.textContent = `Erro ao encerrar: ${error.message}`;
  });
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") {
    return;
  }

  void loadState();
});

void loadState().catch((error) => {
  message.textContent = `Erro ao carregar: ${error.message}`;
});
