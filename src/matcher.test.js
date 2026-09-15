const test = require("node:test");
const assert = require("node:assert/strict");
const { classify, shouldHide, isReviewPage, fileNameTokens, textMatchesExclusivePath } = require("./matcher.js");

function reasons(path) {
  const flags = classify(path);
  return Object.entries(flags)
    .filter(([, value]) => value)
    .map(([key]) => key)
    .sort();
}

test("keeps application code visible", () => {
  assert.deepEqual(reasons("src/users/user.service.ts"), []);
  assert.deepEqual(reasons("app/controllers/billing_controller.rb"), []);
  assert.equal(shouldHide("src/app.ts", { tests: true, adrs: true, specs: true, ai: true }), null);
});

test("detects test files", () => {
  assert.ok(reasons("src/users/user.service.test.ts").includes("tests"));
  assert.ok(reasons("src/users/user.spec.tsx").includes("tests"));
  assert.ok(reasons("internal/api/handler_test.go").includes("tests"));
  assert.ok(reasons("tests/unit/user_test.py").includes("tests"));
  assert.ok(reasons("test_parser.py").includes("tests"));
  assert.ok(reasons("__tests__/button.tsx").includes("tests"));
  assert.ok(reasons("cypress/e2e/login.cy.ts").includes("tests"));
  assert.ok(reasons("e2e/checkout.spec.ts").includes("tests"));
  assert.ok(reasons("spec/models/user_spec.rb").includes("tests"));
  assert.ok(reasons("src/__snapshots__/Page.test.tsx.snap").includes("tests"));
});

test("does not treat contest or latest as tests", () => {
  assert.equal(reasons("contest/solution.ts").includes("tests"), false);
  assert.equal(reasons("latest/index.js").includes("tests"), false);
});

test("does not flag names that merely contain test or spec", () => {
  assert.equal(reasons("src/latest_version.py").includes("tests"), false);
  assert.equal(reasons("src/contest_results.ts").includes("tests"), false);
  assert.equal(reasons("pkg/attest.go").includes("tests"), false);
  assert.equal(reasons("src/inspect_state.rb").includes("tests"), false);
});

test("Java and Kotlin suffixes are case-sensitive", () => {
  assert.ok(reasons("src/main/java/UserServiceIT.java").includes("tests"));
  assert.ok(reasons("src/test/java/UserTest.java").includes("tests"));
  assert.ok(reasons("src/UserSpec.kt").includes("tests"));
  assert.equal(reasons("src/main/java/Commit.java").includes("tests"), false);
  assert.equal(reasons("src/main/java/Audit.java").includes("tests"), false);
  assert.equal(reasons("src/Edit.kt").includes("tests"), false);
});

test("detects bounded test tokens and framework suffixes", () => {
  assert.ok(reasons("src/checkout.e2e.ts").includes("tests"));
  assert.ok(reasons("src/Button.cy.tsx").includes("tests"));
  assert.ok(reasons("src/app.e2e-spec.ts").includes("tests"));
  assert.ok(reasons("src/test-utils.ts").includes("tests"));
  assert.ok(reasons("src/user.test.helper.ts").includes("tests"));
  assert.ok(reasons("lib/spec_helper.rb").includes("tests"));
});

test("spec documents named *.spec.md are specs, not tests", () => {
  assert.deepEqual(reasons("docs/api.spec.md"), ["specs"]);
  assert.deepEqual(reasons("docs/api.spec.yaml"), ["specs"]);
});

test("detects ADRs", () => {
  assert.ok(reasons("docs/adr/0001-use-postgres.md").includes("adrs"));
  assert.ok(reasons("adr/0002-auth.md").includes("adrs"));
  assert.ok(reasons("docs/decisions/0003-cache.md").includes("adrs"));
  assert.ok(reasons("docs/adr-0004-queues.md").includes("adrs"));
});

