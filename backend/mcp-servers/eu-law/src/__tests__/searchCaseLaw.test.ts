import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runSearchCaseLaw } from "../tools/searchCaseLaw";
import { _clearCachesForTests } from "../util/cache";

const fixture = readFileSync(
    join(__dirname, "fixtures", "sparql-schrems-ii.json"),
    "utf-8",
);

describe("searchCaseLaw tool", () => {
    beforeEach(() => _clearCachesForTests());
    afterEach(() => vi.restoreAllMocks());

    it("returns hits with valid ECLIs", async () => {
        vi.spyOn(globalThis, "fetch").mockResolvedValue(
            new Response(fixture, {
                status: 200,
                headers: { "Content-Type": "application/sparql-results+json" },
            }),
        );

        const hits = await runSearchCaseLaw({
            query: "consumer protection 2024",
            language: "en",
            limit: 10,
        });

        expect(hits.length).toBeGreaterThanOrEqual(1);

        const ecliPattern = /^ECLI:EU:[CFTGZ]:\d{4}:\d+$/;
        const withEcli = hits.filter((h) => h.ecli);
        expect(withEcli.length).toBeGreaterThan(0);
        for (const h of withEcli) {
            expect(h.ecli).toMatch(ecliPattern);
        }
    });

    it("populates Schrems II ECLI when search yields it", async () => {
        vi.spyOn(globalThis, "fetch").mockResolvedValue(
            new Response(fixture, { status: 200 }),
        );
        const hits = await runSearchCaseLaw({ query: "Schrems", language: "en" });
        const schrems = hits.find((h) => h.celex === "62018CJ0311");
        expect(schrems).toBeDefined();
        expect(schrems?.ecli).toBe("ECLI:EU:C:2020:559");
        expect(schrems?.eurlexUrl).toContain("CELEX:62018CJ0311");
        expect(schrems?.curiaUrl).toContain("ECLI:EU:C:2020:559");
    });

    it("validates input — empty query is rejected by the zod schema", async () => {
        const { searchCaseLawSchema } = await import("../tools/searchCaseLaw");
        expect(() => searchCaseLawSchema.parse({ query: "" })).toThrow();
    });

    it("validates input — out-of-range limit is rejected", async () => {
        const { searchCaseLawSchema } = await import("../tools/searchCaseLaw");
        expect(() =>
            searchCaseLawSchema.parse({ query: "ok", limit: 999 }),
        ).toThrow();
    });
});
