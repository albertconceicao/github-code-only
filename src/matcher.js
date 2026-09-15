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
  ".github",
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

function hasDir(parts, names) {
  return parts.some((part) => names.has(part));
}

function isCodeExt(ext) {
  return CODE_EXTS.has(ext);
}

function isTestFilename(name) {
  const lower = name.toLowerCase();
  if (/\.(test|spec|tests)\.[^.]+$/i.test(lower)) return true;
  if (/\.(test|spec)\./i.test(lower) && isCodeExt(extname(lower))) return true;
  if (/(_test|_spec|test_|spec_)/i.test(lower) && isCodeExt(extname(lower))) return true;
  if (/^test_.+\.py$/.test(lower) || /_test\.py$/.test(lower)) return true;
  if (/_test\.go$/.test(lower)) return true;
  if (/.+(test|tests|it|spec)\.(java|kt|kts)$/.test(lower)) return true;
  if (/\.(snap|feature)$/.test(lower)) return true;
  return false;
}

function isAdrFilename(name) {
  const lower = name.toLowerCase();
  if (/^adr[-_.]/.test(lower)) return true;
  if (/[-_.]adr[-_.]/.test(lower)) return true;
  if (/^adr\.(md|mdx|txt)$/.test(lower)) return true;
  return false;
}

function isSpecFilename(name) {
  const lower = name.toLowerCase();
  if (/^(spec|specs|specification|prd)\.(md|mdx|txt|adoc|yml|yaml|json)$/.test(lower)) {
    return true;
  }
  if (/\.spec\.(md|mdx|adoc|yml|yaml)$/.test(lower)) return true;
  if (/\.(specification|openapi)\.(ya?ml|json|md)$/.test(lower)) return true;
  return false;
}

function isAiFilename(name, parts) {
  const lower = name.toLowerCase();
  if (AI_ROOT_FILES.has(lower)) return true;
  if (lower.endsWith(".mdc")) return true;
  if (/\.generated\./i.test(lower) || /\.gen\.(ts|tsx|js|go|java)$/i.test(lower)) return true;
  if (/\.pb\.(go|ts|js)$/.test(lower) || /_pb2\.py$/.test(lower)) return true;
  if (lower === "skill.md" && parts.some((part) => part === "skills" || part === ".cursor" || part === ".agents")) {
    return true;
  }
  if (parts.includes(".github") && (lower === "copilot-instructions.md" || parts.includes("instructions") || parts.includes("copilot"))) {
    return true;
  }
  return false;
}

function isTestPath(filePath) {
  const path = normalizePath(filePath);
  const name = basename(path);
  const parts = segments(path);
  const ext = extname(path);

  if (isTestFilename(name)) return true;
  if (hasDir(parts, TEST_DIRS)) return true;

  if (hasDir(parts, TEST_SPEC_DIRS) && (isCodeExt(ext) || ext === "feature" || ext === "snap")) {
    return true;
  }

  return false;
}

function isAdrPath(filePath) {
  const path = normalizePath(filePath);
  const name = basename(path);
  const parts = segments(path);

  if (isAdrFilename(name)) return true;
  if (hasDir(parts, ADR_DIRS)) return true;
  if (parts.includes("decisions") && DOC_EXTS.has(extname(path))) return true;
  return false;
}

function isSpecPath(filePath) {
  const path = normalizePath(filePath);
  const name = basename(path);
  const parts = segments(path);
  const ext = extname(path);

  if (isTestPath(path) && isCodeExt(ext)) return false;
  if (isSpecFilename(name)) return true;

  if (hasDir(parts, SPEC_DIRS) && SPEC_DOC_EXTS.has(ext)) return true;
  if (parts.includes(".kiro") && parts.includes("specs")) return true;
  if (parts.includes("docs") && (parts.includes("spec") || parts.includes("specs") || parts.includes("prd"))) {
    return true;
  }

  return false;
}

function isAiPath(filePath) {
  const path = normalizePath(filePath);
  const name = basename(path);
  const parts = segments(path);

  if (isAiFilename(name, parts)) return true;
  if (parts.some((part) => AI_DIRS.has(part))) {
    if (parts.includes(".github")) {
      return (
        parts.includes("instructions") ||
        parts.includes("copilot") ||
        name.toLowerCase() === "copilot-instructions.md" ||
        name.toLowerCase() === "agents.md"
      );
    }
    return true;
  }
  if (parts.includes("plans") && (parts.includes(".cursor") || parts.includes("docs") || parts.includes(".agents"))) {
    return true;
  }
  return false;
}

function classify(filePath) {
  return {
    tests: isTestPath(filePath),
    adrs: isAdrPath(filePath),
    specs: isSpecPath(filePath),
    ai: isAiPath(filePath),
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

function matchesCustom(filePath, patterns) {
  const path = normalizePath(filePath);
  if (!patterns || patterns.length === 0) return false;

  return patterns.some((raw) => {
    const pattern = String(raw || "").trim();
    if (!pattern) return false;
    if (pattern.startsWith("/") && pattern.lastIndexOf("/") > 0) {
      const last = pattern.lastIndexOf("/");
      const body = pattern.slice(1, last);
      const flags = pattern.slice(last + 1) || "i";
      try {
        return new RegExp(body, flags).test(path);
      } catch {
        return false;
      }
    }
    try {
      return globToRegExp(pattern).test(path);
    } catch {
      return path.toLowerCase().includes(pattern.toLowerCase());
    }
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

function shouldHide(filePath, settings) {
  const flags = classify(filePath);
  if (settings?.tests && flags.tests) return "tests";
  if (settings?.adrs && flags.adrs) return "adrs";
  if (settings?.specs && flags.specs) return "specs";
  if (settings?.ai && flags.ai) return "ai";
  if (matchesCustom(filePath, settings?.custom)) return "custom";
  return null;
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