test("detects documentation SPECs without hiding test .spec.ts", () => {
  assert.ok(reasons("docs/specs/auth.md").includes("specs"));
  assert.ok(reasons("SPEC.md").includes("specs"));
  assert.ok(reasons("specs/checkout-flow.md").includes("specs"));
  assert.ok(reasons(".specify/specs/login.md").includes("specs"));
  assert.equal(reasons("src/user.spec.ts").includes("specs"), false);
  assert.ok(reasons("src/user.spec.ts").includes("tests"));
});

test("detects AI-generated and agent files", () => {
  assert.ok(reasons(".cursor/rules/frontend.mdc").includes("ai"));
  assert.ok(reasons("AGENTS.md").includes("ai"));
  assert.ok(reasons("CLAUDE.md").includes("ai"));
  assert.ok(reasons(".github/copilot-instructions.md").includes("ai"));
  assert.ok(reasons("src/api.generated.ts").includes("ai"));
  assert.ok(reasons("pkg/proto/user.pb.go").includes("ai"));
  assert.ok(reasons("__generated__/graphql.ts").includes("ai"));
  assert.equal(reasons(".github/workflows/ci.yml").includes("ai"), false);
  assert.ok(reasons(".github/instructions/react.instructions.md").includes("ai"));
  assert.ok(reasons(".github/prompts/refactor.prompt.md").includes("ai"));
  assert.equal(reasons(".github/CODEOWNERS").includes("ai"), false);
  assert.equal(reasons(".github/ISSUE_TEMPLATE/bug.md").includes("ai"), false);
});

test("hides only categories that are enabled", () => {
  const path = "src/user.service.test.ts";
  assert.equal(shouldHide(path, { tests: true }), "tests");
  assert.equal(shouldHide(path, { tests: false, adrs: true, specs: true, ai: true }), null);
});

test("supports custom globs and regex", () => {
  const settings = { custom: ["vendor/**", "/(^|\\/)yarn\\.lock$/"] };
  assert.equal(shouldHide("vendor/lodash/index.js", settings), "custom");
  assert.equal(shouldHide("yarn.lock", settings), "custom");
  assert.equal(shouldHide("src/app.ts", settings), null);
});

test("cached custom regex stays stable across calls, even with a g flag", () => {
  const settings = { custom: ["/yarn\\.lock$/g"] };
  assert.equal(shouldHide("a/yarn.lock", settings), "custom");
  assert.equal(shouldHide("b/yarn.lock", settings), "custom");
  assert.equal(shouldHide("c/yarn.lock", settings), "custom");
  assert.equal(shouldHide("src/app.ts", { custom: ["/(unclosed/"] }), null);
});

test("exclusive filename text does not leak to a sibling source file", () => {
  assert.deepEqual(fileNameTokens("week-calendar.test.ts"), ["week-calendar.test.ts"]);
  assert.deepEqual(fileNameTokens("week-calendar.test.ts\nweek-calendar.ts").sort(), [
    "week-calendar.test.ts",
    "week-calendar.ts",
  ]);
  assert.equal(
    textMatchesExclusivePath("week-calendar.test.ts", "packages/domain/src/agenda/week-calendar.test.ts"),
    true
  );
  assert.equal(
    textMatchesExclusivePath(
      "week-calendar.test.ts week-calendar.ts",
      "packages/domain/src/agenda/week-calendar.test.ts"
    ),
    false
  );
  assert.equal(
    textMatchesExclusivePath("week-calendar.ts", "packages/domain/src/agenda/week-calendar.test.ts"),
    false
  );
});

test("detects GitHub review URLs including the new /changes page", () => {
  assert.equal(isReviewPage("/somnum-bene/dreamscript-shopify-app/pull/389/changes"), true);
  assert.equal(isReviewPage("/owner/repo/pull/389/changes/abc1234..def5678"), true);
  assert.equal(isReviewPage("/owner/repo/pull/389/files"), true);
  assert.equal(isReviewPage("/owner/repo/pull/389"), false);
});
