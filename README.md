# sf-regress

Regression testing for Salesforce orgs, as a Salesforce CLI plugin. Tests are YAML files in your repo; `sf regress run` replays them against an org and deletes every record it created.

## Run

```bash
sf regress run --target-org my-sandbox                    # every test under ./tests
sf regress run --suite smoke --target-org my-sandbox      # tests tagged "smoke"
sf regress run --test tests/large-opp.yaml -o my-sandbox  # one file (repeatable)
sf regress run -o my-sandbox --json                       # machine-readable, exit code 1 on failure
```

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

### Values

- `$name.path` reads a variable: `$acme.Id`, `$result.records.0.Account.Name`. Use `.0` for list indexes (`[0]` breaks inside `{ ... }` unless quoted). `$$` is a literal `$`.
- `today`, `+30d`, `-7d`, `+2w`, `+1m`, `+1y` become dates (`YYYY-MM-DD`).
- Records are deleted newest-first when the test ends, pass or fail.

## Develop

```bash
yarn install
yarn build
yarn test                                         # unit tests + lint
./bin/dev.js regress run -o <alias> -d examples/tests
```

The engine (`src/engine/`) has no CLI dependencies; `src/commands/` holds thin oclif commands.
