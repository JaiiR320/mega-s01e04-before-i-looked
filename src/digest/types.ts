export type RunStatus = 'ok' | 'retry' | 'fail';

export type DigestRow = {
  job: string;
  owner: string | null;
  runs: number;
  retries: number;
  lastStatus: RunStatus;
  lastError: string | null;
  firstAt: string;
  lastAt: string;
};

export type Night = {
  rows: DigestRow[];
  badLines: number;
  counts: { ok: number; retry: number; fail: number };
};

// Null when the night has no file or its name is not YYYY-MM-DD.
export type ReadNight = (runsDir: string, night: string) => Night | null;
