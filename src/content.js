(() => {
const { shouldHide, normalizePath, isReviewPage } = globalThis.GitHubCodeOnly;

const STORAGE_KEY = "gco-settings";
const DIMMED_CLASS = "gco-dimmed";
const FOCUS_CLASS = "gco-focus";
const DEFAULT_SETTINGS = {
  tests: true,
  adrs: false,
  specs: false,
  ai: false,
  custom: [],
};

const FILTERS = [
  { id: "tests", label: "Tests", title: "Dim test files and folders" },
  { id: "adrs", label: "ADRs", title: "Dim Architecture Decision Records" },
  { id: "specs", label: "Specs", title: "Dim spec docs and PRDs (does not dim *.spec.ts tests)" },
  { id: "ai", label: "AI", title: "Dim Cursor, Copilot, agent, and generated files" },
];

const storage = typeof browser !== "undefined" ? browser.storage : chrome.storage;

let settings = { ...DEFAULT_SETTINGS };
let applyTimer = 0;
let observer = null;
let lastUrl = location.href;

function onReviewPage() {
  return isReviewPage(location.pathname);
}

async function loadSettings() {
  try {
    const stored = await storage.sync.get(STORAGE_KEY);
    const value = stored?.[STORAGE_KEY] || {};
    settings = {
      ...DEFAULT_SETTINGS,
      ...value,
      custom: Array.isArray(value.custom) ? value.custom : DEFAULT_SETTINGS.custom,
    };
  } catch {
    settings = { ...DEFAULT_SETTINGS };
  }
}

async function saveSettings() {
  await storage.sync.set({ [STORAGE_KEY]: settings });
}

function parseHydroPath(value) {
  if (!value) return "";
  try {
    const payload = JSON.parse(value);
    return payload?.payload?.data?.path || payload?.data?.path || "";
  } catch {
    return "";
  }
}

function pathFromElement(el) {
  if (!el || el.nodeType !== 1) return "";
  return (
    el.getAttribute("data-tagsearch-path") ||
    el.getAttribute("data-file-path") ||
    el.getAttribute("data-path") ||
    parseHydroPath(el.getAttribute("data-hydro-click-payload")) ||
    ""
  );
}

function looksLikePath(value) {
  const text = normalizePath(value).replace(/\u200E/g, "");
  if (!text || text.length > 400) return "";
  if (text.includes("://") || text.startsWith("#")) return "";
  if (!/[\w.-]+\.[A-Za-z0-9]{1,8}$/.test(text) && !text.includes("/")) return "";
  if (/\s/.test(text) && !text.includes("/")) return "";
  return text.split(/\s+/)[0];
}

function pathFromReactHeader(el) {
  const nameEl = el.querySelector(
    '[class*="DiffFileHeader-module__file-name"], [class*="file-name"]'
  );
  const source = nameEl || el;
  const text = (source.textContent || "").replace(/\u200E/g, " ").replace(/\s+/g, " ").trim();
  if (!text) return "";
  const renamed = text.split(/\s*→\s*/);
  const candidate = renamed[renamed.length - 1] || text;
  const tokens = candidate.split(" ").filter((token) => looksLikePath(token) || token.includes("/"));
  return normalizePath(tokens[tokens.length - 1] || candidate.split(" ")[0] || "");
}

function collectDiffs() {
  const nodes = [
    ...document.querySelectorAll("copilot-diff-entry[data-file-path]"),
    ...document.querySelectorAll("div.file.js-file[data-tagsearch-path]"),
    ...document.querySelectorAll("div.file-header[data-path]"),
    ...document.querySelectorAll("[data-file-path]"),
    ...document.querySelectorAll('[class*="DiffFileHeader-module__diff-file-header"]'),
    ...document.querySelectorAll('[class*="DiffFileHeader-module__file-name"]'),
    ...document.querySelectorAll('[class*="Diff-module__diffHeaderWrapper"]'),
    ...document.querySelectorAll('div[id^="diff-"]'),
  ];

  const seen = new Set();
  const diffs = [];
  for (const node of nodes) {
    if (node.id === "diff-layout-component") continue;
    let path = normalizePath(pathFromElement(node));
    if (!path) path = pathFromReactHeader(node);

    let target = node;
    if (node.classList.contains("file-header") || node.matches?.('[class*="DiffFileHeader-module"], [class*="Diff-module__diffHeader"]')) {
      target =
        node.closest("div.file.js-file, copilot-diff-entry, [data-details-container-group='file'], [id^='diff-']") ||
        node.closest('[class*="Diff-module"]') ||
        node;
    }
    if (target.id === "diff-layout-component") continue;
    if (!path || seen.has(target)) continue;
    seen.add(target);
    diffs.push({ path, el: target });
  }
  return diffs;
}

function directTreeLabel(el) {
  const titled = looksLikePath(el.getAttribute("title") || "") || looksLikePath(el.getAttribute("aria-label") || "");
  if (titled) return titled;

  for (const child of el.children) {
    const role = child.getAttribute("role");
    if (role === "group" || role === "treeitem") continue;
    if (child.querySelector?.('[role="treeitem"], [role="group"]')) continue;
    const text = (child.textContent || "").replace(/\s+/g, " ").trim();
    if (text) return text.split(" ")[0];
  }

  const first = (el.innerText || "")
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean);
  return first ? first.split(" ")[0] : "";
}

function pathFromTreeItem(el) {
  const attr = pathFromElement(el);
  if (attr.includes("/")) return attr;

  const label = directTreeLabel(el);
  if (label.includes("/")) return label;

  const parts = [];
  const treeRoot = el.closest('[role="tree"]');
  let node = el;
  while (node && node !== treeRoot) {
    const isItem =
      node.getAttribute?.("role") === "treeitem" ||
      node.getAttribute?.("data-tree-entry-type") === "file" ||
      node.getAttribute?.("data-tree-entry-type") === "directory";
    if (isItem) {
      const name = directTreeLabel(node);
      if (name.includes("/")) return name;
      if (name) parts.unshift(name);
    }
    node = node.parentElement;
  }
  return parts.join("/");
}

function treePathFallback(el) {
  return pathFromTreeItem(el);
}

function collectTreeFiles() {
  const items = [
    ...document.querySelectorAll("[data-tree-entry-type='file']"),
    ...document.querySelectorAll('[role="tree"] [role="treeitem"]'),
  ];
  const seen = new Set();
  const files = [];
  for (const el of items) {
    if (el.getAttribute("data-tree-entry-type") === "directory") continue;
    if (el.querySelector('[role="treeitem"], [data-tree-entry-type="file"], [data-tree-entry-type="directory"]')) {
      continue;
    }
    const path = normalizePath(pathFromTreeItem(el) || treePathFallback(el));
    if (!path || seen.has(el)) continue;
    seen.add(el);
    files.push({ path, el });
  }
  return files;
}

function dimFullyFilteredDirectories() {
  const dirs = [
    ...document.querySelectorAll("[data-tree-entry-type='directory']"),
    ...document.querySelectorAll('[role="tree"] [role="treeitem"][aria-expanded]'),
  ];
  dirs.sort((a, b) => (b.querySelectorAll("[role='treeitem']").length || 0) - (a.querySelectorAll("[role='treeitem']").length || 0));
  for (const dir of dirs) {
    const files = [
      ...dir.querySelectorAll("[data-tree-entry-type='file']"),
      ...[...dir.querySelectorAll('[role="treeitem"]')].filter(
        (item) => item !== dir && !item.hasAttribute("aria-expanded") && !item.querySelector('[role="treeitem"]')
      ),
    ];
    const unique = [...new Set(files)];
    const focused = unique.filter((file) => !file.classList.contains(DIMMED_CLASS));
    const allDimmed = unique.length > 0 && focused.length === 0;
    dir.classList.toggle(DIMMED_CLASS, allDimmed);
    dir.classList.toggle(FOCUS_CLASS, !allDimmed && unique.length > 0);
  }
}

function applyFilters() {
  if (!onReviewPage()) {
    document.getElementById("gco-bar")?.remove();
    return;
  }

  ensureBar();

  const diffs = collectDiffs();
  const treeFiles = collectTreeFiles();
  const uniquePaths = new Set();

  const applyTo = (item) => {
    if (!item.path) return;
    uniquePaths.add(item.path);
    const reason = shouldHide(item.path, settings);
    item.el.classList.toggle(DIMMED_CLASS, Boolean(reason));
    item.el.classList.toggle(FOCUS_CLASS, !reason);
    if (reason) item.el.setAttribute("data-gco-reason", reason);
    else item.el.removeAttribute("data-gco-reason");
  };

  diffs.forEach(applyTo);
  treeFiles.forEach(applyTo);

  const dimmedPaths = new Set(
    [...diffs, ...treeFiles]
      .filter((item) => item.el.classList.contains(DIMMED_CLASS))
      .map((item) => item.path)
  );
  const dimmedCount = dimmedPaths.size;
  const total = uniquePaths.size || dimmedCount;
  const focused = Math.max(total - dimmedCount, 0);

  dimFullyFilteredDirectories();
  updateBar(dimmedCount, focused);
}

function scheduleApply() {
  window.clearTimeout(applyTimer);
  applyTimer = window.setTimeout(applyFilters, 60);
}

function allOptionalOn() {
  return FILTERS.every((filter) => settings[filter.id]);
}

function isNewFilesUi() {
  return (
    /\/pull\/\d+\/changes(?:\/|$)/.test(location.pathname) ||
    Boolean(document.querySelector('input[placeholder*="Filter file" i]:not(#file-tree-filter-field)')) ||
    Boolean(document.querySelector('[class*="DiffFileHeader-module"]'))
  );
}

function findHost() {
  if (isNewFilesUi()) return null;

  return (
    document.querySelector(".pr-toolbar .diffbar") ||
    document.querySelector(".pr-toolbar") ||
    document.querySelector("[data-target='diff-layout.diffToolbar']") ||
    document.querySelector("#files") ||
    document.querySelector('[aria-label="File Tree Navigation"]')?.parentElement
  );
}

function ensureBar() {
  let bar = document.getElementById("gco-bar");
  if (!bar) {
    bar = document.createElement("div");
    bar.id = "gco-bar";
    bar.className = "gco-bar";
    bar.setAttribute("role", "toolbar");
    bar.setAttribute("aria-label", "Code Only review filter");
    bar.innerHTML = `
      <span class="gco-brand" title="GitHub Code Only">Code Only</span>
      ${FILTERS.map(
        (filter) => `
          <button type="button" class="gco-chip" data-filter="${filter.id}" title="${filter.title}" aria-pressed="false">
            ${filter.label}
          </button>`
      ).join("")}
      <button type="button" class="gco-chip gco-chip-all" data-action="all" title="Dim tests, ADRs, specs, and AI files">
        Code only
      </button>
      <span class="gco-count" data-role="count"></span>
    `;

    bar.addEventListener("click", async (event) => {
      const button = event.target.closest("button");
      if (!button) return;

      if (button.dataset.action === "all") {
        const enable = !allOptionalOn();
        for (const filter of FILTERS) settings[filter.id] = enable;
      } else if (button.dataset.filter) {
        const id = button.dataset.filter;
        settings[id] = !settings[id];
      } else {
        return;
      }

      await saveSettings();
      renderBarState();
      applyFilters();
    });
  }

  const host = findHost();
  bar.classList.toggle("gco-bar--floating", !host);
  const parent = host || document.body;
  if (bar.parentElement !== parent) parent.appendChild(bar);

  renderBarState();
  return bar;
}

function renderBarState() {
  const bar = document.getElementById("gco-bar");
  if (!bar) return;
  for (const filter of FILTERS) {
    const chip = bar.querySelector(`[data-filter="${filter.id}"]`);
    if (!chip) continue;
    const on = Boolean(settings[filter.id]);
    chip.classList.toggle("is-on", on);
    chip.setAttribute("aria-pressed", String(on));
  }
  const all = bar.querySelector('[data-action="all"]');
  if (all) {
    const on = allOptionalOn();
    all.classList.toggle("is-on", on);
    all.setAttribute("aria-pressed", String(on));
  }
}

function updateBar(dimmed, focused) {
  const count = document.querySelector("#gco-bar [data-role='count']");
  if (!count) return;
  if (dimmed === 0) {
    count.textContent = `${focused} file${focused === 1 ? "" : "s"} in focus`;
  } else {
    count.textContent = `${dimmed} dimmed · ${focused} in focus`;
  }
}

function observe() {
  observer?.disconnect();
  observer = new MutationObserver((mutations) => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      document.getElementById("gco-bar")?.remove();
      scheduleApply();
      return;
    }
    const relevant = mutations.some((mutation) => {
      if (mutation.target?.closest?.("#gco-bar")) return false;
      return [...mutation.addedNodes].some(
        (node) =>
          node.nodeType === 1 &&
          (node.matches?.(
            "div.file, copilot-diff-entry, li.js-tree-node, .pr-toolbar, #files, [class*='Diff-module'], [class*='DiffFileHeader-module'], [role='treeitem']"
          ) ||
            node.querySelector?.(
              "div.file, copilot-diff-entry, li.js-tree-node, .pr-toolbar, #files, [class*='Diff-module'], [class*='DiffFileHeader-module'], [role='treeitem']"
            ))
      );
    });
    if (relevant) scheduleApply();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
}

function bindNavigation() {
  const rerun = () => {
    lastUrl = location.href;
    document.getElementById("gco-bar")?.remove();
    scheduleApply();
  };
  document.addEventListener("turbo:load", rerun);
  document.addEventListener("turbo:render", rerun);
  document.addEventListener("pjax:end", rerun);
  document.addEventListener("soft-nav:end", rerun);
  window.addEventListener("popstate", rerun);
}

storage.onChanged.addListener((changes, area) => {
  if (area !== "sync" || !changes[STORAGE_KEY]) return;
  const value = changes[STORAGE_KEY].newValue || {};
  settings = {
    ...DEFAULT_SETTINGS,
    ...value,
    custom: Array.isArray(value.custom) ? value.custom : [],
  };
  renderBarState();
  scheduleApply();
});

loadSettings().then(() => {
  bindNavigation();
  observe();
  applyFilters();
});
})();
