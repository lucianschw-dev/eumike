// Polite throttling for outbound HTTP from this MCP server. CELLAR is generous
// but not unlimited; bunching concurrent requests is a fast way to get 429s.
// All outbound HTTP from the tools should go through `throttle(...)`.

import pLimit from "p-limit";

const concurrency = Math.max(
    1,
    parseInt(process.env.EU_LAW_MCP_CONCURRENCY ?? "3", 10) || 3,
);

const limit = pLimit(concurrency);

export function throttle<T>(fn: () => Promise<T>): Promise<T> {
    return limit(fn);
}

export type FetchOptions = {
    headers?: Record<string, string>;
    method?: "GET" | "POST";
    body?: string;
    /** Number of retry attempts on 429/5xx. Default 3. */
    retries?: number;
    /** Base delay in ms for exponential backoff. Default 400ms. */
    backoffMs?: number;
    /** Per-call timeout in ms. Default 30000. */
    timeoutMs?: number;
};

const USER_AGENT =
    process.env.EU_LAW_MCP_USER_AGENT ??
    "EUMike/0.1 (https://github.com/; contact: maintainer@example.com)";

export async function fetchThrottled(
    url: string,
    opts: FetchOptions = {},
): Promise<{ status: number; headers: Headers; body: string }> {
    const retries = opts.retries ?? 3;
    const backoffMs = opts.backoffMs ?? 400;
    const timeoutMs = opts.timeoutMs ?? 30_000;

    return throttle(async () => {
        let lastErr: unknown = null;
        for (let attempt = 0; attempt <= retries; attempt++) {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), timeoutMs);
            try {
                const res = await fetch(url, {
                    method: opts.method ?? "GET",
                    headers: {
                        "User-Agent": USER_AGENT,
                        ...(opts.headers ?? {}),
                    },
                    body: opts.body,
                    signal: controller.signal,
                });
                clearTimeout(timer);
                const status = res.status;
                if (status === 429 || (status >= 500 && status < 600)) {
                    if (attempt < retries) {
                        const delay = backoffMs * Math.pow(2, attempt);
                        await sleep(delay);
                        continue;
                    }
                }
                const body = await res.text();
                return { status, headers: res.headers, body };
            } catch (err) {
                clearTimeout(timer);
                lastErr = err;
                if (attempt < retries) {
                    const delay = backoffMs * Math.pow(2, attempt);
                    await sleep(delay);
                    continue;
                }
            }
        }
        throw lastErr ?? new Error(`fetch failed: ${url}`);
    });
}

function sleep(ms: number): Promise<void> {
    return new Promise((res) => setTimeout(res, ms));
}
