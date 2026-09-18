/** Runs jobs one at a time in arrival order. One session, one driver. */
export class SerialQueue {
  private tail: Promise<unknown> = Promise.resolve();
  private waiting = 0;
  private active = false;

  /** Jobs ahead of a new arrival, including the one running. */
  get depth(): number {
    return this.waiting + (this.active ? 1 : 0);
  }

  run<T>(job: () => Promise<T>): Promise<T> {
    this.waiting += 1;
    const result = this.tail.then(async () => {
      this.waiting -= 1;
      this.active = true;
      try {
        return await job();
      } finally {
        this.active = false;
      }
    });
    this.tail = result.catch(() => undefined);
    return result;
  }
}
