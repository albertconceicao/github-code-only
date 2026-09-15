(() => {
const { shouldHide, normalizePath, basename, fileNameTokens, textMatchesExclusivePath, isReviewPage } =
  globalThis.GitHubCodeOnly;

const STORAGE_KEY = "gco-settings";
const BAR_ID = "gco-bar";
const DIMMED_CLASS = "gco-dimmed";
const FOCUS_CLASS = "gco-focus";
const STRIKE_CLASS = "gco-strike";
const REASON_ATTR = "data-gco-reason";
const APPLY_DEBOUNCE_MS = 60;
// How long GitHub's own re-render after a collapse click is allowed to settle before we react to it.
const COLLAPSE_SETTLE_MS = 250;

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

const HEADER_SELECTOR =
  ".file-header, [class*='DiffFileHeader-module__diff-file-header'], [class*='Diff-module__diffHeaderWrapper']";
const FILE_TITLE_SELECTOR =
  '[class*="DiffFileHeader-module__file-name"], [class*="DiffFileHeader-module__fileName"], .file-header a.Link--primary';
const FILE_CARD_SELECTOR =
  "div.file.js-file, copilot-diff-entry, [data-details-container-group='file'], details, .js-details-container";
const DIFF_NODE_SELECTORS = [
  "copilot-diff-entry[data-file-path]",
  "div.file.js-file[data-tagsearch-path]",
  "div.file-header[data-path]",
  '[class*="DiffFileHeader-module__diff-file-header"]',
  '[class*="DiffFileHeader-module__file-name"]',
  '[class*="Diff-module__diffHeaderWrapper"]',
];
const TREE_ROW_SELECTOR = '[role="treeitem"], [data-tree-entry-type="file"]';
const TREE_NODE_SELECTOR = '[role="treeitem"], [data-tree-entry-type="file"], [data-tree-entry-type="directory"]';
const TREE_ITEM_SELECTOR = "[data-tree-entry-type='file'], [role='tree'] [role='treeitem'], [role='tree'] a[href]";
const LABEL_SELECTOR = "a, span, [class*='file-name'], [class*='ItemLabel']";
const OWN_TEXT_SKIP_SELECTOR =
  '[role="treeitem"], [role="group"], [data-tree-entry-type], [class*="DiffFileHeader"], .file-header';
const RELEVANT_SELECTOR =
  "div.file, copilot-diff-entry, li.js-tree-node, .pr-toolbar, #files, [class*='Diff-module'], [class*='DiffFileHeader-module'], [role='treeitem']";

const storage = typeof browser !== "undefined" ? browser.storage : chrome.storage;

let settings = { ...DEFAULT_SETTINGS };
let applyTimer = 0;
let observer = null;
let lastUrl = location.href;
let collapseSettleTimer = 0;
let syncingCollapse = false;
let pendingApply = false;

// Per-run caches. Every file walks up through the same ancestors, so without these the diff list
// container gets re-queried once per file.
let headerCache = new WeakMap();
let titleCache = new WeakMap();
let treeLabelCache = new WeakMap();
let hideCache = new Map();

// Elements currently carrying our classes. A re-run only touches what changed instead of
// clearing and re-adding every class on every mutation.
let marked = new Set();

// Paths we already auto-collapsed on this page. A diff the user expands by hand stays expanded
// until the filters change or the page changes.
const autoCollapsed = new Set();

function onReviewPage() {
  return isReviewPage(location.pathname);
}

function beginRun() {
  headerCache = new WeakMap();
  titleCache = new WeakMap();
  treeLabelCache = new WeakMap();
  hideCache = new Map();
}

function hideReason(path) {
  let reason = hideCache.get(path);
  if (reason === undefined) {
    reason = shouldHide(path, settings);
    hideCache.set(path, reason);
  }
  return reason;
}

function mergeSettings(value) {
  const stored = value && typeof value === "object" ? value : {};
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    custom: Array.isArray(stored.custom) ? stored.custom : [],
  };
}

async function loadSettings() {
  try {
    const stored = await storage.sync.get(STORAGE_KEY);
    settings = mergeSettings(stored?.[STORAGE_KEY]);
  } catch {
    settings = { ...DEFAULT_SETTINGS };
  }
}

function saveSettings() {
  return storage.sync.set({ [STORAGE_KEY]: settings }).catch((error) => {
    console.warn("GitHub Code Only: could not save settings", error);
  });
}

function isOurs(el) {
  return Boolean(el?.closest?.(`#${BAR_ID}`));
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
  const text = normalizePath(value).replace(/‎/g, "");
  if (!text || text.length > 400) return "";
  if (text.includes("://") || text.startsWith("#")) return "";
  if (!/[\w.-]+\.[A-Za-z0-9]{1,8}$/.test(text) && !text.includes("/")) return "";
  if (/\s/.test(text) && !text.includes("/")) return "";
  return text.split(/\s+/)[0];
}

function pathFromReactHeader(el) {
  const nameEl = el.querySelector('[class*="DiffFileHeader-module__file-name"], [class*="file-name"]');
  const source = nameEl || el;
  const text = (source.textContent || "").replace(/‎/g, " ").replace(/\s+/g, " ").trim();
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
  return /diff-sidebar|Layout-sidebar|diff-view|DiffList|file-tree/i.test(cls);
}

function isHeaderRoot(el) {
  if (!el || el.nodeType !== 1) return false;
  if (el.classList.contains("file-header")) return true;
  const cls = String(el.className || "");
  return /DiffFileHeader-module__diff-file-header|Diff-module__diffHeaderWrapper/i.test(cls);
}

// Keeps only nodes not contained by another node in the list. `nodes` must be in document order
// (pre-order), which querySelectorAll guarantees: any kept ancestor of a node is then always the
// most recently kept node, so a single `contains` check per node is enough.
function outermost(nodes) {
  const kept = [];
  for (const node of nodes) {
    const last = kept[kept.length - 1];
    if (last && last.contains(node)) continue;
    kept.push(node);
  }
  return kept;
}

function headerRoots(el) {
  if (!el || el.nodeType !== 1) return [];
  let roots = headerCache.get(el);
  if (!roots) {
    const found = isHeaderRoot(el) ? [el] : [];
    for (const node of el.querySelectorAll(HEADER_SELECTOR)) found.push(node);
    roots = outermost(found);
    headerCache.set(el, roots);
  }
  return roots;
}

function fileTitleNodes(el) {
  if (!el || el.nodeType !== 1) return [];
  let nodes = titleCache.get(el);
  if (!nodes) {
    nodes = [...el.querySelectorAll(FILE_TITLE_SELECTOR)];
    titleCache.set(el, nodes);
  }
  return nodes;
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

// Text of `el` excluding nested tree rows, groups and diff headers, without cloning the subtree.
function collectOwnText(el) {
  let text = "";
  for (const child of el.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      text += child.nodeValue;
    } else if (child.nodeType === Node.ELEMENT_NODE && !child.matches(OWN_TEXT_SKIP_SELECTOR)) {
      text += collectOwnText(child);
    }
  }
  return text;
}

function ownLabelText(el) {
  if (!el) return "";
  const titled = `${el.getAttribute("title") || ""} ${el.getAttribute("aria-label") || ""}`.trim();
  if (titled && fileNameTokens(titled).length === 1) return titled;
  return collectOwnText(el).replace(/\s+/g, " ").trim();
}

// Finds the innermost node inside `scope` whose text is exactly the file's basename. `scope`
// should be the file header or tree row, never the whole diff card: the diff body has thousands
// of spans and a code line mentioning the file name would otherwise win.
function exclusiveLabel(scope, path) {
  if (!scope || !path) return null;
  const base = basename(path).toLowerCase();
  const nodes = [scope, ...scope.querySelectorAll(LABEL_SELECTOR)];
  let best = null;
  for (const node of nodes) {
    if (isOurs(node)) continue;
    const text = `${node.getAttribute("title") || ""} ${node.getAttribute("aria-label") || ""} ${node.textContent || ""}`;
    if (textMatchesExclusivePath(text, path)) best = node;
  }
  if (best) return best;
  for (const node of nodes) {
    if (isOurs(node)) continue;
    const text = (node.textContent || "").replace(/\s+/g, " ").trim().toLowerCase();
    if (text === base || text.endsWith(`/${base}`)) best = node;
  }
  return best;
}

// Walks up from a header until the next ancestor would contain more than one file.
function expandExclusiveCard(start) {
  if (!start) return null;
  let card = start;
  let node = start.parentElement;
  while (node && node !== document.body) {
    if (isLayoutNode(node)) break;
    if (headerRoots(node).length > 1 || fileTitleNodes(node).length > 1) break;
    card = node;
    if (node.matches(FILE_CARD_SELECTOR)) return node;
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

function findMatchingHeader(el, path) {
  if (!el || !path) return null;
  const roots = headerRoots(el);
  const match = roots.find((header) => pathsMatch(headerPath(header), path));
  if (match) return match;
  if (isHeaderRoot(el) && pathsMatch(headerPath(el), path)) return el;
  const closest = el.closest(HEADER_SELECTOR);
  if (closest && pathsMatch(headerPath(closest), path)) return closest;
  return null;
}

// Resolves the elements that should be dimmed for an item. Also records the header and card on
// the item so the collapse pass does not have to find them again.
function visualTargets(item) {
  const { el, path } = item;
  if (el.closest('[role="tree"]')) {
    const treeRow = el.closest(TREE_ROW_SELECTOR) || el;
    if (treeRow.hasAttribute("aria-expanded") || treeRow.querySelector(TREE_ROW_SELECTOR)) {
      const label = exclusiveLabel(treeRow, path);
      return label ? [label] : [];
    }
    return [treeRow];
  }

  const header = findMatchingHeader(el, path);
  const card = expandExclusiveCard(header || el);
  item.header = header;
  item.card = card;
  if (card && headerRoots(card).length <= 1 && fileTitleNodes(card).length <= 1 && !isLayoutNode(card)) {
    return [card];
  }
  if (header) return fileSlice(header);
  return [el];
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
    (node.classList.contains("file-header") ? node : null);
  if (header) return expandExclusiveCard(header) || header;
  return expandExclusiveCard(node);
}

function collectDiffs() {
  const seen = new Set();
  const diffs = [];
  for (const selector of DIFF_NODE_SELECTORS) {
    for (const node of document.querySelectorAll(selector)) {
      const target = fileUnitFrom(node);
      if (!target || seen.has(target)) continue;
      let path = normalizePath(pathFromElement(target) || pathFromElement(node));
      if (!path) path = pathFromReactHeader(target) || pathFromReactHeader(node);
      if (!path) continue;
      seen.add(target);
      diffs.push({ path, el: target, reason: hideReason(path) });
    }
  }
  return diffs;
}

function computeTreeLabel(el) {
  const titled = looksLikePath(el.getAttribute("title") || "") || looksLikePath(el.getAttribute("aria-label") || "");
  if (titled && fileNameTokens(titled).length <= 1) return titled;

  const own = ownLabelText(el);
  if (!own) return "";
  const tokens = fileNameTokens(own);
  if (tokens.length === 1) return tokens[0];
  if (tokens.length === 0) {
    const text = own.replace(/‎/g, " ").replace(/\s+/g, " ").trim();
    return text ? text.split(" ")[0] : "";
  }
  return "";
}

// Directory rows are visited once per file beneath them, so their label is cached per run.
function directTreeLabel(el) {
  let label = treeLabelCache.get(el);
  if (label === undefined) {
    label = computeTreeLabel(el);
    treeLabelCache.set(el, label);
  }
  return label;
}

function pathFromTreeItem(el) {
  const attr = pathFromElement(el);
  if (attr.includes("/") && fileNameTokens(attr).length <= 1) return attr;

  const ownName = directTreeLabel(el);
  if (ownName.includes("/")) return ownName;
  const parts = ownName ? [ownName] : [];

  const treeRoot = el.closest('[role="tree"]');
  let node = el.parentElement;
  while (node && node !== treeRoot) {
    const isItem =
      node.getAttribute("role") === "treeitem" || node.getAttribute("data-tree-entry-type") === "directory";
    if (isItem) {
      const name = directTreeLabel(node);
      if (name && !name.includes(".") && fileNameTokens(name).length === 0) {
        parts.unshift(name);
      }
    }
    node = node.parentElement;
  }
  return parts.join("/");
}

function collectTreeFiles() {
  const seen = new Set();
  const files = [];
  for (const el of document.querySelectorAll(TREE_ITEM_SELECTOR)) {
    if (el.getAttribute("data-tree-entry-type") === "directory") continue;
    if (el.hasAttribute("aria-expanded")) continue;
    // A row and the link inside it describe the same file; keep the first one seen.
    const row = el.closest(TREE_ROW_SELECTOR) || el;
    if (seen.has(row)) continue;
    if (el.querySelector(TREE_NODE_SELECTOR)) continue;
    const path = normalizePath(pathFromTreeItem(el) || looksLikePath(el.textContent || ""));
    if (!path || !basename(path).includes(".")) continue;
    seen.add(row);
    files.push({ path, el, reason: hideReason(path) });
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

function collapseControls(scope) {
  return [...scope.querySelectorAll("button")].filter(isCollapseControl);
}

function findCollapseButton(buttons, collapsed) {
  for (const btn of buttons) {
    const expanded = btn.getAttribute("aria-expanded");
    // When a button declares aria-expanded, trust it over its icon or label.
    if (expanded === "true" || expanded === "false") {
      if ((expanded === "true") === collapsed) return btn;
      continue;
    }
    if (collapsed && btn.querySelector(".octicon-chevron-down, .octicon-triangle-down")) return btn;
    if (!collapsed && btn.querySelector(".octicon-chevron-right, .octicon-triangle-right")) return btn;
    const label = (btn.getAttribute("aria-label") || "").toLowerCase();
    if (collapsed && (label.includes("collapse") || label.includes("toggle diff") || label.includes("toggle file"))) {
      if (expanded === "false") continue;
      return btn;
    }
    if (
      !collapsed &&
      (label.includes("expand file") || label === "expand" || label.includes("toggle diff") || label.includes("toggle file"))
    ) {
      if (expanded === "true") continue;
      return btn;
    }
  }
  return null;
}

function liveNode(el) {
  return el && el.isConnected ? el : null;
}

// Returns true when the diff was toggled, false when it was already in the requested state, and
// null when no collapse control could be found (so a later run may try again).
function setDiffCollapsed(item, collapsed) {
  const header = liveNode(item.header) || findMatchingHeader(item.el, item.path) || item.el;
  if (header.id === "diff-layout-component") return null;
  const card = liveNode(item.card) || expandExclusiveCard(header);

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

  let buttons = collapseControls(header);
  let btn = findCollapseButton(buttons, collapsed);
  if (!btn && card && card !== header) {
    const cardButtons = collapseControls(card);
    buttons = buttons.concat(cardButtons);
    btn = findCollapseButton(cardButtons, collapsed);
  }
  if (btn) {
    btn.click();
    return true;
  }
  return buttons.length > 0 ? false : null;
}

// While GitHub re-renders after our collapse clicks, mutations are queued instead of re-applied,
// then one pass runs once things settle so lazily loaded files are not missed.
function settleAfterCollapse() {
  syncingCollapse = true;
  window.clearTimeout(collapseSettleTimer);
  collapseSettleTimer = window.setTimeout(() => {
    syncingCollapse = false;
    if (pendingApply) {
      pendingApply = false;
      scheduleApply();
    }
  }, COLLAPSE_SETTLE_MS);
}

function collapseDiffs(items, collapsed, force = false) {
  let touched = false;
  for (const item of items) {
    if (!item.reason) continue;
    if (collapsed && !force && autoCollapsed.has(item.path)) continue;
    const result = setDiffCollapsed(item, collapsed);
    if (result === null) continue;
    if (collapsed) autoCollapsed.add(item.path);
    else autoCollapsed.delete(item.path);
    if (result) touched = true;
  }
  if (touched) settleAfterCollapse();
}

function setReason(el, reason) {
  const current = el.getAttribute(REASON_ATTR);
  if (reason) {
    if (current !== reason) el.setAttribute(REASON_ATTR, reason);
  } else if (current !== null) {
    el.removeAttribute(REASON_ATTR);
  }
}

function unmark(el) {
  el.classList.remove(DIMMED_CLASS, FOCUS_CLASS, STRIKE_CLASS);
  el.removeAttribute(REASON_ATTR);
}

function clearMarks() {
  document.querySelectorAll(`.${DIMMED_CLASS}, .${FOCUS_CLASS}, .${STRIKE_CLASS}`).forEach((el) => {
    if (!isOurs(el)) unmark(el);
  });
  marked = new Set();
}

function applyFilters() {
  if (!onReviewPage()) {
    document.getElementById(BAR_ID)?.remove();
    return;
  }

  beginRun();
  ensureBar();

  const diffs = collectDiffs();
  const items = diffs.concat(collectTreeFiles());

  // Decide the final state of every element first, then touch each class exactly once.
  const dimState = new Map();
  const strikeState = new Map();
  for (const item of items) {
    const targets = visualTargets(item);
    for (const target of targets) {
      if (target && !isOurs(target)) dimState.set(target, item.reason);
    }
    const label = exclusiveLabel(item.header || item.el, item.path);
    if (label && label !== item.el) {
      strikeState.set(label, Boolean(item.reason));
    } else if (item.reason && targets[0] && !isOurs(targets[0])) {
      strikeState.set(targets[0], true);
    }
  }

  const nextMarked = new Set();
  for (const [el, reason] of dimState) {
    el.classList.toggle(DIMMED_CLASS, Boolean(reason));
    el.classList.toggle(FOCUS_CLASS, !reason);
    // classList.remove rewrites the attribute even when the class is absent; toggle does not.
    if (!strikeState.has(el)) el.classList.toggle(STRIKE_CLASS, false);
    setReason(el, reason);
    nextMarked.add(el);
  }
  for (const [el, on] of strikeState) {
    el.classList.toggle(STRIKE_CLASS, on);
    nextMarked.add(el);
  }
  for (const el of marked) {
    if (!nextMarked.has(el)) unmark(el);
  }
  marked = nextMarked;

  const allPaths = new Set();
  const dimmedPaths = new Set();
  for (const item of items) {
    allPaths.add(item.path);
    if (item.reason) dimmedPaths.add(item.path);
  }
  updateBar(dimmedPaths.size, Math.max(allPaths.size - dimmedPaths.size, 0));

  if (settings.autoCollapse !== false) collapseDiffs(diffs, true);
}

function scheduleApply() {
  window.clearTimeout(applyTimer);
  applyTimer = window.setTimeout(applyFilters, APPLY_DEBOUNCE_MS);
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

function chipButton(label, title) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "gco-chip";
  button.title = title;
  button.textContent = label;
  return button;
}

function buildBar() {
  const bar = document.createElement("div");
  bar.id = BAR_ID;
  bar.className = "gco-bar";
  bar.setAttribute("role", "toolbar");
  bar.setAttribute("aria-label", "Code Only review filter");

  const brand = document.createElement("span");
  brand.className = "gco-brand";
  brand.title = "GitHub Code Only";
  brand.textContent = "Code Only";
  bar.append(brand);

  for (const filter of FILTERS) {
    const chip = chipButton(filter.label, filter.title);
    chip.dataset.filter = filter.id;
    chip.setAttribute("aria-pressed", "false");
    bar.append(chip);
  }

  const all = chipButton("Code only", "Dim tests, ADRs, specs, and AI files");
  all.classList.add("gco-chip-all");
  all.dataset.action = "all";

  const collapse = chipButton("Collapse skipped", "Collapse or expand skipped diffs");
  collapse.dataset.action = "collapse-toggle";

  const count = document.createElement("span");
  count.className = "gco-count";
  count.dataset.role = "count";

  bar.append(all, collapse, count);
  bar.addEventListener("click", onBarClick);
  return bar;
}

function onBarClick(event) {
  const button = event.target.closest("button");
  if (!button) return;
  const { action, filter } = button.dataset;

  if (action === "collapse-toggle") {
    settings.autoCollapse = settings.autoCollapse === false;
    renderBarState();
    beginRun();
    collapseDiffs(collectDiffs(), settings.autoCollapse !== false, true);
    saveSettings();
    return;
  }

  if (action === "all") {
    const enable = !allOptionalOn();
    for (const item of FILTERS) settings[item.id] = enable;
  } else if (filter) {
    settings[filter] = !settings[filter];
  } else {
    return;
  }

  // Update the page first, then persist; the storage change event is a no-op for identical settings.
  autoCollapsed.clear();
  renderBarState();
  applyFilters();
  saveSettings();
}

function ensureBar() {
  let bar = document.getElementById(BAR_ID);
  if (!bar) bar = buildBar();

  const host = findHost();
  bar.classList.toggle("gco-bar--floating", !host);
  const parent = host || document.body;
  if (bar.parentElement !== parent) parent.appendChild(bar);

  renderBarState();
  return bar;
}

function setPressed(el, on) {
  el.classList.toggle("is-on", on);
  const value = String(on);
  if (el.getAttribute("aria-pressed") !== value) el.setAttribute("aria-pressed", value);
}

function renderBarState() {
  const bar = document.getElementById(BAR_ID);
  if (!bar) return;
  for (const filter of FILTERS) {
    const chip = bar.querySelector(`[data-filter="${filter.id}"]`);
    if (chip) setPressed(chip, Boolean(settings[filter.id]));
  }
  const all = bar.querySelector('[data-action="all"]');
  if (all) setPressed(all, allOptionalOn());

  const collapse = bar.querySelector('[data-action="collapse-toggle"]');
  if (collapse) {
    const on = settings.autoCollapse !== false;
    setPressed(collapse, on);
    const text = on ? "Expand skipped" : "Collapse skipped";
    const title = on
      ? "Skipped diffs are auto-collapsed. Click to expand them."
      : "Collapse skipped diffs and keep collapsing them as files load";
    if (collapse.textContent !== text) collapse.textContent = text;
    if (collapse.title !== title) collapse.title = title;
  }
}

function updateBar(dimmed, focused) {
  const count = document.querySelector(`#${BAR_ID} [data-role='count']`);
  if (!count) return;
  const text =
    dimmed === 0 ? `${focused} file${focused === 1 ? "" : "s"} in focus` : `${dimmed} dimmed · ${focused} in focus`;
  if (count.textContent !== text) count.textContent = text;
}

function isRelevantMutation(mutations) {
  for (const mutation of mutations) {
    const target = mutation.target;
    if (target.nodeType === 1 && isOurs(target)) continue;
    for (const node of mutation.addedNodes) {
      if (node.nodeType !== 1) continue;
      if (node.matches(RELEVANT_SELECTOR) || node.querySelector(RELEVANT_SELECTOR)) return true;
    }
  }
  return false;
}

function resetPage() {
  lastUrl = location.href;
  document.getElementById(BAR_ID)?.remove();
  clearMarks();
  autoCollapsed.clear();
  pendingApply = false;
}

function onMutations(mutations) {
  if (location.href !== lastUrl) {
    resetPage();
    scheduleApply();
    return;
  }
  if (!onReviewPage()) return;
  if (!isRelevantMutation(mutations)) return;
  if (syncingCollapse) {
    pendingApply = true;
    return;
  }
  scheduleApply();
}

function observe() {
  if (!observer) observer = new MutationObserver(onMutations);
  observer.observe(document.documentElement, { childList: true, subtree: true });
}

function onNavigate() {
  if (location.href !== lastUrl) resetPage();
  else document.getElementById(BAR_ID)?.remove();
  scheduleApply();
}

function bindNavigation() {
  document.addEventListener("turbo:load", onNavigate);
  document.addEventListener("turbo:render", onNavigate);
  document.addEventListener("pjax:end", onNavigate);
  document.addEventListener("soft-nav:end", onNavigate);
  window.addEventListener("popstate", onNavigate);
}

storage.onChanged.addListener((changes, area) => {
  if (area !== "sync" || !changes[STORAGE_KEY]) return;
  const next = mergeSettings(changes[STORAGE_KEY].newValue);
  if (JSON.stringify(next) === JSON.stringify(settings)) return;
  settings = next;
  autoCollapsed.clear();
  renderBarState();
  scheduleApply();
});

loadSettings().then(() => {
  bindNavigation();
  observe();
  applyFilters();
});
})();
