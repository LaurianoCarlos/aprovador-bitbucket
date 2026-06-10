(() => {
  "use strict";

  const MAX_WAIT_TIME_MS = 30000;
  const SEARCH_INTERVAL_MS = 500;
  let executionStarted = false;

  function normalizeText(value) {
    return String(value ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function getCurrentPullRequestUrl() {
    const match = window.location.pathname.match(
      /^\/([^/]+)\/([^/]+)\/pull-requests\/(\d+)/i
    );

    if (!match || match[1].toLowerCase() !== "oliveira-trust") {
      return null;
    }

    return (
      `https://bitbucket.org/${match[1]}/` +
      `${match[2]}/pull-requests/${match[3]}`
    );
  }

  function isClickable(element) {
    if (!(element instanceof HTMLElement)) {
      return false;
    }

    const style = window.getComputedStyle(element);

    return (
      !element.hasAttribute("disabled") &&
      element.getAttribute("aria-disabled") !== "true" &&
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      Number(style.opacity) !== 0
    );
  }

  function getElementText(element) {
    return normalizeText(
      element.innerText ||
      element.textContent ||
      element.getAttribute("value") ||
      element.getAttribute("aria-label") ||
      element.getAttribute("title") ||
      ""
    );
  }

  function findApproveButton(root = document) {
    const elements = Array.from(
      root.querySelectorAll(
        [
          "button",
          '[role="button"]',
          'input[type="button"]',
          'input[type="submit"]'
        ].join(",")
      )
    );

    return elements.find((element) => {
      const text = getElementText(element);

      return (
        (text === "approve" || text === "aprovar") &&
        isClickable(element)
      );
    });
  }

  function sleep(milliseconds) {
    return new Promise((resolve) => {
      window.setTimeout(resolve, milliseconds);
    });
  }

  async function isServiceRunning() {
    const data = await chrome.storage.local.get("serviceRunning");
    return data.serviceRunning === true;
  }

  async function sendResult(url, status, message) {
    await chrome.runtime.sendMessage({
      type: "PULL_REQUEST_PROCESS_RESULT",
      url,
      status,
      message
    });
  }

  async function waitForApproveButton() {
    const startedAt = Date.now();

    while (Date.now() - startedAt < MAX_WAIT_TIME_MS) {
      if (!(await isServiceRunning())) {
        return {
          status: "stopped",
          button: null
        };
      }

      const button = findApproveButton();

      if (button) {
        return {
          status: "found",
          button
        };
      }

      await sleep(SEARCH_INTERVAL_MS);
    }

    return {
      status: "no_button",
      button: null
    };
  }

  async function confirmApprovalIfNecessary() {
    await sleep(700);

    const dialogs = Array.from(
      document.querySelectorAll(
        '[role="dialog"], [aria-modal="true"]'
      )
    );

    for (const dialog of dialogs) {
      const button = findApproveButton(dialog);

      if (button && await isServiceRunning()) {
        button.click();
        return true;
      }
    }

    return false;
  }

  async function execute() {
    if (executionStarted) {
      return;
    }

    executionStarted = true;

    const url = getCurrentPullRequestUrl();

    if (!url) {
      return;
    }

    if (!(await isServiceRunning())) {
      await sendResult(
        url,
        "stopped",
        "Serviço parado."
      );
      return;
    }

    const result = await waitForApproveButton();

    if (result.status === "stopped") {
      await sendResult(
        url,
        "stopped",
        "Serviço interrompido."
      );
      return;
    }

    if (result.status === "no_button") {
      await sendResult(
        url,
        "no_button",
        "Sem botão de aprovação."
      );
      return;
    }

    if (!(await isServiceRunning())) {
      await sendResult(
        url,
        "stopped",
        "Serviço interrompido."
      );
      return;
    }

    result.button.scrollIntoView({
      behavior: "smooth",
      block: "center"
    });

    await sleep(350);

    if (!(await isServiceRunning())) {
      await sendResult(
        url,
        "stopped",
        "Serviço interrompido."
      );
      return;
    }

    result.button.click();
    await confirmApprovalIfNecessary();

    await sendResult(
      url,
      "approved",
      "Aprovado."
    );
  }

  window.setTimeout(() => {
    void execute().catch(async (error) => {
      const url = getCurrentPullRequestUrl();

      if (url) {
        await sendResult(
          url,
          "no_button",
          error.message
        );
      }
    });
  }, 1200);
})();
