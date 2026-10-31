import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readNight } from '../src/digest/read.js';

describe('readNight on runs/2026-10-28.jsonl', () => {
  const night = readNight('runs', '2026-10-28');

  it('finds 5 jobs and the truncated last line', () => {
    expect(night?.rows).toHaveLength(5);
    expect(night?.badLines).toBe(1);
    expect(night?.counts).toEqual({ ok: 10, retry: 4, fail: 1 });
  });

  it('sorts rows by job', () => {
    expect(night?.rows.map((r) => r.job)).toEqual([
      'digest/render',
      'fixtures/refresh',
      'lane/sync',
      'notes/backup',
      'rig/rotate-logs',
    ]);
  });

  it('keeps a job with a null owner', () => {
    expect(night?.rows.find((r) => r.job === 'digest/render')).toEqual({
      job: 'digest/render',
      owner: null,
      runs: 1,
      retries: 0,
      lastStatus: 'ok',
      lastError: null,
      firstAt: '2026-10-29T05:41:09+01:00',
      lastAt: '2026-10-29T05:41:09+01:00',
    });
  });

  it('counts runs and retries, keeps the last error after a later ok', () => {
    expect(night?.rows.find((r) => r.job === 'fixtures/refresh')).toEqual({
      job: 'fixtures/refresh',
      owner: 'rook',
      runs: 4,
      retries: 3,
      lastStatus: 'ok',
      lastError: 'upstream 503',
      firstAt: '2026-10-29T01:30:00+01:00',
      lastAt: '2026-10-29T01:37:00+01:00',
    });
  });

  it('reports a failed job, times as logged', () => {
    expect(night?.rows.find((r) => r.job === 'notes/backup')).toMatchObject({
      lastStatus: 'fail',
      lastError: 'quota exceeded',
    });
    expect(night?.rows.find((r) => r.job === 'lane/sync')).toMatchObject({
      firstAt: '2026-10-28T23:00:06+01:00',
      lastAt: '2026-10-29T05:00:04+01:00',
    });
  });
});

describe('readNight on temp nights', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'rig-digest-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const write = (lines: string[], night = '2026-01-01') =>
    writeFileSync(join(dir, `${night}.jsonl`), lines.join('\n'));
  const line = (fields: Record<string, unknown>) =>
    JSON.stringify({ at: '2026-01-01T00:00:00+01:00', job: 'a', status: 'ok', owner: 'rook', ...fields });

  it('returns null for a night with no file', () => {
    expect(readNight(dir, '2026-01-01')).toBeNull();
  });

  it('returns a night with no rows for an empty file', () => {
    write([]);
    expect(readNight(dir, '2026-01-01')).toEqual({
      rows: [],
      badLines: 0,
      counts: { ok: 0, retry: 0, fail: 0 },
    });
  });

  it.each(['../2026-01-01', '2026-01-01/', '2026-1-1', 'latest', '', '2026-01-01\n', '2026-01-01.jsonl'])(
    'returns null for the night name %j',
    (name) => {
      write([line({})]);
      expect(readNight(dir, name)).toBeNull();
    },
  );

  it('does not read outside the runs dir', () => {
    write([line({})]);
    expect(readNight(join(dir, 'sub'), '../2026-01-01')).toBeNull();
  });

  it('counts lines that parse but lack or break the fields', () => {
    write([
      'null',
      '[]',
      '7',
      '{not json',
      '{"at":"2026-01-01T00:00:00+01:00","job":"a","status":"ok"}',
      line({ at: 5 }),
      line({ job: null }),
      line({ status: 'skipped' }),
      line({ owner: 7 }),
      line({ error: 7 }),
      line({ job: 'kept' }),
    ]);
    const night = readNight(dir, '2026-01-01');
    expect(night?.badLines).toBe(10);
    expect(night?.rows.map((r) => r.job)).toEqual(['kept']);
    expect(night?.counts).toEqual({ ok: 1, retry: 0, fail: 0 });
  });

  it('does not count blank lines or the trailing newline as bad', () => {
    write([line({}), '', line({}), '']);
    const night = readNight(dir, '2026-01-01');
    expect(night?.badLines).toBe(0);
    expect(night?.rows[0]?.runs).toBe(2);
  });

  it('sorts in plain string order, not locale order', () => {
    write([line({ job: 'b' }), line({ job: 'a' }), line({ job: 'Z' }), line({ job: 'B' })]);
    expect(readNight(dir, '2026-01-01')?.rows.map((r) => r.job)).toEqual(['B', 'Z', 'a', 'b']);
  });

  it('keeps the most recent error, null if the job never had one', () => {
    write([
      line({ job: 'a', status: 'retry', error: 'first' }),
      line({ job: 'a', status: 'retry', error: 'second' }),
      line({ job: 'a' }),
      line({ job: 'b' }),
    ]);
    const rows = readNight(dir, '2026-01-01')?.rows;
    expect(rows?.[0]?.lastError).toBe('second');
    expect(rows?.[1]?.lastError).toBeNull();
  });

  it('keeps each offset exactly as logged', () => {
    write([line({ at: '2026-01-01T23:00:00-05:00' }), line({ at: '2026-01-02T01:00:00+09:00' })]);
    expect(readNight(dir, '2026-01-01')?.rows[0]).toMatchObject({
      firstAt: '2026-01-01T23:00:00-05:00',
      lastAt: '2026-01-02T01:00:00+09:00',
    });
  });
});
