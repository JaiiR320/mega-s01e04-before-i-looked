import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DigestRow, Night, ReadNight, RunStatus } from './types.js';

type RunLine = {
  at: string;
  job: string;
  status: RunStatus;
  owner: string | null;
  error: string | null;
};

function isStatus(value: unknown): value is RunStatus {
  return value === 'ok' || value === 'retry' || value === 'fail';
}

// The edge: everything past this function can trust RunLine.
function parseLine(line: string): RunLine | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;

  const { at, job, status, owner, error } = parsed as Record<string, unknown>;
  if (typeof at !== 'string' || at === '') return null;
  if (typeof job !== 'string' || job === '') return null;
  if (!isStatus(status)) return null;
  if (typeof owner !== 'string' && owner !== null) return null;
  if (typeof error !== 'string' && error !== undefined && error !== null) return null;

  return { at, job, status, owner, error: error ?? null };
}

function readFile(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

export const readNight: ReadNight = (runsDir, night) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(night)) return null;

  const text = readFile(join(runsDir, `${night}.jsonl`));
  if (text === null) return null;

  const rows = new Map<string, DigestRow>();
  const counts: Night['counts'] = { ok: 0, retry: 0, fail: 0 };
  let badLines = 0;

  for (const raw of text.split('\n')) {
    if (raw.trim() === '') continue;

    const line = parseLine(raw);
    if (line === null) {
      badLines += 1;
      continue;
    }

    counts[line.status] += 1;
    const row = rows.get(line.job);
    const retry = line.status === 'retry' ? 1 : 0;
    if (row === undefined) {
      rows.set(line.job, {
        job: line.job,
        owner: line.owner,
        runs: 1,
        retries: retry,
        lastStatus: line.status,
        lastError: line.error,
        firstAt: line.at,
        lastAt: line.at,
      });
    } else {
      row.owner = line.owner;
      row.runs += 1;
      row.retries += retry;
      row.lastStatus = line.status;
      row.lastError = line.error ?? row.lastError;
      row.lastAt = line.at;
    }
  }

  return {
    rows: [...rows.values()].sort((a, b) => (a.job < b.job ? -1 : a.job > b.job ? 1 : 0)),
    badLines,
    counts,
  };
};
