# summary

Write a test from a plain-English description, using AI.

# description

Describe the test in plain English. sf-regress reads the org's metadata for the objects you mention (fields, picklist values, record types, buttons, approval processes), asks Claude to write the YAML test, and runs it once against the org to check it works. If a step fails, Claude fixes it (up to 3 times). Records the check creates are deleted afterwards.

If the description is ambiguous, you'll be asked questions instead of the AI guessing. Answer them in the terminal, or add the details to the description and run the command again.

Uses your own Anthropic API key: --api-key, ANTHROPIC_API_KEY in the environment, or ANTHROPIC_API_KEY in a .env file in the current folder. The description and the org metadata (names and settings, never record data) are sent to Anthropic. Running tests with "sf regress run" never uses AI.

# examples

- Write a test and save it to tests/:

  <%= config.bin %> <%= command.id %> "Creating an opportunity over 50k in Prospecting sets the forecast category to Pipeline" --target-org dev

- Pick the test name and file:

  <%= config.bin %> <%= command.id %> "A new case from the web gets priority Medium" --name "Web case priority" --output tests/cases/web-priority.yaml --target-org dev

- Write the test without running it against the org:

  <%= config.bin %> <%= command.id %> "..." --no-verify --target-org dev

# args.description.summary

The test, in plain English.

# flags.name.summary

Name of the test. By default the AI picks one.

# flags.output.summary

File to save the test to. Defaults to <tests-dir>/<test name>.yaml.

# flags.tests-dir.summary

Folder to save the test in when --output isn't given.

# flags.force.summary

Overwrite the output file if it exists.

# flags.api-key.summary

Anthropic API key. Defaults to ANTHROPIC_API_KEY from the environment or a .env file.

# flags.model.summary

Claude model to use.

# flags.verify.summary

Run the new test once against the org to check it works, and let the AI fix failed steps.

# flags.prompt.summary

Ask questions in the terminal when the description is ambiguous. With --no-prompt, the questions are printed and nothing is saved.

# flags.allow-production.summary

Allow the verification run against a production org.

# error.exists

%s already exists. Pass --force to overwrite it, or --output to choose another file.

# error.production

Refusing to verify against production org %s: the check creates real records. Pass --allow-production to do it anyway, or --no-verify to skip the check.

# error.questions

The test needs more detail before it can be written. Add the answers to your description and run the command again.
