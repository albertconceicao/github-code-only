(function (root) {
const CODE_EXTS = new Set([
  "js",
  "jsx",
  "ts",
  "tsx",
  "mjs",
  "cjs",
  "mts",
  "cts",
  "vue",
  "svelte",
  "coffee",
  "rb",
  "py",
  "go",
  "java",
  "kt",
  "kts",
  "php",
  "swift",
  "cs",
  "rs",
  "cpp",
  "cc",
  "c",
  "h",
  "hpp",
  "scala",
  "dart",
  "groovy",
  "m",
  "mm",
]);

const DOC_EXTS = new Set(["md", "mdx", "markdown", "txt", "adoc", "rst", "org"]);
const SPEC_DOC_EXTS = new Set([...DOC_EXTS, "yml", "yaml", "json", "openapi", "proto"]);

const TEST_DIRS = new Set([
  "__tests__",
  "__mocks__",
  "__snapshots__",
  "__fixtures__",
  "testdata",
  "test-data",
  "tests",
  "test",
  "testing",
  "e2e",
  "cypress",
  "playwright",
  "jest",
  "vitest",
  "fixtures",
  "snapshots",
  "integration-tests",
  "unit-tests",
]);

const TEST_SPEC_DIRS = new Set(["spec", "specs"]);

const ADR_DIRS = new Set([
  "adr",
  "adrs",
  "architecture-decision-records",
  "architecture-decisions",
  "architecture_decisions",
]);

const SPEC_DIRS = new Set([
  "spec",
  "specs",
  "specification",
  "specifications",
  "openspec",
  ".specify",
  "prd",
  "prds",
]);

// `.github` is handled separately: only its Copilot sub-folders count as AI files.
const AI_DIRS = new Set([
  ".cursor",
  ".windsurf",
  ".aider",
  ".continue",
  ".claude",
  ".codex",
  ".agents",
  ".agent",
  ".ai",
  ".specify",
  ".kiro",
  "prompts",
  "__generated__",
  "generated",
  "codegen",
]);

const AI_ROOT_FILES = new Set([
  "agents.md",
  "claude.md",
  "gemini.md",
  "copilot.md",
  ".cursorrules",
  ".cursorignore",
  "copilot-instructions.md",
  "walkthrough.md",
]);

// A test token must be bounded by the start/end of the stem or by `.`, `_`, `-`, so that
// `user_test.go`, `test_parser.py`, `spec_helper.rb`, `app.e2e-spec.ts` and `Button.cy.tsx` match
// while `latest_version.py`, `contest_results.ts` and `attest.go` do not.
const TEST_TOKEN = /(^|[._-])(test|tests|spec|e2e|cy)([._-]|$)/;

// Java/Kotlin suffix conventions are case-sensitive so `Commit.java` and `Audit.kt` are not `IT` tests.
const JVM_TEST_SUFFIX = /(Test|Tests|IT|Spec)\.(java|kt|kts)$/;

function normalizePath(filePath) {
  return String(filePath || "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/^\/+/, "");
}

function basename(filePath) {
  const parts = normalizePath(filePath).split("/");
  return parts[parts.length - 1] || "";
}

function fileNameTokens(text) {
  return [
    ...new Set(
      String(text || "")
        .match(/[A-Za-z0-9._-]+\.[A-Za-z0-9]{1,8}/g)
        ?.map((name) => name.toLowerCase()) || []
    ),
  ];
}

function textMatchesExclusivePath(text, filePath) {
  const base = basename(filePath).toLowerCase();
  if (!base) return false;
  const tokens = fileNameTokens(text);
  return tokens.length === 1 && tokens[0] === base;
}

function extname(filePath) {
  const name = basename(filePath);
  const idx = name.lastIndexOf(".");
  if (idx <= 0) return "";
  return name.slice(idx + 1).toLowerCase();
}

function segments(filePath) {
  return normalizePath(filePath)
    .split("/")
    .filter(Boolean)
    .map((part) => part.toLowerCase());
}

// Parsed once per path; every classifier reads from this instead of re-splitting the string.
function parse(filePath) {
  const path = normalizePath(filePath);
  const name = basename(path);
  return { path, name, lower: name.toLowerCase(), parts: segments(path), ext: extname(name) };
}

function hasDir(parts, names) {
  return parts.some((part) => names.has(part));
}

function isTestFilename(name) {
  const lower = name.toLowerCase();
  const ext = extname(lower);
  if (/\.(test|tests)\.[^.]+$/.test(lower)) return true;
  // `api.spec.md` / `api.spec.yaml` are spec documents, not tests.
  if (/\.spec\.[^.]+$/.test(lower) && !SPEC_DOC_EXTS.has(ext)) return true;
  if (/\.(snap|feature)$/.test(lower)) return true;
  if (JVM_TEST_SUFFIX.test(name)) return true;
  if (!CODE_EXTS.has(ext)) return false;
  const stem = ext ? lower.slice(0, -(ext.length + 1)) : lower;
  return TEST_TOKEN.test(stem);
}

function isAdrFilename(lower) {
  if (/^adr[-_.]/.test(lower)) return true;
  if (/[-_.]adr[-_.]/.test(lower)) return true;
  if (/^adr\.(md|mdx|txt)$/.test(lower)) return true;
  return false;
}

function isSpecFilename(lower) {
  if (/^(spec|specs|specification|prd)\.(md|mdx|txt|adoc|yml|yaml|json)$/.test(lower)) {
    return true;
  }
  if (/\.spec\.(md|mdx|adoc|yml|yaml)$/.test(lower)) return true;
  if (/\.(specification|openapi)\.(ya?ml|json|md)$/.test(lower)) return true;
  return false;
}

function isAiFilename(lower, parts) {
  if (AI_ROOT_FILES.has(lower)) return true;
  if (lower.endsWith(".mdc")) return true;
  if (/\.generated\./.test(lower) || /\.gen\.(ts|tsx|js|go|java)$/.test(lower)) return true;
  if (/\.pb\.(go|ts|js)$/.test(lower) || /_pb2\.py$/.test(lower)) return true;
  if (lower === "skill.md" && parts.some((part) => part === "skills" || part === ".cursor" || part === ".agents")) {
    return true;
  }
  return false;
}

// Inside `.github/` only Copilot's own folders are AI files; workflows, templates and CODEOWNERS are not.
function isGithubAiPath(lower, parts) {
  return (
    parts.includes("instructions") ||
    parts.includes("copilot") ||
    parts.includes("prompts") ||
    parts.includes("agents") ||
    lower === "copilot-instructions.md" ||
    lower === "agents.md"
  );
}

function testPath({ name, parts, ext }) {
  if (isTestFilename(name)) return true;
  if (hasDir(parts, TEST_DIRS)) return true;
  return hasDir(parts, TEST_SPEC_DIRS) && (CODE_EXTS.has(ext) || ext === "feature" || ext === "snap");
}

function adrPath({ lower, parts, ext }) {
  if (isAdrFilename(lower)) return true;
  if (hasDir(parts, ADR_DIRS)) return true;
  return parts.includes("decisions") && DOC_EXTS.has(ext);
}

function specPath({ lower, parts, ext }, isTest) {
  if (isTest && CODE_EXTS.has(ext)) return false;
  if (isSpecFilename(lower)) return true;
  if (hasDir(parts, SPEC_DIRS) && SPEC_DOC_EXTS.has(ext)) return true;
  if (parts.includes(".kiro") && parts.includes("specs")) return true;
  return parts.includes("docs") && (parts.includes("spec") || parts.includes("specs") || parts.includes("prd"));
}

function aiPath({ lower, parts }) {
  if (isAiFilename(lower, parts)) return true;
  if (parts.includes(".github")) return isGithubAiPath(lower, parts);
  if (hasDir(parts, AI_DIRS)) return true;
  return parts.includes("plans") && (parts.includes(".cursor") || parts.includes("docs") || parts.includes(".agents"));
}

function isTestPath(filePath) {
  return testPath(parse(filePath));
}

function isAdrPath(filePath) {
  return adrPath(parse(filePath));
}

function isSpecPath(filePath) {
  const info = parse(filePath);
  return specPath(info, testPath(info));
}

function isAiPath(filePath) {
  return aiPath(parse(filePath));
}

function classify(filePath) {
  const info = parse(filePath);
  const tests = testPath(info);
  return {
    tests,
    adrs: adrPath(info),
    specs: specPath(info, tests),
    ai: aiPath(info),
  };
}

function globToRegExp(pattern) {
  const normalized = normalizePath(pattern).replace(/\/+$/, "");
  let regex = "^";
  for (let i = 0; i < normalized.length; i += 1) {
    const char = normalized[i];
    if (char === "*") {
      const next = normalized[i + 1];
      if (next === "*") {
        const after = normalized[i + 2];
        if (after === "/") {
          regex += "(?:.*/)?";
          i += 2;
        } else {
          regex += ".*";
          i += 1;
        }
      } else {
        regex += "[^/]*";
      }
    } else if (char === "?") {
      regex += "[^/]";
    } else if ("\\^$+()[]{}|.".includes(char)) {
      regex += `\\${char}`;
    } else {
      regex += char;
    }
  }
  regex += "$";
  return new RegExp(regex, "i");
}

// Compiled patterns are reused across every file on the page. The cache is keyed by the raw pattern
// text and bounded because patterns are user input.
const CUSTOM_CACHE_LIMIT = 256;
const customPatternCache = new Map();

function buildCustomMatcher(pattern) {
  const last = pattern.lastIndexOf("/");
  if (pattern.startsWith("/") && last > 0) {
    // `g` and `y` make RegExp.test stateful, which would break a cached instance.
    const flags = (pattern.slice(last + 1) || "i").replace(/[gy]/g, "");
    try {
      return new RegExp(pattern.slice(1, last), flags);
    } catch {
      return null;
    }
  }
  try {
    return globToRegExp(pattern);
  } catch {
    const needle = pattern.toLowerCase();
    return { test: (path) => path.toLowerCase().includes(needle) };
  }
}

function compileCustom(raw) {
  const pattern = String(raw || "").trim();
  if (!pattern) return null;
  let matcher = customPatternCache.get(pattern);
  if (matcher !== undefined) return matcher;
  matcher = buildCustomMatcher(pattern);
  if (customPatternCache.size >= CUSTOM_CACHE_LIMIT) customPatternCache.clear();
  customPatternCache.set(pattern, matcher);
  return matcher;
}

function matchesCustom(filePath, patterns) {
  if (!Array.isArray(patterns) || patterns.length === 0) return false;
  const path = normalizePath(filePath);
  return patterns.some((raw) => {
    const matcher = compileCustom(raw);
    return matcher ? matcher.test(path) : false;
  });
}

function isReviewPage(pathname = "") {
  const path = String(pathname || "");
  return (
    /\/pull\/\d+\/files(?:\/|$)/.test(path) ||
    /\/pull\/\d+\/changes(?:\/|$)/.test(path) ||
    /\/pull\/\d+\/commits\/[0-9a-f]{7,40}/i.test(path) ||
    /\/commit\/[0-9a-f]{7,40}/i.test(path) ||
    /\/compare\//.test(path)
  );
}

// Only the classifiers whose filter is enabled run, in priority order.
function shouldHide(filePath, settings) {
  const options = settings || {};
  const info = parse(filePath);
  if (options.tests || options.adrs || options.specs || options.ai) {
    const tests = testPath(info);
    if (options.tests && tests) return "tests";
    if (options.adrs && adrPath(info)) return "adrs";
    if (options.specs && specPath(info, tests)) return "specs";
    if (options.ai && aiPath(info)) return "ai";
  }
  return matchesCustom(info.path, options.custom) ? "custom" : null;
}

const GitHubCodeOnly = {
  classify,
  shouldHide,
  matchesCustom,
  normalizePath,
  basename,
  fileNameTokens,
  textMatchesExclusivePath,
  isReviewPage,
  isTestPath,
  isAdrPath,
  isSpecPath,
  isAiPath,
};

root.GitHubCodeOnly = GitHubCodeOnly;
if (typeof module === "object" && module.exports) {
  module.exports = GitHubCodeOnly;
}
})(typeof globalThis !== "undefined" ? globalThis : this);
