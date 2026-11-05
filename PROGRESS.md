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

## M3 - next

Needs the user's own Anthropic API key.

- [ ] Decide how the key is provided (env var, `sf config`, ...) - never stored by us
- [ ] `sf regress create "<plain English>"`
- [ ] `sf regress convert` for `tests/drafts/` (.docx via `mammoth`, .md, .txt; one or many tests per file)
- [ ] Org metadata context for the AI (objects, fields, record types, buttons, approval processes)
- [ ] Verification run against the org; fill in selectors and details
- [ ] Ambiguities asked as questions, never guessed
- [ ] Save to `tests/`, move sources to `tests/drafts/converted/`
