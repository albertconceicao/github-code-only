(() => {
const { shouldHide, normalizePath, basename, fileNameTokens, textMatchesExclusivePath, isReviewPage } =
  globalThis.GitHubCodeOnly;

const STORAGE_KEY = "gco-settings";
const DIMMED_CLASS = "gco-dimmed";
const FOCUS_CLASS = "gco-focus";
const STRIKE_CLASS = "gco-strike";
const DEFAULT_SETTINGS = {
  tests: true,
  adrs: false,
  specs: false,
  ai: false,
  autoCollapse: true,
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
let syncingCollapse = false;

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

function isLayoutNode(el) {
  if (!el || el.nodeType !== 1) return true;
  const id = el.id || "";
  if (id === "diff-layout-component" || id.startsWith("diff-layout") || id === "files") return true;
  const cls = String(el.className || "");
  if (/diff-sidebar|Layout-sidebar|diff-view|DiffList|file-tree/i.test(cls)) return true;
  return false;
}

function isHeaderRoot(el) {
  if (!el || el.nodeType !== 1) return false;
  if (el.classList?.contains("file-header")) return true;
  const cls = String(el.className || "");
  return /DiffFileHeader-module__diff-file-header|Diff-module__diffHeaderWrapper/i.test(cls);
}

function headerRoots(el) {
  if (!el || el.nodeType !== 1) return [];
  const found = [];
  if (isHeaderRoot(el)) found.push(el);
  el.querySelectorAll(
    ".file-header, [class*='DiffFileHeader-module__diff-file-header'], [class*='Diff-module__diffHeaderWrapper']"
  ).forEach((node) => found.push(node));
  return [...new Set(found)].filter((node) => !found.some((other) => other !== node && other.contains(node)));
}

function headerPath(el) {
  return normalizePath(pathFromElement(el) || pathFromReactHeader(el));
}

function pathsMatch(left, right) {
  if (!left || !right) return false;
  const a = normalizePath(left);
  const b = normalizePath(right);
  return a === b || basename(a).toLowerCase() === basename(b).toLowerCase();
}

function ownLabelText(el) {
  if (!el) return "";
  const titled = `${el.getAttribute("title") || ""} ${el.getAttribute("aria-label") || ""}`.trim();
  if (titled && fileNameTokens(titled).length === 1) return titled;

  const clone = el.cloneNode(true);
  clone
    .querySelectorAll('[role="treeitem"], [role="group"], [data-tree-entry-type], [class*="DiffFileHeader"], .file-header')
    .forEach((node) => {
      if (node !== clone) node.remove();
    });
  return (clone.textContent || "").replace(/\s+/g, " ").trim();
}

function exclusiveLabel(el, path) {
  if (!el || !path) return null;
  const base = basename(path).toLowerCase();
  const nodes = [el, ...el.querySelectorAll("a, span, [class*='file-name'], [class*='ItemLabel']")];
  let best = null;
  for (const node of nodes) {
    if (node.id === "gco-bar" || node.closest?.("#gco-bar")) continue;
    const text = `${node.getAttribute?.("title") || ""} ${node.getAttribute?.("aria-label") || ""} ${
      node.textContent || ""
    }`;
    if (!textMatchesExclusivePath(text, path)) continue;
    best = node;
  }
  if (best) return best;
  for (const node of nodes) {
    const text = (node.textContent || "").replace(/\s+/g, " ").trim().toLowerCase();
    if (text === base || text.endsWith(`/${base}`)) best = node;
  }
  return best;
}

function fileTitleNodes(el) {
  if (!el?.querySelectorAll) return [];
  return [
    ...el.querySelectorAll(
      '[class*="DiffFileHeader-module__file-name"], [class*="DiffFileHeader-module__fileName"], .file-header a.Link--primary'
    ),
  ];
}

function expandExclusiveCard(start) {
  if (!start) return null;
  let card = start;
  let node = start.parentElement;
  while (node && node !== document.body) {
    if (isLayoutNode(node) || node.id === "diff-layout-component") break;
    if (headerRoots(node).length > 1 || fileTitleNodes(node).length > 1) break;
    card = node;
    if (
      node.matches?.(
        "div.file.js-file, copilot-diff-entry, [data-details-container-group='file'], details, .js-details-container"
      )
    ) {
      return node;
    }
    node = node.parentElement;
  }
  return card;
}

function fileSlice(header) {
  const nodes = [header];
  let sib = header.nextElementSibling;
  while (sib) {
    if (isHeaderRoot(sib) || headerRoots(sib).length > 0) break;
    nodes.push(sib);
    sib = sib.nextElementSibling;
  }
  return nodes;
}

function visualTargets(el, path) {
  if (el.closest?.('[role="tree"]')) {
    const treeRow = el.closest('[role="treeitem"], [data-tree-entry-type="file"]') || el;
    const nested = [...treeRow.querySelectorAll('[role="treeitem"], [data-tree-entry-type="file"]')].filter(
      (node) => node !== treeRow
    );
    if (treeRow.hasAttribute("aria-expanded") || nested.length > 0) {
      const label = exclusiveLabel(treeRow, path);
      return label ? [label] : [];
    }
    return [treeRow];
  }

  const header = findMatchingHeader(el, path);
  const card = expandExclusiveCard(header || el);
  if (card && headerRoots(card).length <= 1 && fileTitleNodes(card).length <= 1 && !isLayoutNode(card)) {
    return [card];
  }
  if (header) return fileSlice(header);
  return [el];
}

function findMatchingHeader(el, path) {
  if (!el || !path) return null;
  const roots = headerRoots(el);
  const match = roots.find((header) => pathsMatch(headerPath(header), path));
  if (match) return match;
  if (isHeaderRoot(el) && pathsMatch(headerPath(el), path)) return el;
  const closest = el.closest?.(
    ".file-header, [class*='DiffFileHeader-module__diff-file-header'], [class*='Diff-module__diffHeaderWrapper']"
  );
  if (closest && pathsMatch(headerPath(closest), path)) return closest;
  return null;
}

function fileUnitFrom(node) {
  if (!node || node.nodeType !== 1 || isLayoutNode(node)) return null;

  const exact = node.closest(
    "div.file.js-file[data-tagsearch-path], copilot-diff-entry[data-file-path], [data-details-container-group='file']"
  );
  if (exact && headerRoots(exact).length <= 1) return exact;

  const hashed = node.closest('div[id^="diff-"]');
  if (hashed && /^diff-[a-f0-9]{16,}$/i.test(hashed.id) && headerRoots(hashed).length <= 1) return hashed;

  const header =
    node.closest('[class*="DiffFileHeader-module__diff-file-header"]') ||
    node.closest('[class*="Diff-module__diffHeaderWrapper"]') ||
    (node.classList?.contains("file-header") ? node : null);
  if (header) return expandExclusiveCard(header) || header;
  return expandExclusiveCard(node);
}

function clearMarks() {
  document.querySelectorAll(`.${DIMMED_CLASS}, .${FOCUS_CLASS}, .${STRIKE_CLASS}`).forEach((el) => {
    if (el.id === "gco-bar" || el.closest("#gco-bar")) return;
    el.classList.remove(DIMMED_CLASS, FOCUS_CLASS, STRIKE_CLASS);
    el.removeAttribute("data-gco-reason");
  });
}

function collectDiffs() {
  const nodes = [
    ...document.querySelectorAll("copilot-diff-entry[data-file-path]"),
    ...document.querySelectorAll("div.file.js-file[data-tagsearch-path]"),
    ...document.querySelectorAll("div.file-header[data-path]"),
    ...document.querySelectorAll('[class*="DiffFileHeader-module__diff-file-header"]'),
    ...document.querySelectorAll('[class*="DiffFileHeader-module__file-name"]'),
    ...document.querySelectorAll('[class*="Diff-module__diffHeaderWrapper"]'),
  ];

  const seen = new Set();
  const diffs = [];
  for (const node of nodes) {
    const target = fileUnitFrom(node);
    if (!target || seen.has(target)) continue;
    let path = normalizePath(pathFromElement(target) || pathFromElement(node));
    if (!path) path = pathFromReactHeader(target) || pathFromReactHeader(node);
    if (!path) continue;
    seen.add(target);
    diffs.push({ path, el: target });
  }
  return diffs;
}

function directTreeLabel(el) {
  const titled = looksLikePath(el.getAttribute("title") || "") || looksLikePath(el.getAttribute("aria-label") || "");
  if (titled && fileNameTokens(titled).length <= 1) return titled;

  const own = ownLabelText(el);
  const tokens = fileNameTokens(own);
  if (tokens.length === 1) return tokens[0];
  if (own && fileNameTokens(own).length <= 1) {
    const text = own.replace(/\u200E/g, " ").replace(/\s+/g, " ").trim();
    if (text) return text.split(" ")[0];
  }
  return "";
}

function pathFromTreeItem(el) {
  const attr = pathFromElement(el);
  if (attr.includes("/") && fileNameTokens(attr).length <= 1) return attr;

  const ownName = directTreeLabel(el);
  const parts = [];
  if (ownName && !ownName.includes("/")) parts.push(ownName);
  else if (ownName.includes("/")) return ownName;

  const treeRoot = el.closest('[role="tree"]');
  let node = el.parentElement;
  while (node && node !== treeRoot) {
    const isItem =
      node.getAttribute?.("role") === "treeitem" ||
      node.getAttribute?.("data-tree-entry-type") === "directory";
    if (isItem) {
      const name = directTreeLabel(node);
      const nameTokens = fileNameTokens(name);
      if (name && nameTokens.length === 0 && !name.includes(".")) {
        parts.unshift(name);
      }
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
    ...document.querySelectorAll('[role="tree"] a[href]'),
  ];
  const seen = new Set();
  const files = [];
  for (const el of items) {
    if (el.getAttribute("data-tree-entry-type") === "directory") continue;
    if (el.hasAttribute("aria-expanded")) continue;
    if (el.querySelector('[role="treeitem"], [data-tree-entry-type="file"], [data-tree-entry-type="directory"]')) {
      continue;
    }
    const path = normalizePath(pathFromTreeItem(el) || treePathFallback(el) || looksLikePath(el.textContent || ""));
    if (!path || !basename(path).includes(".") || seen.has(el)) continue;
    seen.add(el);
    files.push({ path, el });
  }
  return files;
}

function isCollapseControl(btn) {
  const label = (btn.getAttribute("aria-label") || "").toLowerCase();
  if (
    label.includes("viewed") ||
    label.includes("copy") ||
    label.includes("menu") ||
    label.includes("comment") ||
    label.includes("expand up") ||
    label.includes("expand down") ||
    label.includes("expand all")
  ) {
    return false;
  }
  if (btn.querySelector(".octicon-kebab-horizontal, .octicon-copy, .octicon-eye")) return false;
  return true;
}

function findCollapseButton(header, collapsed) {
  const scope = header || document;
  const buttons = [...scope.querySelectorAll("button")].filter(isCollapseControl);

  for (const btn of buttons) {
    const expanded = btn.getAttribute("aria-expanded");
    if (collapsed && expanded === "true") return btn;
    if (!collapsed && expanded === "false") return btn;
    if (collapsed && btn.querySelector(".octicon-chevron-down, .octicon-triangle-down")) return btn;
    if (!collapsed && btn.querySelector(".octicon-chevron-right, .octicon-triangle-right")) return btn;
    const label = (btn.getAttribute("aria-label") || "").toLowerCase();
    if (collapsed && (label.includes("collapse") || label.includes("toggle diff") || label.includes("toggle file"))) {
      if (expanded === "false") continue;
      return btn;
    }
    if (!collapsed && (label.includes("expand file") || label === "expand" || label.includes("toggle diff") || label.includes("toggle file"))) {
      if (expanded === "true") continue;
      return btn;
    }
  }
  return null;
}

function setDiffCollapsed(fileEl, collapsed, path) {
  const header = findMatchingHeader(fileEl, path) || fileEl;
  if (!header || header.id === "diff-layout-component") return false;
  const card = expandExclusiveCard(header);

  if (card && headerRoots(card).length <= 1) {
    const details = card.matches("details") ? card : card.querySelector(":scope > details");
    if (details && typeof details.open === "boolean") {
      if (details.open === !collapsed) return false;
      details.open = !collapsed;
      return true;
    }

    if (card.classList.contains("js-details-container") || card.classList.contains("Details")) {
      const isOpen = card.classList.contains("open") || card.classList.contains("Details--on");
      if (isOpen === !collapsed) return false;
      card.classList.toggle("open", !collapsed);
      card.classList.toggle("Details--on", !collapsed);
      const toggle = card.querySelector(".file-header [aria-expanded], button[aria-label='Toggle diff contents']");
      if (toggle) toggle.setAttribute("aria-expanded", String(!collapsed));
      return true;
    }
  }

  const btn = findCollapseButton(header, collapsed) || (card && card !== header ? findCollapseButton(card, collapsed) : null);
  if (!btn) return false;
  btn.click();
  return true;
}

function collapseSkippedDiffs(collapsed) {
  syncingCollapse = true;
  observer?.disconnect();
  try {
    for (const item of collectDiffs()) {
      if (!shouldHide(item.path, settings)) continue;
      setDiffCollapsed(item.el, collapsed, item.path);
    }
  } finally {
    window.setTimeout(() => {
      syncingCollapse = false;
      observe();
    }, 250);
  }
}

function applyFilters() {
  if (!onReviewPage()) {
    document.getElementById("gco-bar")?.remove();
    return;
  }

  ensureBar();
  clearMarks();

  const diffs = collectDiffs();
  const treeFiles = collectTreeFiles();
  const uniquePaths = new Set();

  const applyTo = (item) => {
    if (!item.path) return;
    uniquePaths.add(item.path);
    const reason = shouldHide(item.path, settings);
    const targets = visualTargets(item.el, item.path);
    for (const target of targets) {
      if (!target || target.id === "gco-bar" || target.closest("#gco-bar")) continue;
      target.classList.toggle(DIMMED_CLASS, Boolean(reason));
      target.classList.toggle(FOCUS_CLASS, !reason);
      if (reason) target.setAttribute("data-gco-reason", reason);
      else target.removeAttribute("data-gco-reason");
    }
    const label = exclusiveLabel(item.el, item.path);
    if (label && label !== item.el) {
      label.classList.toggle(STRIKE_CLASS, Boolean(reason));
    } else if (reason && targets[0]) {
      targets[0].classList.add(STRIKE_CLASS);
    }
  };

  diffs.forEach(applyTo);
  treeFiles.forEach(applyTo);

  const dimmedPaths = new Set(
    [...diffs, ...treeFiles].filter((item) => shouldHide(item.path, settings)).map((item) => item.path)
  );
  const dimmedCount = dimmedPaths.size;
  const total = uniquePaths.size || dimmedCount;
  const focused = Math.max(total - dimmedCount, 0);

  updateBar(dimmedCount, focused);
  if (settings.autoCollapse !== false && !syncingCollapse) {
    collapseSkippedDiffs(true);
  }
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
      <button type="button" class="gco-chip" data-action="collapse-toggle" title="Collapse or expand skipped diffs">
        Collapse skipped
      </button>
      <span class="gco-count" data-role="count"></span>
    `;

    bar.addEventListener("click", async (event) => {
      const button = event.target.closest("button");
      if (!button) return;

      if (button.dataset.action === "all") {
        const enable = !allOptionalOn();
        for (const filter of FILTERS) settings[filter.id] = enable;
      } else if (button.dataset.action === "collapse-toggle") {
        settings.autoCollapse = settings.autoCollapse === false;
        await saveSettings();
        renderBarState();
        collapseSkippedDiffs(settings.autoCollapse !== false);
        return;
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
  const collapse = bar.querySelector('[data-action="collapse-toggle"]');
  if (collapse) {
    const on = settings.autoCollapse !== false;
    collapse.classList.toggle("is-on", on);
    collapse.setAttribute("aria-pressed", String(on));
    collapse.textContent = on ? "Expand skipped" : "Collapse skipped";
    collapse.title = on
      ? "Skipped diffs are auto-collapsed. Click to expand them."
      : "Collapse skipped diffs and keep collapsing them as files load";
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
    if (syncingCollapse) return;
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
