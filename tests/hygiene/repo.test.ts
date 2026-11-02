/**
 * Repository hygiene (H1 to H3). Guards the rules this project was started under:
 * standalone, event-created work only, no secrets, no touching existing infrastructure.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.smoke', 'coverage', 'playwright-report', 'test-results']);
const SKIP_FILES = new Set(['package-lock.json']);
const TEXT = /\.(ts|tsx|js|mjs|json|md|css|html|ya?ml)$|(^|\/)\.env\.example$|(^|\/)\.gitignore$/;
/** Always written with forward slashes, because every path below is normalised to forward slashes. */
const SELF = 'tests/hygiene/repo.test.ts';

/**
 * Windows hands back backslash paths (src\web\App.tsx). Every pattern in this file is written with forward
 * slashes, so paths are converted ONCE, here, before anything is matched against them.
 */
const toPosix = (path: string): string => path.replace(/\\/g, '/');

/**
 * Files may be checked out with CRLF line endings (Windows with core.autocrlf, or a ZIP made there).
 * Content is compared as LF text so a line ending never decides whether a test passes.
 */
const toLf = (text: string): string => text.replace(/\r\n/g, '\n');

function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) out.push(...listFiles(join(dir, entry.name)));
    } else if (!SKIP_FILES.has(entry.name)) {
      out.push(join(dir, entry.name));
    }
  }
  return out;
}

const files = listFiles(root).map((path) => toPosix(relative(root, path)));
// This file contains the forbidden patterns as data, so it must not scan itself.
const textFiles = files.filter((file) => TEXT.test(file) && file !== SELF);
const read = (file: string) => toLf(readFileSync(join(root, file), 'utf8'));

/** True inside a real git work tree. False for a ZIP download, or if git is not installed. */
function insideGitWorkTree(): boolean {
  try {
    return execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() === 'true';
  } catch {
    return false;
  }
}

describe('cross-platform file handling', () => {
  it('turns Windows paths into forward-slash paths, and leaves forward-slash paths alone', () => {
    expect(toPosix('src\\web\\App.tsx')).toBe('src/web/App.tsx');
    expect(toPosix('tests\\hygiene\\repo.test.ts')).toBe(SELF);
    expect(toPosix('src/web/App.tsx')).toBe('src/web/App.tsx');
    expect(toPosix('.env.example')).toBe('.env.example');
  });

  it('turns CRLF into LF, and leaves LF alone', () => {
    expect(toLf('A=\r\nB=\r\n')).toBe('A=\nB=\n');
    expect(toLf('A=\nB=\n')).toBe('A=\nB=\n');
    expect(toLf('no newline')).toBe('no newline');
  });

  it('lists every file with forward slashes only, so the patterns below match on any platform', () => {
    expect(files.length).toBeGreaterThan(50);
    expect(files.filter((file) => file.includes('\\'))).toEqual([]);
    expect(files).toContain('src/web/App.tsx');
  });

  it('can find itself under its normalised path, and then excludes itself from every scan', () => {
    expect(files).toContain(SELF);
    expect(textFiles).not.toContain(SELF);
  });

  it('never returns CRLF text from read()', () => {
    expect(read('.env.example')).not.toContain('\r');
    expect(read('README.md')).not.toContain('\r');
  });

  it('keeps line endings LF in the repository itself, so a Windows checkout is not converted', () => {
    expect(read('.gitattributes')).toMatch(/^\*\s+text=auto\s+eol=lf$/m);
  });
});

describe('H2: standalone and separate from existing assets', () => {
  it('has no reference to the existing repositories or the production site', () => {
    // WildOwlLab/T900 is the existing product's repository. This repository is WildOwlLab/t900-meta-hackathon.
    const forbidden = [/t900\.si/i, /Project-T900/i, /WildOwlLab\/T900(?!-meta-hackathon)/i];
    const hits = textFiles.flatMap((file) =>
      forbidden.filter((pattern) => pattern.test(read(file))).map((pattern) => `${file}: ${pattern}`),
    );
    expect(hits).toEqual([]);
  });

  it('contains no Cloudflare deployment files or dependencies', () => {
    const names = files.map((file) => file.split('/').pop()!);
    expect(names.filter((name) => /^wrangler\.(toml|json|jsonc)$/.test(name) || name === '.dev.vars')).toEqual([]);
    expect(files.filter((file) => file.startsWith('functions/'))).toEqual([]);
    const manifest = JSON.parse(read('package.json')) as Record<string, Record<string, string> | undefined>;
    const dependencies = Object.keys({ ...manifest.dependencies, ...manifest.devDependencies });
    expect(dependencies.filter((name) => name === 'wrangler' || name.startsWith('@cloudflare/'))).toEqual([]);
  });

  it('keeps the README disclosure of pre-existing work', () => {
    const readme = read('README.md');
    expect(readme).toMatch(/Pre-existing work/);
    expect(readme).toMatch(/No pre-hackathon product code or Git history is copied/);
  });
});

