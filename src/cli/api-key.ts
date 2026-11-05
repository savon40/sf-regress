import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Finds the user's Anthropic API key for the AI commands (create, convert).
 *
 * Order: --api-key flag, then ANTHROPIC_API_KEY in the environment, then a `.env`
 * file in the project folder. The key is never stored or logged by us.
 */

export const API_KEY_VAR = 'ANTHROPIC_API_KEY';

export type ApiKeySource = 'flag' | 'environment' | '.env';

export type ApiKeyResult = {
  key: string;
  source: ApiKeySource;
  /** Set when the key came from a .env file that git would commit. */
  warning?: string;
};

export type ApiKeyDeps = {
  env: NodeJS.ProcessEnv;
  cwd: string;
  /** Returns the file contents, or undefined if it doesn't exist. */
  readFile: (path: string) => string | undefined;
  /** True if git ignores the path, false if git would commit it, undefined if not in a git repo. */
  isGitIgnored: (path: string, cwd: string) => boolean | undefined;
};

export class MissingApiKeyError extends Error {
  public constructor() {
    super(
      [
        `No Anthropic API key found. The create and convert commands use your own key.`,
        `Set it one of these ways:`,
        `  - add ${API_KEY_VAR}=sk-ant-... to a .env file in your project (and add .env to .gitignore)`,
        `  - export ${API_KEY_VAR}=sk-ant-... in your shell profile or CI secrets`,
        `  - pass --api-key sk-ant-...`,
      ].join('\n')
    );
    this.name = 'MissingApiKeyError';
  }
}

export function resolveApiKey(flag: string | undefined, deps: ApiKeyDeps = defaultDeps()): ApiKeyResult {
  const fromFlag = flag?.trim();
  if (fromFlag) return { key: fromFlag, source: 'flag' };

  const fromEnv = deps.env[API_KEY_VAR]?.trim();
  if (fromEnv) return { key: fromEnv, source: 'environment' };

  const envPath = join(deps.cwd, '.env');
  const contents = deps.readFile(envPath);
  const fromFile = contents === undefined ? undefined : readEnvValue(contents, API_KEY_VAR);
  if (fromFile) {
    const ignored = deps.isGitIgnored('.env', deps.cwd);
    const warning =
      ignored === false
        ? `.env is not in .gitignore, so git would commit your API key. Add ".env" to .gitignore.`
        : undefined;
    return { key: fromFile, source: '.env', warning };
  }

  throw new MissingApiKeyError();
}

/**
 * Reads one variable from .env file contents. Only the named variable is read;
 * nothing is copied into process.env.
 */
export function readEnvValue(contents: string, name: string): string | undefined {
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (match?.[1] !== name) continue;
    let value = match[2];
    const quote = value[0];
    if ((quote === '"' || quote === "'") && value.endsWith(quote) && value.length >= 2) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, ''); // trailing comment on an unquoted value
    }
    value = value.trim();
    return value || undefined;
  }
  return undefined;
}

function defaultDeps(): ApiKeyDeps {
  return {
    env: process.env,
    cwd: process.cwd(),
    readFile: (path): string | undefined => {
      try {
        return readFileSync(path, 'utf8');
      } catch {
        return undefined;
      }
    },
    isGitIgnored: (path, cwd): boolean | undefined => {
      try {
        execFileSync('git', ['check-ignore', '-q', path], { cwd, stdio: 'ignore' });
        return true; // exit 0: ignored
      } catch (error) {
        // exit 1: not ignored; anything else (128 = not a repo, git missing): unknown
        return (error as { status?: number }).status === 1 ? false : undefined;
      }
    },
  };
}
