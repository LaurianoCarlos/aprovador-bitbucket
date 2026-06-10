"use strict";

const WORKSPACE_PERMITIDO = "oliveira-trust";
const PROCESS_TIMEOUT_MS = 45000;

chrome.runtime.onInstalled.addListener(async () => {
  const current = await chrome.storage.local.get([
    "serviceRunning",
    "refreshSeconds",
    "maxUrls",
    "flowLogs"
  ]);

  const updates = {};

  if (typeof current.serviceRunning !== "boolean") {
    updates.serviceRunning = false;
  }

  if (!Number.isInteger(current.refreshSeconds)) {
    updates.refreshSeconds = 10;
  }

  if (!Number.isInteger(current.maxUrls)) {
    updates.maxUrls = 5;
  }

  if (!Array.isArray(current.flowLogs)) {
    updates.flowLogs = [];
  }

  if (Object.keys(updates).length > 0) {
    await chrome.storage.local.set(updates);
  }
});

function normalizePullRequestUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);

    if (url.protocol !== "https:" || url.hostname !== "bitbucket.org") {
      return null;
    }

    const match = url.pathname.match(
      /^\/([^/]+)\/([^/]+)\/pull-requests\/(\d+)/i
    );

    if (!match || match[1].toLowerCase() !== WORKSPACE_PERMITIDO) {
      return null;
    }

    return (
      `https://bitbucket.org/${match[1]}/` +
      `${match[2]}/pull-requests/${match[3]}`
    );
  } catch {
    return null;
  }
}

async function isServiceRunning() {
  const data = await chrome.storage.local.get("serviceRunning");
  return data.serviceRunning === true;
}

async function findExistingTab(normalizedUrl) {
  const tabs = await chrome.tabs.query({
    url: ["https://bitbucket.org/*/*/pull-requests/*"]
  });

  return tabs.find((tab) => {
    return Boolean(tab.url) &&
      normalizePullRequestUrl(tab.url) === normalizedUrl;
  });
}

async function openPullRequest(normalizedUrl) {
  const existingTab = await findExistingTab(normalizedUrl);

  if (existingTab?.id) {
    await chrome.tabs.update(existingTab.id, {
      url: normalizedUrl,
      active: false
    });

    return existingTab.id;
  }

  const tab = await chrome.tabs.create({
    url: normalizedUrl,
    active: false
  });

  return tab.id;
}

function waitForTabResult(tabId, normalizedUrl) {
  return new Promise((resolve) => {
    let finished = false;

    const timeoutId = setTimeout(() => {
      finish({
        status: "no_button",
        message: "Tempo limite atingido sem encontrar o botão de aprovação."
      });
    }, PROCESS_TIMEOUT_MS);

    function finish(result) {
      if (finished) {
        return;
      }

      finished = true;
      clearTimeout(timeoutId);
      chrome.runtime.onMessage.removeListener(listener);
      resolve(result);
    }

    function listener(message, sender) {
      if (
        message?.type !== "PULL_REQUEST_PROCESS_RESULT" ||
        sender.tab?.id !== tabId ||
        normalizePullRequestUrl(message.url) !== normalizedUrl
      ) {
        return false;
      }

      finish({
        status: message.status,
        message: message.message
      });

      return false;
    }

    chrome.runtime.onMessage.addListener(listener);
  });
}

async function processSingleUrl(rawUrl) {
  if (!(await isServiceRunning())) {
    return {
      success: false,
      status: "stopped",
      message: "Serviço interrompido."
    };
  }

  const normalizedUrl = normalizePullRequestUrl(rawUrl);

  if (!normalizedUrl) {
    return {
      success: false,
      status: "invalid",
      message: "URL inválida."
    };
  }

  const tabId = await openPullRequest(normalizedUrl);
  const result = await waitForTabResult(tabId, normalizedUrl);

  return {
    success: true,
    url: normalizedUrl,
    tabId,
    status: result.status,
    message: result.message
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message?.type) {
    return false;
  }

  if (message.type === "PROCESS_SINGLE_PULL_REQUEST") {
    void processSingleUrl(message.url)
      .then(sendResponse)
      .catch((error) => {
        sendResponse({
          success: false,
          status: "error",
          message: error.message
        });
      });

    return true;
  }

  return false;
});
