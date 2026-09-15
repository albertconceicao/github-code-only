# GitHub Code Only

Browser extension for GitHub's **Files changed** tab. It dims tests and, if you turn them on, ADRs, specs, and AI-generated files — so review stays on real code.

Matched files stay in the tree and the diff, with a strikethrough and lower opacity.

## What it does

Chips appear on the PR:

| Chip | Default | Dims |
| --- | --- | --- |
| **Tests** | on | `*.test.*`, `*.spec.ts/js`, `__tests__`, `test/`, `e2e/`, Cypress, Playwright, `*_test.go` |
| **ADRs** | off | `docs/adr`, `adr/`, `docs/decisions`, `adr-*.md` |
| **Specs** | off | `SPEC.md`, `docs/specs`, `.specify`, `*.spec.md` — does **not** dim `*.spec.ts` tests |
| **AI** | off | `.cursor/`, `AGENTS.md`, Copilot instructions, `*.generated.*`, `*.pb.go` |
| **Code only** | — | turns all four on |

The counter shows how many files are dimmed vs in focus.

Extra globs or `/regex/` patterns live in the extension popup.

## Install in Chrome / Edge / Brave

1. Open `chrome://extensions`
2. Turn on **Developer mode**
3. **Load unpacked** and choose the `github-code-only` folder

## Install in Firefox

1. Open `about:debugging#/runtime/this-firefox`
2. **Load Temporary Add-on**
3. Select `manifest.json`

In Firefox the extension goes away when you close the browser unless you sign it or load it again.

## Use

1. Open a pull request
2. Go to **Files changed** (`/files` or `/changes`)
3. Keep **Tests** on (default) and optionally enable **ADRs**, **Specs**, and **AI**

On GitHub's new UI (`/changes`) the chips sit in a panel at the top right. Reload the extension in `chrome://extensions` after updating the files.

Also works on commits and compare views.

## Development

```bash
cd github-code-only
node --test src/matcher.test.js
```

No build step: Chrome loads the files directly.
