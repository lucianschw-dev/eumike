// In-memory LRU cache shared across the MCP server process. Survives the
// process lifetime; a restart clears it. That's fine — CELLAR data is stable
// enough that recomputing on cold start is cheap.

import { LRUCache } from "lru-cache";

const searchTtlMs =
    (parseInt(process.env.EU_LAW_MCP_CACHE_TTL_SEARCH_SECONDS ?? "3600", 10) ||
        3600) * 1000;
const docTtlMs =
    (parseInt(
        process.env.EU_LAW_MCP_CACHE_TTL_DOCUMENT_SECONDS ?? "86400",
        10,
    ) || 86_400) * 1000;

const searchCache = new LRUCache<string, string>({
    max: 500,
    ttl: searchTtlMs,
});

const docCache = new LRUCache<string, string>({
    max: 200,
    ttl: docTtlMs,
});

function key(scope: string, args: Record<string, unknown>): string {
    // Deterministic key — sort properties so {a:1,b:2} and {b:2,a:1} collide.
    const sorted = Object.keys(args)
        .sort()
        .reduce<Record<string, unknown>>((acc, k) => {
            acc[k] = args[k];
            return acc;
        }, {});
    return `${scope}:${JSON.stringify(sorted)}`;
}

export function cacheSearch<T>(
    scope: string,
    args: Record<string, unknown>,
    fn: () => Promise<T>,
): Promise<T> {
    return cached(searchCache, scope, args, fn);
}

export function cacheDocument<T>(
    scope: string,
    args: Record<string, unknown>,
    fn: () => Promise<T>,
): Promise<T> {
    return cached(docCache, scope, args, fn);
}

async function cached<T>(
    cache: LRUCache<string, string>,
    scope: string,
    args: Record<string, unknown>,
    fn: () => Promise<T>,
): Promise<T> {
    const k = key(scope, args);
    const hit = cache.get(k);
    if (hit !== undefined) {
        return JSON.parse(hit) as T;
    }
    const fresh = await fn();
    cache.set(k, JSON.stringify(fresh));
    return fresh;
}

// Test hook — never call from production code paths.
export function _clearCachesForTests(): void {
    searchCache.clear();
    docCache.clear();
}
