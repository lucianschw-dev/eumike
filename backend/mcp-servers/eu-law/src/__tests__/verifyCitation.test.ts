import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { runVerifyCitation } from "../tools/verifyCitation";
import { _clearCachesForTests } from "../util/cache";
import { parseCelex, parseEcli, isCelex, isEcli, isEli } from "../cellar/celex";

describe("CELEX/ECLI/ELI parsing", () => {
    it("accepts well-formed CELEX numbers", () => {
        expect(isCelex("32016R0679")).toBe(true);
        expect(isCelex("62018CJ0311")).toBe(true);
        expect(isCelex("62003CJ0403")).toBe(true);
    });

    it("rejects malformed CELEX", () => {
        expect(isCelex("not-a-celex")).toBe(false);
        expect(isCelex("")).toBe(false);
        expect(isCelex("3201R0679")).toBe(false);
    });

    it("parses CELEX into structural parts", () => {
        const p = parseCelex("32016R0679");
        expect(p).toEqual({
            sector: "3",
            year: 2016,
            descriptor: "R",
            number: "0679",
        });
    });

    it("accepts well-formed ECLIs", () => {
        expect(isEcli("ECLI:EU:C:2020:559")).toBe(true);
        expect(isEcli("ECLI:EU:C:2005:446")).toBe(true);
        expect(isEcli("ECLI:EU:T:2019:1")).toBe(true);
    });

    it("parses ECLI", () => {
        const e = parseEcli("ECLI:EU:C:2020:559");
        expect(e).toEqual({
            country: "EU",
            court: "C",
            year: 2020,
            ordinal: "559",
        });
    });

    it("validates ELI URLs", () => {
        expect(isEli("http://data.europa.eu/eli/reg/2016/679/oj")).toBe(true);
        expect(isEli("https://eur-lex.europa.eu/eli/dir/95/46")).toBe(true);
        expect(isEli("not a url")).toBe(false);
    });
});

describe("verifyCitation tool", () => {
    beforeEach(() => _clearCachesForTests());
    afterEach(() => vi.restoreAllMocks());

    it("returns the CELEX directly when given a CELEX, with metadata", async () => {
        vi.spyOn(globalThis, "fetch").mockResolvedValue(
            new Response(
                JSON.stringify({
                    head: { vars: ["title", "ecli", "date"] },
                    results: {
                        bindings: [
                            {
                                title: {
                                    type: "literal",
                                    value: "Regulation (EU) 2016/679 (GDPR)",
                                },
                            },
                        ],
                    },
                }),
                { status: 200 },
            ),
        );
        const r = await runVerifyCitation({ citation: "32016R0679" });
        expect(r.canonical.celex).toBe("32016R0679");
        expect(r.canonical.title).toContain("GDPR");
        expect(r.confidence).toBeGreaterThanOrEqual(0.9);
    });

    it("resolves an ECLI to a CELEX via SPARQL lookup", async () => {
        // Two SPARQL calls happen: ECLI→CELEX lookup, then CELEX→metadata.
        let call = 0;
        vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
            call++;
            if (call === 1) {
                return new Response(
                    JSON.stringify({
                        head: { vars: ["celex", "work"] },
                        results: {
                            bindings: [
                                {
                                    celex: {
                                        type: "literal",
                                        value: "62018CJ0311",
                                    },
                                },
                            ],
                        },
                    }),
                    { status: 200 },
                );
            }
            return new Response(
                JSON.stringify({
                    head: { vars: ["title", "ecli", "date"] },
                    results: {
                        bindings: [
                            {
                                title: {
                                    type: "literal",
                                    value: "Schrems II judgment",
                                },
                            },
                        ],
                    },
                }),
                { status: 200 },
            );
        });

        const r = await runVerifyCitation({ citation: "ECLI:EU:C:2020:559" });
        expect(r.canonical.ecli).toBe("ECLI:EU:C:2020:559");
        expect(r.canonical.celex).toBe("62018CJ0311");
        expect(r.confidence).toBeGreaterThanOrEqual(0.9);
    });

    it("returns low confidence and a hint for free-text citations", async () => {
        const r = await runVerifyCitation({
            citation: "Case C-403/03 Schempp",
        });
        expect(r.confidence).toBeLessThan(0.5);
        expect(r.notes).toContain("eu_search_case_law");
    });

    it("returns low confidence for a non-citation string", async () => {
        const r = await runVerifyCitation({ citation: "some vague reference" });
        expect(r.confidence).toBeLessThan(0.5);
    });
});
