# summary

Turn test documents (Word, Markdown, text) into YAML tests, using AI.

# description

Put your test documents in tests/drafts/ (.docx, .md or .txt) and run this command. Each document can hold one test or many (test cases, a test plan, acceptance criteria). Claude splits it into separate tests, and each one is written like "sf regress create" does it: using the org's metadata, run once against the org to check it works, and fixed if a step fails. Records the check creates are deleted afterwards.

Each test is saved to tests/<test name>.yaml. When every test in a document is saved, the document is moved to a converted/ folder next to it (tests/drafts/converted/), so the next run skips it. If a test needs more detail, you'll be asked in the terminal; if you can't answer, the document stays where it is. Add the details to it and run the command again - tests already saved are skipped.

Uses your own Anthropic API key: --api-key, ANTHROPIC_API_KEY in the environment, or ANTHROPIC_API_KEY in a .env file in the current folder. The documents and the org metadata (names and settings, never record data) are sent to Anthropic. Running tests with "sf regress run" never uses AI.

# examples

- Convert every document in tests/drafts/:

  <%= config.bin %> <%= command.id %> --target-org dev

- Convert one document:

  <%= config.bin %> <%= command.id %> --file tests/drafts/opportunity-tests.docx --target-org dev

- Write the tests without running them against the org:

  <%= config.bin %> <%= command.id %> --no-verify --target-org dev

# flags.file.summary

Document to convert. Repeat the flag for several. Defaults to every .docx, .md and .txt file in <tests-dir>/drafts.

# flags.tests-dir.summary

Folder to save tests in. Drafts are read from its drafts/ sub-folder.

# flags.force.summary

Overwrite tests that already exist, instead of skipping them.

# flags.api-key.summary

Anthropic API key. Defaults to ANTHROPIC_API_KEY from the environment or a .env file.

# flags.model.summary

Claude model to use.

# flags.verify.summary

Run each new test once against the org to check it works, and let the AI fix failed steps.

# flags.prompt.summary

Ask questions in the terminal when a test is ambiguous. With --no-prompt, the questions are printed and that test is not saved.

# flags.allow-production.summary

Allow the verification runs against a production org.

# error.notFound

%s does not exist.

# error.fileType

%s is not a supported document. Use .docx, .md or .txt.
