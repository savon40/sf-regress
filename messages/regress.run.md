# summary

Run regression tests against an org.

# description

Runs YAML regression tests against the target org. Every record a test creates is deleted when the test finishes, even if it fails. Tests are loaded from the tests directory (default "tests", skipping "tests/drafts") unless you name files with --test.

Refuses to run against a production org unless you pass --allow-production or the test sets "allowProduction: true".

# examples

- Run every test in ./tests against the org with alias "dev":

  <%= config.bin %> <%= command.id %> --target-org dev

- Run only tests tagged "opportunity":

  <%= config.bin %> <%= command.id %> --suite opportunity --target-org dev

- Run one test file and get JSON output for CI:

  <%= config.bin %> <%= command.id %> --test tests/large-opp.yaml --target-org dev --json

# flags.test.summary

Test file to run. Repeat the flag to run several.

# flags.suite.summary

Run only tests that have this tag.

# flags.tests-dir.summary

Folder to look for tests in when --test isn't given.

# flags.allow-production.summary

Allow running against a production org.

# error.noTestsDir

Tests folder "%s" doesn't exist. Create it, pass --tests-dir, or name files with --test.

# error.noTests

No tests found%s.

# error.invalidTests

%s test file(s) are invalid; nothing was run.
