# summary

Record a test by clicking through the org in a browser.

# description

Opens a browser logged in to the org, with Playwright's recorder toolbar. Click through your test, and use the toolbar's assert tools (visible, text, value) to add checks. Close the browser when you're done.

The recording is turned into a readable YAML test: Lightning selectors become field labels and button names, picklist and lookup choices become "browser.select" steps, typed names get a unique suffix per run, and records you created become variables that are deleted after each run. The records created while recording are deleted too, unless you pass --keep-records.

Finally the new test is replayed once (headless) to check it works.

# examples

- Record a test called "New account with a contact":

  <%= config.bin %> <%= command.id %> "New account with a contact" --target-org dev

- Start on the Opportunities tab and save to a specific file:

  <%= config.bin %> <%= command.id %> "Close a deal" --start /lightning/o/Opportunity/list --output tests/close-deal.yaml --target-org dev

# args.name.summary

Name of the test.

# flags.start.summary

Page to open first.

# flags.output.summary

File to save the test to. Defaults to <tests-dir>/<name>.yaml.

# flags.tests-dir.summary

Folder to save the test in when --output isn't given.

# flags.force.summary

Overwrite the output file if it exists.

# flags.keep-records.summary

Keep the records you created while recording (they are deleted by default).

# flags.verify.summary

Replay the new test once to check it works.

# flags.allow-production.summary

Allow recording against a production org.

# error.exists

%s already exists. Pass --force to overwrite it, or --output to choose another file.

# error.production

Refusing to record against production org %s: recording creates real records. Pass --allow-production to do it anyway.

# error.empty

Nothing was recorded. Click through your test before closing the browser.

# info.ready

A browser window is open. Click through your test; use the recorder toolbar to add checks (assert visible / text / value). Close the browser when you're done.
