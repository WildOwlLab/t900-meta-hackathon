import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { REVOKE_AFTER_MS, downloadText } from '../../src/web/download';

interface FakeLink {
  href?: string;
  download?: string;
  rel?: string;
  clicked: boolean;
  removed: boolean;
  click(): void;
  remove(): void;
}

describe('downloadText', () => {
  const events: string[] = [];
  const links: FakeLink[] = [];
  let revoked: string[];

  beforeEach(() => {
    vi.useFakeTimers();
    events.length = 0;
    links.length = 0;
    revoked = [];

    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:fake-url');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation((url) => {
      revoked.push(url);
      events.push('revoked');
    });
    vi.stubGlobal('document', {
      createElement: () => {
        const link: FakeLink = {
          clicked: false,
          removed: false,
          click() {
            this.clicked = true;
            events.push('clicked');
          },
          remove() {
            this.removed = true;
            events.push('removed');
          },
        };
        links.push(link);
        return link;
      },
      body: { append: () => events.push('appended') },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('puts the link in the page BEFORE clicking it, which some browsers require', () => {
    downloadText('a.md', 'text/markdown', '# hi');
    expect(events.slice(0, 3)).toEqual(['appended', 'clicked', 'removed']);
  });

  it('sets the file name, a safe rel, and points the link at the blob', () => {
    downloadText('report.json', 'application/json', '{}');
    expect(links[0]).toMatchObject({ download: 'report.json', href: 'blob:fake-url', rel: 'noopener' });
  });

  it('keeps the blob URL alive long enough for Firefox and Safari to start the download', () => {
    downloadText('a.txt', 'text/plain', 'x');
    expect(revoked).toEqual([]); // not revoked straight away
    vi.advanceTimersByTime(REVOKE_AFTER_MS - 1);
    expect(revoked).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(revoked).toEqual(['blob:fake-url']); // but not leaked forever
  });

  it('waits at least a few seconds, never zero', () => {
    expect(REVOKE_AFTER_MS).toBeGreaterThanOrEqual(10_000);
  });

  it('builds the blob from the exact text with the right type, declared UTF-8', async () => {
    const create = vi.mocked(URL.createObjectURL);
    downloadText('a.md', 'text/markdown', 'café — ok');
    const blob = create.mock.calls[0]![0] as Blob;
    expect(blob.type).toBe('text/markdown;charset=utf-8');
    expect(await blob.text()).toBe('café — ok');
  });
});
