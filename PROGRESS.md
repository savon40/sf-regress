# sf-regress progress

What's done, what's left, and known gaps. Milestones are defined in [CLAUDE.md](CLAUDE.md).
Dev org: `regress-dev` (Developer Edition, "Agentforce Studio" console app).

| Milestone                                          | Status      | Commit    |
| -------------------------------------------------- | ----------- | --------- |
| M1 - `sf regress run`: API steps, asserts, cleanup | Done        | `7887e0c` |
| M2 - Browser steps, `sf regress record`, JUnit     | Done        | `b94eb46` |
| M3 - `sf regress create` / `convert` (AI)          | Not started |           |
| M4 - `sf regress generate` from org metadata       | Not started |           |
| M5 - Self-healing failed steps                     | Not started |           |

## M1 - done

- [x] YAML loader with validation and line numbers in errors
- [x] Variables: `$name.path`, `.0` indexes, `$$`, relative dates (`+30d`), params, `$run.id` / `$run.date` / `$run.startedAt` / `$run.userId`
- [x] Steps: `api.create`, `api.update`, `api.delete`, `api.query`, `api.track`
- [x] Asserts: `assert.equals`, `assert.notEquals`, `assert.contains`, `assert.exists`
- [x] Cleanup in reverse order, even on failure
- [x] Production orgs refused unless `--allow-production` / `allowProduction: true`
- [x] `--test`, `--suite` (by tag), `--tests-dir`, `--json`
- [x] Verified end to end against `regress-dev`

## M2 - done

- [x] Frontdoor login reusing the CLI session; token redacted from errors
- [x] Browser steps: `goto`, `click`, `fill`, `select` (picklists + lookups), `press`, `expectVisible`, `expectHidden`, `expectValue`, `expectText`, `captureRecord`
- [x] Lightning handling: hidden cached DOM, shadow DOM, console-app tabs, `*` required labels, fields on unselected tabs (hinted in errors)
- [x] Screenshots on failed steps (`regress-results/`), `--headed`, `--junit`
- [x] `sf regress record`: Playwright recorder + post-processing
  - [x] Brittle selectors repaired from injected click events
  - [x] Picklist/lookup clicks collapsed into `browser.select`
  - [x] Typed values become params (`$run.id` suffix for names)
  - [x] Created records detected, tracked and cleaned up
  - [x] App Launcher picks become a direct `browser.goto`
  - [x] Records from the session deleted after recording; test replayed once to verify
- [x] Verified end to end, including a hand-recorded test by the user (update Account Site)

## Known gaps and follow-ups

- [ ] Recorded dates (`12/31/2026`) stay fixed; should become relative (`+30d`)
- [ ] Recorder toolbar assertions (visible / text / value) are only covered by unit tests, not a live recording
- [ ] Recorded clicks on existing records (e.g. "United Oil & Gas Corp.") depend on that org's data; could suggest creating the record in the test instead
- [ ] Contact quick action didn't save during a scripted recording (likely a duplicate/validation rule) - not investigated
- [ ] Recorder uses Playwright's private `_showRecorder`; Playwright is pinned to 1.64.1 and upgrades need a re-check
- [ ] Optional AI pass to suggest extra assertions after recording (CLAUDE.md, Recording section)
- [ ] `sf regress import` for Playwright / UI Script Recorder files (later)
- [ ] `create`: interactive question answering only covered by unit tests - try it in a real terminal
- [ ] `create`: AI can request more objects, but objects named by a synonym ("deal") rely on the AI asking
- [ ] AI authoring can't see org automation: the dev org's "Contact Set Default LastName" flow overwrites new contacts' last names, so a related-list check failed and the AI guessed at the cause. Add active record-triggered flows/triggers per object to the org context, and send visible page text with browser failures
- [ ] `convert`: only tried live with Markdown; .docx is unit-tested with a small generated file - try a real Word test plan (tables, numbered lists)
- [ ] `convert`: documents that say "run as <user/profile>" can't be honoured - the test format has no run-as; the AI notes it for review
- [ ] Publishing: the plugin template's release/npm-publish workflows were removed (they need Salesforce's bot token). Add a release + npm publish workflow with our own npm account when ready
- [ ] Default model is `claude-opus-5-5` (~6 cents per simple test); `--model claude-sonnet-5-5` is about half the price - compare quality on a few tests

## M3 - in progress

Needs the user's own Anthropic API key.

- [x] API key: `--api-key` flag, then `ANTHROPIC_API_KEY` env var, then `.env` in the project folder (warns if `.env` isn't gitignored); never stored or logged (`src/cli/api-key.ts`)
- [x] `sf regress create "<plain English>"` - verified live: API test, browser test, and an ambiguous request that returned questions
- [x] `sf regress convert` for `tests/drafts/` (.docx via `mammoth`, .md, .txt; one or many tests per file). The AI splits each document into self-contained test descriptions, then each goes through the `create` pipeline. Verified live: a 2-test Markdown draft (one passed, one flagged for review - see follow-ups)
- [x] Org metadata context for the AI: fields (required, read-only, picklist values, lookups), record types, buttons, quick actions, approval processes; objects picked from the text by name/label (`src/engine/author/org-context.ts`). ~4.5k tokens for 4 standard objects
- [x] Verification run against the org; failed steps sent back to the AI (up to 3 fixes); `org_mismatch` when the org doesn't behave as described (never weakens assertions)
- [x] Ambiguities asked as questions, never guessed (asked in the terminal, or printed with `--no-prompt` / `--json`)
- [x] Save to `tests/`, move sources to `tests/drafts/converted/` (only when every test in the document was saved; tests that already exist are skipped, so a rerun picks up where it left off)
