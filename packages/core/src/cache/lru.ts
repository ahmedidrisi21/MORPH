import type { Answer } from "../decisions/answer";

export interface CacheStore {
  get(key: string): Promise<Answer | undefined>;
  set(key: string, value: Answer, ttlMs: number): Promise<void>;
}

export const DEFAULT_CACHE_SIZE = 500;
export const DEFAULT_CACHE_TTL_MS = 10 * 60 * 1000;

/** In-memory LRU with per-entry TTL. */
export class LruCache implements CacheStore {
  readonly #map = new Map<string, { value: Answer; expires: number }>();
  readonly #max: number;
  readonly #clock: () => number;

  constructor(opts: { max?: number; clock?: () => number } = {}) {
    this.#max = opts.max ?? DEFAULT_CACHE_SIZE;
    this.#clock = opts.clock ?? Date.now;
  }

  get size(): number {
    return this.#map.size;
  }

  async get(key: string): Promise<Answer | undefined> {
    const hit = this.#map.get(key);
    if (!hit) return undefined;
    if (hit.expires <= this.#clock()) {
      this.#map.delete(key);
      return undefined;
    }
    this.#map.delete(key);
    this.#map.set(key, hit);
    return hit.value;
  }

  async set(key: string, value: Answer, ttlMs: number = DEFAULT_CACHE_TTL_MS): Promise<void> {
    this.#map.delete(key);
    this.#map.set(key, { value, expires: this.#clock() + ttlMs });
    while (this.#map.size > this.#max) {
      const oldest = this.#map.keys().next().value;
      if (oldest === undefined) break;
      this.#map.delete(oldest);
    }
  }
}
