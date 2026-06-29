// Small retry-with-backoff helper for external calls (SPEC §8: "Every external call:
// try/catch + one retry with backoff"). Defaults to 1 retry (2 attempts total).
export interface RetryOptions {
  retries?: number; // additional attempts after the first (default 1)
  baseMs?: number; // base backoff; doubles each attempt (default 300)
  label?: string; // for log lines
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const retries = opts.retries ?? 1;
  const baseMs = opts.baseMs ?? 300;
  let lastErr: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === retries) break;
      const delay = baseMs * 2 ** attempt; // 300, 600, 1200, ...
      if (opts.label) {
        console.warn(
          `[retry] ${opts.label} attempt ${attempt + 1} failed: ` +
            `${err instanceof Error ? err.message : String(err)} — retrying in ${delay}ms`,
        );
      }
      await sleep(delay);
    }
  }
  throw lastErr;
}
