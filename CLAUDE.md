# sf-regress

Regression testing for Salesforce orgs, shipped as a Salesforce CLI (`sf`) plugin.
Standalone product - not part of ForceClaw. ForceClaw may later wrap the engine.

## What it does

- Tests are YAML files that live in the user's repo next to their metadata
- `sf regress run` replays tests deterministically - no AI at run time
- AI is only used to _author_ tests (later milestones), using the user's own Anthropic key
- Tests mix API steps (fast, used for business logic) and browser steps (Playwright, used for UI checks)

## Commands (target)

- `sf regress run [--suite <name>] [--test <file>] --target-org <alias>`
- `sf regress record <name> --target-org <alias>` - record yourself clicking through a test, save it as YAML (M2) - this is the primary way most users will create tests
- `sf regress create "<plain English test>" --target-org <alias>` (M3)
- `sf regress convert [--file <doc>] --target-org <alias>` - turn documents in `tests/drafts/` (Word, Markdown, plain text) into YAML tests (M3)
- `sf regress generate --target-org <alias>` - propose tests from org metadata (M4)
- `sf regress import <file>` - Word/Markdown/Jira/Copado to YAML (later)

## Tech

- TypeScript, oclif via the sf plugin template (`sf dev generate plugin`)
- Org auth: reuse `sf` CLI auth via `@salesforce/core` (`Org`, `Connection`). Never store credentials.
- API steps: `@salesforce/core` Connection (REST, Tooling, SOQL)
- Browser steps: Playwright (Chromium). Log in via `/secur/frontdoor.jsp?sid=<accessToken>` using the existing session.
- YAML parsing + validation: `yaml` + `zod`

## Architecture

- `src/engine/` - runner, step types, assertions, variables, cleanup. Must NOT import oclif or anything sf-CLI specific. It takes a Connection + options and returns results, so ForceClaw can reuse it later.
- `src/commands/regress/` - thin oclif commands that load YAML, call the engine, print results
- `src/browser/` - Playwright session + frontdoor login
- `test/` - unit tests for the engine (mock Connection)

## Test file format (v1)

```yaml
name: Large opp routes to Finance
tags: [opportunity, approvals]
steps:
  - api.create:
      sobject: Account
      as: acme
      fields: { Name: 'Regress Test Acme' }
  - api.create:
      sobject: Opportunity
      as: opp
      fields: { Name: 'Regress Big Opp', AccountId: $acme.Id, Amount: 60000, StageName: Prospecting, CloseDate: '+30d' }
  - api.query:
      soql: "SELECT StageName FROM Opportunity WHERE Id = '$opp.Id'"
      as: result
  - assert.equals: { actual: $result.records.0.StageName, expected: Prospecting }
  - browser.goto: /lightning/r/Opportunity/$opp.Id/view
  - browser.expectVisible: { text: 'Submit for Approval' }
```

- `as:` stores a step result in a variable; `$name.path` reads it
- Index into lists with `.0` (`$result.records.0.Name`). `[0]` also works, but only in block style or quoted - inside `{ ... }` YAML treats `[ ]` as syntax
- `params:` defines test-level variables; `$run.id` is a short unique id per run, used to keep record names unique (`Name: "Regress Acme $run.id"`)
- A step can have an optional `name:` for readability; `--suite <name>` selects tests by tag
- `api.track` registers records created outside `api.create` (e.g. via the UI) for cleanup
- Relative dates like `+30d` resolve at run time
- Every record created by `api.create` is tracked and deleted at the end of the run (reverse order), even on failure

## Safety rules

- Refuse to run against a production org unless the test or command explicitly sets `allowProduction: true` / `--allow-production`
- Always clean up created records
- Never log access tokens

## Output

- Human-readable pass/fail per test and step in the terminal
- `--json` (standard sf flag) for CI
- JUnit XML report option (M2) for CI systems
- Screenshots on browser step failure saved to `./regress-results/`

## Recording (M2) - how it works

- Do NOT build a recorder from scratch. Use Playwright's built-in recorder (codegen / `page.pause()` inspector) in a browser already logged in via frontdoor.
- User clicks through the test and adds checks with the recorder's assert tools (visible / text / value).
- On stop, post-process the raw recording into a replayable YAML test:
  - Replace brittle selectors (dynamic Lightning IDs, deep shadow DOM paths) with Salesforce-aware ones: field label, field API name, button/action label, record page tab names
  - Detect records created during the session (query records created by the running user since the recording started) and turn them into variables + automatic cleanup
  - Turn typed values into parameters (with unique suffixes) so reruns don't collide with earlier runs
  - Optional AI pass to suggest extra assertions
- Raw Playwright recordings of Lightning are brittle - this post-processing is the core value, spend the effort here.
- Later: `sf regress import <file>.spec.js` to pull in recordings from Salesforce's UI Script Recorder VS Code extension using the same post-processing.

## Creating from text or documents (M3)

- Two ways in, one pipeline: `create` takes a plain-English string, `convert` takes documents. Both produce the same YAML as `record`.
- Users drop drafts into `tests/drafts/` - `.docx`, `.md`, `.txt`. A file can hold one or many tests (split on headings or numbered test cases).
- `sf regress convert` processes every draft in the folder; `--file` does one.
- Pipeline:
  1. Parse the doc to text (use `mammoth` for .docx)
  2. AI (user's own Anthropic key) drafts YAML steps, using org metadata (objects, fields, record types, buttons, approval processes) to resolve real API names
  3. Verification run against the sandbox to confirm each step works; capture selectors and fill in details
  4. Anything ambiguous is flagged to the user as a question, never guessed (e.g. "Step 3: which approval process?")
  5. Save YAML to `tests/`, move the source doc to `tests/drafts/converted/`
- Generated YAML should be readable - users will review it in PRs.

## Milestones

- **M1:** `sf regress run` with API steps + asserts + variables + cleanup against a dev org. No browser, no AI.
- **M2:** Browser steps via Playwright + frontdoor login, `sf regress record` (see Recording above), screenshots on failure, JUnit output
- **M3:** `sf regress create` + `sf regress convert` - AI turns plain English or documents into YAML (see Creating from text or documents above)
- **M4:** `sf regress generate` - propose tests from validation rules, flows, approval processes, required fields
- **M5:** Self-healing - when a replay fails, AI proposes an updated step for the user to approve

## Working rules for Claude

- Work milestone by milestone; don't start the next one until the current one runs end to end against the dev org
- Keep the engine free of CLI dependencies
- Write unit tests for every step type
- Prefer small, readable modules over clever abstractions
