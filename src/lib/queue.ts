// Minimal in-process concurrency queue (SPEC §8: "in-process queue, concurrency ≤3,
// is enough at this volume; note BullMQ + Redis as the upgrade path").
// At ~20–30 plans/day this is plenty; swap for BullMQ + Redis if volume grows.
export class ConcurrencyQueue {
  private active = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(private readonly limit: number) {}

  get running(): number {
    return this.active;
  }
  get pending(): number {
    return this.waiting.length;
  }

  enqueue<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const run = () => {
        this.active++;
        task()
          .then(resolve, reject)
          .finally(() => {
            this.active--;
            const next = this.waiting.shift();
            if (next) next();
          });
      };
      if (this.active < this.limit) run();
      else this.waiting.push(run);
    });
  }
}
