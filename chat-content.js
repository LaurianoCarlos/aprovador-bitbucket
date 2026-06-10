(() => {
  "use strict";

  const WORKSPACE_PERMITIDO = "oliveira-trust";
  const DEFAULT_SECONDS = 10;
  const MIN_SECONDS = 5;
  const MAX_SECONDS = 3600;
  const DEFAULT_MAX_URLS = 5;
  const MIN_URLS = 1;
  const MAX_URLS = 100;

  let cycleRunning = false;
  let countdownTimer = null;

  function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function normalizePullRequestUrl(rawUrl) {
    try {
      const url = new URL(rawUrl);

      if (url.hostname !== "bitbucket.org") {
        return null;
      }

      const pattern = new RegExp(
        `^/${escapeRegExp(WORKSPACE_PERMITIDO)}/([^/]+)/pull-requests/(\\d+)`,
        "i"
      );

      const match = url.pathname.match(pattern);

      if (!match) {
        return null;
      }

      return (
        `https://bitbucket.org/${WORKSPACE_PERMITIDO}/` +
        `${match[1]}/pull-requests/${match[2]}`
      );
    } catch {
      return null;
    }
  }

  function isElementVisible(element) {
    if (!(element instanceof HTMLElement)) {
      return false;
    }

    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();

    return (
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      Number(style.opacity) !== 0 &&
      rect.width > 0 &&
      rect.height > 0 &&
      rect.bottom >= 0 &&
      rect.top <= window.innerHeight
    );
  }

  function findLatestPullRequestUrls(limit) {
    const anchors = Array.from(
      document.querySelectorAll('a[href*="bitbucket.org"]')
    );

    const orderedUniqueUrls = [];
    const seen = new Set();

    for (const anchor of anchors) {
      if (!isElementVisible(anchor)) {
        continue;
      }

      const normalized = normalizePullRequestUrl(anchor.href);

      if (!normalized || seen.has(normalized)) {
        continue;
      }

      seen.add(normalized);
      orderedUniqueUrls.push(normalized);
    }

    return orderedUniqueUrls.slice(-limit);
  }

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

  async function isServiceRunning() {
    const data = await chrome.storage.local.get("serviceRunning");
    return data.serviceRunning === true;
  }

  async function addLog(message, type = "info") {
    const data = await chrome.storage.local.get("flowLogs");
    const logs = Array.isArray(data.flowLogs) ? data.flowLogs : [];

    logs.push({
      message,
      type,
      createdAt: new Date().toISOString()
    });

    await chrome.storage.local.set({
      flowLogs: logs.slice(-100)
    });
  }

  async function setCurrentState(state) {
    await chrome.storage.local.set({
      currentFlowState: {
        ...state,
        updatedAt: new Date().toISOString()
      }
    });
  }

  async function executeCycle() {
    if (cycleRunning || !(await isServiceRunning())) {
      return;
    }

    cycleRunning = true;

    try {
      const settings = await chrome.storage.local.get("maxUrls");
      const maxUrls = sanitizeMaxUrls(
        settings.maxUrls ?? DEFAULT_MAX_URLS
      );

      const urls = findLatestPullRequestUrls(maxUrls);

      await chrome.storage.local.set({
        urlsFound: urls
      });

      await addLog(
        `Últimas URLs encontradas: ${urls.length} de até ${maxUrls}.`,
        "info"
      );
      await setCurrentState({
        status: "running",
        message: `${urls.length} URL(s) encontrada(s).`,
        currentIndex: 0,
        total: urls.length
      });

      if (urls.length === 0) {
        await addLog("Nenhuma URL para processar.", "warning");
        await setCurrentState({
          status: "waiting",
          message: "Nenhuma URL encontrada.",
          currentIndex: 0,
          total: 0
        });
        return;
      }

      for (let index = 0; index < urls.length; index += 1) {
        if (!(await isServiceRunning())) {
          await addLog("Serviço interrompido pelo usuário.", "stopped");
          await setCurrentState({
            status: "stopped",
            message: "Serviço interrompido.",
            currentIndex: index,
            total: urls.length
          });
          break;
        }

        const url = urls[index];

        await addLog(
          `URL ${index + 1} de ${urls.length}: tentando confirmar a PR...`,
          "loading"
        );

        await setCurrentState({
          status: "loading",
          message: `Tentando confirmar a PR ${index + 1} de ${urls.length}.`,
          url,
          currentIndex: index + 1,
          total: urls.length
        });

        try {
          const response = await chrome.runtime.sendMessage({
            type: "PROCESS_SINGLE_PULL_REQUEST",
            url
          });

          if (response?.status === "approved") {
            await addLog(
              `URL ${index + 1}: aprovado.`,
              "success"
            );
          } else if (response?.status === "no_button") {
            await addLog(
              `URL ${index + 1}: sem botão de aprovação.`,
              "warning"
            );
          } else if (response?.status === "stopped") {
            await addLog(
              `URL ${index + 1}: processamento interrompido.`,
              "stopped"
            );
            break;
          } else {
            await addLog(
              `URL ${index + 1}: ${response?.message || "não processada"}.`,
              "warning"
            );
          }
        } catch (error) {
          await addLog(
            `URL ${index + 1}: erro — ${error.message}`,
            "warning"
          );
        }

        if (index < urls.length - 1 && await isServiceRunning()) {
          await addLog("Próxima URL...", "info");
        }
      }

      if (await isServiceRunning()) {
        await addLog("Ciclo concluído.", "success");
        await setCurrentState({
          status: "waiting",
          message: "Ciclo concluído.",
          currentIndex: urls.length,
          total: urls.length
        });
      }
    } finally {
      cycleRunning = false;
    }
  }

  async function startCountdown() {
    window.clearInterval(countdownTimer);

    const data = await chrome.storage.local.get("refreshSeconds");
    const refreshSeconds = sanitizeSeconds(
      data.refreshSeconds ?? DEFAULT_SECONDS
    );

    let remaining = refreshSeconds;

    await chrome.storage.local.set({
      nextCycleSeconds: remaining
    });

    countdownTimer = window.setInterval(async () => {
      if (!(await isServiceRunning())) {
        window.clearInterval(countdownTimer);
        countdownTimer = null;
        return;
      }

      remaining -= 1;

      await chrome.storage.local.set({
        nextCycleSeconds: remaining
      });

      if (remaining <= 0) {
        window.clearInterval(countdownTimer);
        countdownTimer = null;
        window.location.reload();
      }
    }, 1000);
  }

  async function boot() {
    if (!(await isServiceRunning())) {
      await setCurrentState({
        status: "stopped",
        message: "Serviço parado.",
        currentIndex: 0,
        total: 0
      });
      return;
    }

    await executeCycle();

    if (await isServiceRunning()) {
      await startCountdown();
    }
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") {
      return;
    }

    if (changes.serviceRunning?.newValue === true) {
      void boot();
    }

    if (changes.serviceRunning?.newValue === false) {
      window.clearInterval(countdownTimer);
      countdownTimer = null;
    }
  });

  window.setTimeout(() => {
    void boot();
  }, 1200);
})();
