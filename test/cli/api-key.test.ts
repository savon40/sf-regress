import { expect } from 'chai';
import { ApiKeyDeps, MissingApiKeyError, readEnvValue, resolveApiKey } from '../../src/cli/api-key.js';

function deps(overrides: Partial<ApiKeyDeps> = {}): ApiKeyDeps {
  return {
    env: {},
    cwd: '/project',
    readFile: () => undefined,
    isGitIgnored: () => true,
    ...overrides,
  };
}

describe('resolveApiKey', () => {
  it('prefers the flag', () => {
    const result = resolveApiKey('sk-flag', deps({ env: { ANTHROPIC_API_KEY: 'sk-env' } }));
    expect(result).to.deep.equal({ key: 'sk-flag', source: 'flag' });
  });

  it('uses the environment before .env', () => {
    const result = resolveApiKey(
      undefined,
      deps({ env: { ANTHROPIC_API_KEY: 'sk-env' }, readFile: () => 'ANTHROPIC_API_KEY=sk-file' })
    );
    expect(result).to.deep.equal({ key: 'sk-env', source: 'environment' });
  });

  it('reads .env from the project folder', () => {
    let readPath = '';
    const result = resolveApiKey(
      undefined,
      deps({
        readFile: (path) => {
          readPath = path;
          return 'ANTHROPIC_API_KEY=sk-file\n';
        },
      })
    );
    expect(readPath).to.equal('/project/.env');
    expect(result).to.deep.equal({ key: 'sk-file', source: '.env', warning: undefined });
  });

  it('warns when .env is not gitignored', () => {
    const result = resolveApiKey(
      undefined,
      deps({ readFile: () => 'ANTHROPIC_API_KEY=sk-file', isGitIgnored: () => false })
    );
    expect(result.warning).to.match(/\.gitignore/);
    expect(result.warning).not.to.include('sk-file');
  });

  it('does not warn outside a git repo', () => {
    const result = resolveApiKey(
      undefined,
      deps({ readFile: () => 'ANTHROPIC_API_KEY=sk-file', isGitIgnored: () => undefined })
    );
    expect(result.warning).to.equal(undefined);
  });

  it('treats blank values as missing', () => {
    expect(() =>
      resolveApiKey('  ', deps({ env: { ANTHROPIC_API_KEY: '' }, readFile: () => 'ANTHROPIC_API_KEY=\n' }))
    ).to.throw(MissingApiKeyError);
  });

  it('explains how to set the key when none is found', () => {
    expect(() => resolveApiKey(undefined, deps())).to.throw(
      MissingApiKeyError,
      /\.env file.*\n.*export ANTHROPIC_API_KEY.*\n.*--api-key/s
    );
  });
});

describe('readEnvValue', () => {
  it('reads only the named variable', () => {
    const contents = 'OTHER=x\nANTHROPIC_API_KEY=sk-1\n';
    expect(readEnvValue(contents, 'ANTHROPIC_API_KEY')).to.equal('sk-1');
    expect(readEnvValue(contents, 'MISSING')).to.equal(undefined);
  });

  it('handles comments, quotes, export and spacing', () => {
    expect(readEnvValue('# comment\nANTHROPIC_API_KEY = "sk-2"', 'ANTHROPIC_API_KEY')).to.equal('sk-2');
    expect(readEnvValue("ANTHROPIC_API_KEY='sk-3'", 'ANTHROPIC_API_KEY')).to.equal('sk-3');
    expect(readEnvValue('export ANTHROPIC_API_KEY=sk-4', 'ANTHROPIC_API_KEY')).to.equal('sk-4');
    expect(readEnvValue('ANTHROPIC_API_KEY=sk-5  # my key', 'ANTHROPIC_API_KEY')).to.equal('sk-5');
    expect(readEnvValue('ANTHROPIC_API_KEY=sk-6\r\n', 'ANTHROPIC_API_KEY')).to.equal('sk-6');
  });

  it('ignores commented-out lines', () => {
    expect(readEnvValue('# ANTHROPIC_API_KEY=old\n', 'ANTHROPIC_API_KEY')).to.equal(undefined);
  });
});
