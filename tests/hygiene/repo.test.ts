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
const SELF = 'tests/hygiene/repo.test.ts';

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

const files = listFiles(root).map((path) => relative(root, path));
const textFiles = files.filter((file) => TEXT.test(file) && file !== SELF);
const read = (file: string) => readFileSync(join(root, file), 'utf8');

describe('H2: standalone and separate from existing assets', () => {
  it('has no reference to the existing repositories or the production site', () => {
    const forbidden = [/t900\.si/i, /Project-T900/i, /WildOwlLab\/T900/i];
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

describe('H3: no secrets', () => {
  it('ignores .env files in git', () => {
    expect(() => execFileSync('git', ['check-ignore', '-q', '.env'], { cwd: root })).not.toThrow();
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
