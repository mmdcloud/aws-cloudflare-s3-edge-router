/**
 * Single-Flight In-Flight Request Coalescing (Thundering Herd Origin Shield)
 * Deduplicates concurrent requests for the same media chunk within the same edge isolate.
 */

export class SingleFlightCoalescer {
  private inFlightMap = new Map<string, Promise<Response>>();

  /**
   * Executes or shares an in-flight request for the given key.
   * If a fetch for this key is already in progress, subsequent callers wait for
   * that identical promise and receive cloned responses.
   */
  async do(key: string, fetchFn: () => Promise<Response>): Promise<Response> {
    const existing = this.inFlightMap.get(key);
    if (existing) {
      const response = await existing;
      return response.clone();
    }

    const promise = (async () => {
      try {
        const res = await fetchFn();
        return res;
      } finally {
        // Clean up from map once complete or failed
        this.inFlightMap.delete(key);
      }
    })();

    this.inFlightMap.set(key, promise);
    const result = await promise;
    return result.clone();
  }
}

// Global coalescer instance for the Worker isolate
export const edgeCoalescer = new SingleFlightCoalescer();

