import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

const NIGHT = '2026-10-29';
const EMPTY = '2026-10-28';
const BAD = '2026-10-27';
const MISSING = '2026-10-30';

const line = (job: string, status: 'ok' | 'retry' | 'fail', at = '2026-10-29T14:10:00+01:00') =>
  JSON.stringify({ at, job, status, owner: 'lane-07', error: null });

let runsDir: string;

function appFor(dir: string) {
  return createApp({
    adapter: 'shim',
    installed: '2026-10-29T14:06:00+01:00',
    beatEverySeconds: 60,
    runsDir: dir,
  });
}

beforeAll(() => {
  runsDir = mkdtempSync(join(tmpdir(), 'rig-'));

  // Written out of order on purpose: the digest must sort by job name.
  writeFileSync(
    join(runsDir, `${NIGHT}.jsonl`),
    [line('zeta-export', 'ok'), line('alpha-sync', 'retry'), line('mid-backup', 'fail')].join('\n') + '\n',
  );
  writeFileSync(join(runsDir, `${EMPTY}.jsonl`), '');
  writeFileSync(
    join(runsDir, `${BAD}.jsonl`),
    [line('alpha-sync', 'ok', '2026-10-27T14:10:00+01:00'), 'this is not json', line('mid-backup', 'ok', '2026-10-27T14:20:00+01:00')].join('\n') + '\n',
  );
});

afterAll(() => {
  rmSync(runsDir, { recursive: true, force: true });
});

describe('GET /digest/:night', () => {
  it('renders 200 html with the job names', async () => {
    const res = await appFor(runsDir).request(`/digest/${NIGHT}`);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('alpha-sync');
    expect(html).toContain('mid-backup');
    expect(html).toContain('zeta-export');
  });

  it('lists jobs in the same order as the json rows', async () => {
    const app = appFor(runsDir);
    const html = await (await app.request(`/digest/${NIGHT}`)).text();
    const json = (await (await app.request(`/api/digest/${NIGHT}`)).json()) as { rows: { job: string }[] };
    const positions = json.rows.map((row) => html.indexOf(row.job));
    expect(positions.every((pos) => pos >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(json.rows.map((row) => row.job)).toEqual(['alpha-sync', 'mid-backup', 'zeta-export']);
  });

  it('returns 404 when the night has no file', async () => {
    const res = await appFor(runsDir).request(`/digest/${MISSING}`);
    expect(res.status).toBe(404);
  });

  it('renders the empty night as "nothing ran"', async () => {
    const res = await appFor(runsDir).request(`/digest/${EMPTY}`);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('nothing ran');
  });

  it('keeps the rows of a night with a bad line', async () => {
    const res = await appFor(runsDir).request(`/digest/${BAD}`);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('alpha-sync');
    expect(html).toContain('mid-backup');
  });

  it('returns 404 for a night that is not a date', async () => {
    const app = appFor(runsDir);
    expect((await app.request('/digest/..%2f..%2fetc')).status).toBe(404);
    expect((await app.request('/digest/not-a-night')).status).toBe(404);
  });
});

describe('GET /api/digest/:night', () => {
  it('returns 200 json with night, rows and badLines', async () => {
    const res = await appFor(runsDir).request(`/api/digest/${NIGHT}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { night: string; rows: unknown[]; badLines: number };
    expect(body.night).toBe(NIGHT);
    expect(body.rows).toHaveLength(3);
    expect(body.badLines).toBe(0);
  });

  it('returns 404 when the night has no file', async () => {
    const res = await appFor(runsDir).request(`/api/digest/${MISSING}`);
    expect(res.status).toBe(404);
  });

  it('returns no rows for the empty night', async () => {
    const res = await appFor(runsDir).request(`/api/digest/${EMPTY}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rows: unknown[]; badLines: number };
    expect(body.rows).toEqual([]);
    expect(body.badLines).toBe(0);
  });

  it('counts a bad line and keeps the rows', async () => {
    const res = await appFor(runsDir).request(`/api/digest/${BAD}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rows: { job: string }[]; badLines: number };
    expect(body.badLines).toBe(1);
    expect(body.rows.map((row) => row.job)).toEqual(['alpha-sync', 'mid-backup']);
  });

  it('returns 404 for a night that is not a date', async () => {
    const app = appFor(runsDir);
    expect((await app.request('/api/digest/..%2f..%2fetc')).status).toBe(404);
    expect((await app.request('/api/digest/not-a-night')).status).toBe(404);
  });
});
