# sf-regress

Regression testing for Salesforce orgs, as a Salesforce CLI plugin. Tests are YAML files in your repo; `sf regress run` replays them against an org and deletes every record it created.

## Record

```bash
sf regress record "New account with a contact" --target-org my-sandbox
```

A browser opens, logged in to the org with Playwright's recorder toolbar. Click through the test, use the toolbar's assert tools to add checks, then close the browser. sf-regress turns the recording into readable YAML in `tests/`:

- Lightning selectors become field labels and button names (`{ field: Industry }`, `{ button: Save, in: New Contact }`); generated ids like `[id="1194:0"]` are repaired
- picklist and lookup choices become `browser.select` steps
- typed names become `params` with a `$run.id` suffix, so reruns don't collide
- records you created become variables that are deleted after every run

Records created while recording are deleted afterwards (`--keep-records` to keep them), and the new test is replayed once to check it works (`--no-verify` to skip).

## Write tests with AI

Describe a test in plain English, or drop test documents into `tests/drafts/`:

```sh
sf regress create "Creating an opportunity over 50k in Prospecting sets the forecast category to Pipeline" -o my-sandbox
sf regress convert -o my-sandbox                                   # every .docx, .md and .txt in tests/drafts/
sf regress convert --file tests/drafts/opportunity-tests.docx -o my-sandbox
```

Claude writes the YAML using the org's metadata (fields, picklist values, record types, buttons, approval processes), runs it once against the org to check it works, and fixes failed steps. If something is ambiguous it asks you instead of guessing. A document can hold many tests; each is saved to `tests/`, and the document moves to `tests/drafts/converted/` once all its tests are saved. Each saved test starts with a comment holding the original description and anything a reviewer should check.

This uses your own Anthropic API key. Put it in a `.env` file in your project (make sure `.env` is in `.gitignore`):

```
ANTHROPIC_API_KEY=sk-ant-...
```

or set `ANTHROPIC_API_KEY` in the environment, or pass `--api-key`. The key is never stored or logged. Only metadata (names and settings, never record data) and your descriptions are sent to Anthropic. `sf regress run` never uses AI.

## Run

```bash
sf regress run --target-org my-sandbox                    # every test under ./tests
sf regress run --suite smoke --target-org my-sandbox      # tests tagged "smoke"
sf regress run --test tests/large-opp.yaml -o my-sandbox  # one file (repeatable)
sf regress run -o my-sandbox --json                       # machine-readable, exit code 1 on failure
sf regress run -o my-sandbox --junit regress-results/junit.xml   # JUnit report for CI
sf regress run -o my-sandbox --headed                     # watch the browser steps
```

Browser steps log in with the CLI's existing session (`/secur/frontdoor.jsp`); no passwords are stored. When a step fails with a browser open, a screenshot is saved to `regress-results/`.

Production orgs are refused unless you pass `--allow-production` or the test sets `allowProduction: true`.

## Test format

```yaml
name: Large opportunity starts in Prospecting
tags: [opportunity, smoke]
params:
  accountName: 'Regress Acme $run.id' # $run.id is unique per run
steps:
  - name: Create the account # optional step name
    api.create:
      sobject: Account
      as: acme
      fields: { Name: $accountName }
  - api.create:
      sobject: Opportunity
      as: opp
      fields: { Name: 'Big Opp', AccountId: $acme.Id, Amount: 60000, StageName: Prospecting, CloseDate: +30d }
  - api.query:
      soql: "SELECT StageName FROM Opportunity WHERE Id = '$opp.Id'"
      as: result
  - assert.equals: { actual: $result.records.0.StageName, expected: Prospecting }
```

### Steps

| Step               | Arguments                        | Notes                                                                    |
| ------------------ | -------------------------------- | ------------------------------------------------------------------------ |
| `api.create`       | `sobject`, `fields`, `as`        | Result is the fields plus `Id`. Deleted after the test.                  |
| `api.update`       | `sobject`, `id`, `fields`        |                                                                          |
| `api.delete`       | `sobject`, `id`                  |                                                                          |
| `api.query`        | `soql`, `as`                     | Result is `{ totalSize, records }`. Shorthand: `api.query: "SELECT ..."` |
| `api.track`        | `soql`, `sobject?`, `as`         | Registers matching records for cleanup. Query must select `Id`.          |
| `assert.equals`    | `actual`, `expected`, `message?` | `60000` and `"60000"` count as equal.                                    |
| `assert.notEquals` | `actual`, `expected`, `message?` |                                                                          |
| `assert.contains`  | `actual`, `expected`, `message?` | Substring of a string, or item in a list.                                |
| `assert.exists`    | `actual`, `message?`             | Not null/empty. Shorthand: `assert.exists: $x.Id`                        |

### Browser steps

Elements are named the way a person would describe them. A target is one of `button`, `link`, `tab`, `field`, `text`, `option`, `menuitem`, `checkbox`, `heading` or `selector` (raw Playwright selector, last resort), plus optional `in: <dialog or console tab title>`, `exact: false` (substring match) and `timeout` (ms).

| Step                    | Example                                            | Notes                                                                                          |
| ----------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `browser.goto`          | `browser.goto: /lightning/r/Account/$acct.Id/view` | Paths are relative to the org.                                                                 |
| `browser.click`         | `{ button: Save, in: New Contact }`                |                                                                                                |
| `browser.fill`          | `{ field: Account Name, value: $accountName }`     | `field` is the label (or API name); a required `*` is ignored.                                 |
| `browser.select`        | `{ field: Industry, value: Banking }`              | Picklists, lookups (types, then picks the record) and native selects.                          |
| `browser.press`         | `browser.press: Enter`                             |                                                                                                |
| `browser.expectVisible` | `{ text: "was created" }`                          |                                                                                                |
| `browser.expectHidden`  | `{ button: Delete }`                               | Waits for it to disappear.                                                                     |
| `browser.expectValue`   | `{ field: Stage, value: Prospecting }`             | Inputs, picklists, and read-only fields on record pages.                                       |
| `browser.expectText`    | `{ field: Amount, contains: "60,000" }`            | Case-insensitive substring.                                                                    |
| `browser.captureRecord` | `browser.captureRecord: acct`                      | Reads the record from the URL into `$acct`; deletes it after the test if this test created it. |

Lightning keeps hidden copies of earlier pages in the DOM, so targets always resolve to visible elements. Fields on a record page may be on a tab that isn't open (e.g. Details); the error message lists the unselected tabs.

### Values

- `$name.path` reads a variable: `$acme.Id`, `$result.records.0.Account.Name`. Use `.0` for list indexes (`[0]` breaks inside `{ ... }` unless quoted). `$$` is a literal `$`.
- `today`, `+30d`, `-7d`, `+2w`, `+1m`, `+1y` become dates (`YYYY-MM-DD`).
- Built-ins: `$run.id` (unique per run), `$run.date`, `$run.startedAt` (SOQL datetime), `$run.userId`.
- Records are deleted newest-first when the test ends, pass or fail.

## Develop

```bash
yarn install
yarn build
yarn test                                         # unit tests + lint
./bin/dev.js regress run -o <alias> -d examples/tests
```

The engine (`src/engine/`) has no CLI dependencies; `src/commands/` holds thin oclif commands.