describe('H4: browser code stays on the browser side', () => {
  const webFiles = files.filter((file) => file.startsWith('src/web/') && /\.(ts|tsx)$/.test(file));

  it('finds the web source files', () => {
    expect(webFiles.length).toBeGreaterThan(5);
  });

  it('never imports server code, so no server module or secret can reach the bundle', () => {
    const hits = webFiles.filter((file) => /from\s+['"][^'"]*\/server\//.test(read(file)));
    expect(hits).toEqual([]);
  });

  it('never reads environment variables or mentions provider settings', () => {
    const hits = webFiles.filter((file) => /process\.env|import\.meta\.env|META_API|META_MODEL/.test(read(file)));
    expect(hits).toEqual([]);
  });

  it('the evaluation harness stays out of the app: nothing in the browser or the server imports it', () => {
    const app = files.filter((file) => /^src\/(web|server|shared)\/.*\.(ts|tsx)$/.test(file));
    expect(app.length).toBeGreaterThan(10);
    expect(app.filter((file) => /from\s+['"][^'"]*\/eval(\/|['"])/.test(read(file)))).toEqual([]);
  });

  it('the evaluation harness never reaches the network on its own', () => {
    const evalFiles = files.filter((file) => file.startsWith('src/eval/') && file.endsWith('.ts'));
    expect(evalFiles.length).toBeGreaterThan(5);
    expect(evalFiles.filter((file) => /\bfetch\s*\(|node:https?|node:net|XMLHttpRequest/.test(read(file)))).toEqual([]);
  });

  it('the shared folder does not import server code either', () => {
    const shared = files.filter((file) => file.startsWith('src/shared/') && file.endsWith('.ts'));
    expect(shared.filter((file) => /from\s+['"][^'"]*\/server\//.test(read(file)))).toEqual([]);
  });
});

describe('H5: nothing private or temporary is committed', () => {
  it('has no private links, session IDs, sandbox paths or personal addresses in any text file', () => {
    const problems: string[] = [];
    const emails = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;
    for (const file of textFiles) {
      const content = read(file);
      if (/claude\.ai\//i.test(content)) problems.push(`${file}: a claude.ai link`);
      if (/session_[A-Za-z0-9]{10,}/.test(content)) problems.push(`${file}: a session ID`);
      if (/\/home\/user\b|\/tmp\/claude|\/root\//.test(content)) problems.push(`${file}: a local or sandbox path`);
      // Reserved .test domains appear in tests as obvious fakes. Anything else that looks like an address is a problem.
      for (const address of content.match(emails) ?? []) if (!/\.test$/.test(address)) problems.push(`${file}: ${address}`);
    }
    expect(problems).toEqual([]);
  });

  it('tracks no build output, test output, logs, backups or editor files', () => {
    let tracked: string[];
    try {
      tracked = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).split(/\r?\n/).filter(Boolean).map(toPosix);
    } catch {
      return; // not a git checkout, nothing to check
    }
    const temporary = /(^|\/)(node_modules|dist|coverage|test-results|playwright-report|\.smoke|\.eval|\.vite|\.turbo)\/|\.(log|tmp|bak|orig|swp|tsbuildinfo)$|(^|\/)\.DS_Store$/;
    expect(tracked.filter((file) => temporary.test(file))).toEqual([]);
    expect(tracked).toContain('package-lock.json');
    expect(tracked).not.toContain('.env');
  });
});

describe('the README stays true', () => {
  const readme = read('README.md');
  const scripts = Object.keys((JSON.parse(read('package.json')) as { scripts: Record<string, string> }).scripts);

  it('puts the pre-existing versus new work section ahead of any setup instructions', () => {
    const disclosure = readme.indexOf('## Pre-existing work vs new hackathon work');
    expect(disclosure).toBeGreaterThan(-1);
    for (const heading of ['## Try it in two minutes', '## Try the live path', '## Try it with a real key']) {
      expect(readme.indexOf(heading), heading).toBeGreaterThan(disclosure);
    }
    expect(readme).toMatch(/\*\*Pre-existing\*\*/);
    expect(readme).toMatch(/\*\*New in this repository\*\*/);
  });

  it('gives judges the three ways to run it, with the commands they asked for', () => {
    for (const command of ['git clone', 'npm install', 'npm test', 'npm run dev', 'npm run dev -- --stub', 'META_API_KEY', 'cp .env.example .env']) {
      expect(readme, command).toContain(command);
    }
  });

  it('only mentions npm scripts that exist', () => {
    const mentioned = [...readme.matchAll(/npm run ([a-z][a-z0-9:-]*)/g)].map((match) => match[1]!);
    expect(mentioned.length).toBeGreaterThan(5);
    expect(mentioned.filter((name) => !scripts.includes(name))).toEqual([]);
  });

  it('only links to files that exist', () => {
    const links = [...readme.matchAll(/\]\(([^)#\s]+)\)/g)].map((match) => match[1]!).filter((href) => !/^[a-z]+:/i.test(href));
    expect(links.length).toBeGreaterThan(3);
    expect(links.filter((href) => !existsSync(join(root, href)))).toEqual([]);
  });

  it('only names environment variables that .env.example or the dev script defines', () => {
    const defined = new Set([...read('.env.example').matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map((match) => match[1]!));
    const named = new Set(readme.match(/\b(?:META|PORT|WEB_PORT)[A-Z_]*\b/g) ?? []);
    const allowed = new Set([...defined, 'PORT', 'WEB_PORT']);
    expect([...named].filter((name) => !allowed.has(name))).toEqual([]);
  });

  it('reports percentages only for the live run, and only as recall or precision', () => {
    // A percentage is a performance claim. The only ones allowed are the reported live-run figures, and each has to
    // sit on a line that names the measure, so "99% accurate" or "twice as fast" cannot slip in under that exception.
    const withPercent = readme.split('\n').filter((line) => /\d+(\.\d+)?\s?%/.test(line));
    expect(withPercent.length).toBeGreaterThan(0);
    expect(withPercent.filter((line) => !/\b(recall|precision)\b/i.test(line))).toEqual([]);
  });

  it('says what the live run covered and what it did not, names the limits of its data, and says Firefox and Safari were not tested', () => {
    const flat = readme.replace(/[\s>]+/g, ' '); // sentences wrap, and some sit inside a Markdown quote
    // Scope: one provider, one model, run by the owner, not part of `npm test`, other hosts still unchecked.
    expect(flat).toMatch(/verified and tested against the \*\*Meta Model API\*\* with the model `muse-wonder-1\.0`/);
    expect(flat).toMatch(/not part of `npm test`/);
    expect(flat).toMatch(/Fireworks and Baseten values[^.]*still unchecked/);
    expect(flat).toMatch(/Downstream Comparison has only been run against the stub/);
    // The figures come from the authors' own development set, and are not a claim about new data.
    expect(flat).toMatch(/development set/);
    expect(flat).toMatch(/not a held-out test/);
    expect(flat).toMatch(/Firefox and Safari were not tested/);
  });
});

describe('H3: no secrets', () => {
  it('ignores .env files in git', () => {
    if (insideGitWorkTree()) {
      expect(() => execFileSync('git', ['check-ignore', '-q', '.env'], { cwd: root })).not.toThrow();
    } else {
      // A ZIP download has no .git, so ask the ignore file itself.
      expect(read('.gitignore')).toMatch(/^\.env$/m);
      expect(read('.gitignore')).toMatch(/^!\.env\.example$/m);
    }
  });

  it('lists .env in .gitignore, whether or not git is available', () => {
    expect(read('.gitignore')).toMatch(/^\.env$/m);
    expect(read('.gitignore')).toMatch(/^\.env\.\*$/m);
  });

  it('commits only a value-free .env.example', () => {
    expect(existsSync(join(root, '.env.example'))).toBe(true);
    const lines = read('.env.example')
      .split('\n')
      .filter((line) => line.trim() !== '' && !line.trim().startsWith('#'));
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) expect(line, line).toMatch(/^[A-Z][A-Z0-9_]*=$/);
  });

  it('has no key-shaped strings in tracked text files', () => {
    const patterns = [
      /\bsk-[A-Za-z0-9_-]{20,}/,
      /Bearer\s+[A-Za-z0-9._-]{24,}/,
      /\bAKIA[0-9A-Z]{16}\b/,
      /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
    ];
    // The one deliberate, obviously fake key used by the smoke script's negative control.
    // It is removed before scanning so the patterns themselves stay strict for everything else.
    const knownDummy = 'invalid-key-for-negative-control';
    const hits = textFiles.flatMap((file) => {
      const content = read(file).split(knownDummy).join('');
      return patterns.filter((pattern) => pattern.test(content)).map((pattern) => `${file}: ${pattern}`);
    });
    expect(hits).toEqual([]);
  });
});
