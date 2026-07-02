/**
 * @fileoverview Small HTTP helpers for public metadata connectors.
 */

/**
 * Fetch with a short retry loop for transient public API failures.
 *
 * @param url Request URL.
 * @param init Fetch options.
 * @param attempts Number of attempts.
 * @returns Fetch response.
 */
export async function fetchWithRetry(url: URL, init: RequestInit, attempts = 3): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, init);
      if (response.ok || !isRetryableStatus(response.status) || attempt === attempts) return response;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
      if (attempt === attempts) break;
    }
    await delay(150 * attempt);
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
