const STORAGE_KEY = "gco-settings";
const DEFAULT_SETTINGS = {
  tests: true,
  adrs: false,
  specs: false,
  ai: false,
  autoCollapse: true,
  custom: [],
};
// Typing in the patterns box saves after a short pause so an edit is not lost when the popup closes.
const SAVE_DEBOUNCE_MS = 400;

const storage = typeof browser !== "undefined" ? browser.storage : chrome.storage;

const settings = { ...DEFAULT_SETTINGS };
let saveTimer = 0;

function parseCustom(text) {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function persist() {
  window.clearTimeout(saveTimer);
  return storage.sync.set({ [STORAGE_KEY]: settings }).catch((error) => {
    console.warn("GitHub Code Only: could not save settings", error);
  });
}

function schedulePersist() {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(persist, SAVE_DEBOUNCE_MS);
}

async function init() {
  try {
    const stored = await storage.sync.get(STORAGE_KEY);
    Object.assign(settings, stored?.[STORAGE_KEY] || {});
  } catch (error) {
    console.warn("GitHub Code Only: could not load settings", error);
  }
  if (!Array.isArray(settings.custom)) settings.custom = [];

  for (const input of document.querySelectorAll("input[data-key]")) {
    input.checked = Boolean(settings[input.dataset.key]);
    input.addEventListener("change", () => {
      settings[input.dataset.key] = input.checked;
      persist();
    });
  }

  const custom = document.getElementById("custom");
  custom.value = settings.custom.join("\n");
  custom.addEventListener("input", () => {
    settings.custom = parseCustom(custom.value);
    schedulePersist();
  });
  custom.addEventListener("change", () => {
    settings.custom = parseCustom(custom.value);
    persist();
  });
}

init();
