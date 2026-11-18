/** Cached snapshots for targeted React subscriptions; no document content copies. */
export class Store<T> {
  #value: T;
  #listeners = new Set<() => void>();
  constructor(value: T) {
    this.#value = value;
  }
  getSnapshot = (): T => this.#value;
  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };
  set(value: T): void {
    if (Object.is(this.#value, value)) return;
    this.#value = value;
    const errors: unknown[] = [];
    for (const listener of [...this.#listeners]) {
      try {
        listener();
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length)
      throw new AggregateError(errors, "Interface subscriber failed.");
  }
}
