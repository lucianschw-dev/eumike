import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fetchDocumentByCelex } from "../cellar/rest";
import { _clearCachesForTests } from "../util/cache";

const fixtureHtml = readFileSync(
    join(__dirname, "fixtures", "cellar-gdpr.html"),
    "utf-8",
);

describe("EUR-Lex REST fetcher", () => {
    beforeEach(() => {
        _clearCachesForTests();
    });
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("fetches GDPR (CELEX 32016R0679) and returns non-empty body", async () => {
        const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
            new Response(fixtureHtml, {
                status: 200,
                headers: { "Content-Type": "text/html" },
            }),
        );

        const doc = await fetchDocumentByCelex({
            celex: "32016R0679",
            language: "en",
            format: "text",
        });

        expect(fetchSpy).toHaveBeenCalled();
        expect(doc.celex).toBe("32016R0679");
        expect(doc.body).toContain("General Data Protection Regulation");
        expect(doc.body.length).toBeGreaterThan(100);
        expect(doc.sourceUrl).toContain("eur-lex.europa.eu");
        expect(doc.sourceUrl).toContain("32016R0679");
    });

    it("falls back to English when requested language returns the 'not found' page", async () => {
        let calls = 0;
        vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
            calls++;
            if (calls === 1) {
                // First call (requested lang = Maltese) → EUR-Lex error page
                return new Response(
                    "<html><body>The requested document does not exist in the language requested.</body></html>",
                    { status: 200 },
                );
            }
            return new Response(fixtureHtml, { status: 200 });
        });

        const doc = await fetchDocumentByCelex({
            celex: "32016R0679",
            language: "mt",
            format: "text",
        });
        expect(doc.body).toContain("General Data Protection Regulation");
        expect(calls).toBeGreaterThanOrEqual(2);
    });

    it("returns HTML mode when format='html'", async () => {
        vi.spyOn(globalThis, "fetch").mockResolvedValue(
            new Response(fixtureHtml, { status: 200 }),
        );
        const doc = await fetchDocumentByCelex({
            celex: "32016R0679",
            format: "html",
        });
        expect(doc.bodyFormat).toBe("html");
        expect(doc.body).toMatch(/<h1|<p/);
    });
});