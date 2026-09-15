const STORAGE_KEY = "gco-settings";
const DEFAULT_SETTINGS = {
  tests: true,
  adrs: false,
  specs: false,
  ai: false,
  custom: [],
};

const storage = typeof browser !== "undefined" ? browser.storage : chrome.storage;

const settings = { ...DEFAULT_SETTINGS };

function parseCustom(text) {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

async function persist() {
  await storage.sync.set({ [STORAGE_KEY]: settings });
}

async function init() {
  const stored = await storage.sync.get(STORAGE_KEY);
  Object.assign(settings, DEFAULT_SETTINGS, stored?.[STORAGE_KEY] || {});
  if (!Array.isArray(settings.custom)) settings.custom = [];

  for (const input of document.querySelectorAll("input[data-key]")) {
    input.checked = Boolean(settings[input.dataset.key]);
    input.addEventListener("change", async () => {
      settings[input.dataset.key] = input.checked;
      await persist();
    });
  }

  const custom = document.getElementById("custom");
  custom.value = settings.custom.join("\n");
  custom.addEventListener("change", async () => {
    settings.custom = parseCustom(custom.value);
    await persist();
  });
}

init();
