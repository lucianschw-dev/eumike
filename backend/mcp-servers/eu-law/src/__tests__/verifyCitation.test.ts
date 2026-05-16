import { describe, it, expect } from "vitest";
import { runVerifyCitation } from "../tools/verifyCitation";
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

describe("verifyCitation tool (regex-only, no network)", () => {
    it("recognises a CELEX number with high confidence", async () => {
        const r = await runVerifyCitation({ citation: "32016R0679" });
        expect(r.canonical.celex).toBe("32016R0679");
        expect(r.confidence).toBeGreaterThanOrEqual(0.9);
        expect(r.notes).toContain("eu_get_document_by_celex");
    });

    it("recognises an ECLI with high confidence", async () => {
        const r = await runVerifyCitation({ citation: "ECLI:EU:C:2020:559" });
        expect(r.canonical.ecli).toBe("ECLI:EU:C:2020:559");
        expect(r.confidence).toBeGreaterThanOrEqual(0.9);
        expect(r.notes).toContain("eu_get_document_by_ecli");
    });

    it("returns low confidence for free-text citations", async () => {
        const r = await runVerifyCitation({
            citation: "Case C-403/03 Schempp",
        });
        expect(r.confidence).toBeLessThan(0.5);
        expect(r.notes).toBeDefined();
    });

    it("returns low confidence for unparseable input", async () => {
        const r = await runVerifyCitation({ citation: "some vague reference" });
        expect(r.confidence).toBeLessThan(0.5);
    });
});