import { describe, it, expect } from "vitest";
import {
    buildSearchLegislationQuery,
    buildSearchCaseLawQuery,
    buildEcliLookupQuery,
    escapeSparqlLiteral,
} from "../cellar/sparql";

describe("SPARQL query builders", () => {
    it("escapes literal strings safely", () => {
        expect(escapeSparqlLiteral('he said "hi"')).toBe('he said \\"hi\\"');
        expect(escapeSparqlLiteral("line1\nline2")).toBe("line1\\nline2");
        expect(escapeSparqlLiteral("a\\b")).toBe("a\\\\b");
    });

    it("builds a legislation search query with default sector 3", () => {
        const q = buildSearchLegislationQuery({ query: "data protection", limit: 5 });
        expect(q).toContain('CONTAINS(LCASE(STR(?title)), LCASE("data protection"))');
        expect(q).toContain('STRSTARTS(STR(?celex), "3")');
        expect(q).toContain("LIMIT 5");
        expect(q).toContain("ORDER BY DESC(?date)");
    });

    it("builds a legislation search query with treaty sector", () => {
        const q = buildSearchLegislationQuery({ query: "TFEU", sector: "1" });
        expect(q).toContain('STRSTARTS(STR(?celex), "1")');
    });

    it("caps limit at 50", () => {
        const q = buildSearchLegislationQuery({ query: "x", limit: 999 });
        expect(q).toContain("LIMIT 50");
    });

    it("includes date filters when provided", () => {
        const q = buildSearchLegislationQuery({
            query: "x",
            dateFrom: "2020-01-01",
            dateTo: "2024-12-31",
        });
        expect(q).toContain('?date >= "2020-01-01"');
        expect(q).toContain('?date <= "2024-12-31"');
    });

    it("rejects malformed dates silently (no FILTER injected)", () => {
        const q = buildSearchLegislationQuery({
            query: "x",
            // @ts-expect-error — feeding bad input deliberately
            dateFrom: "not a date",
        });
        expect(q).not.toContain("not a date");
    });

    it("filters case-law search by ECJ court letter", () => {
        const q = buildSearchCaseLawQuery({ query: "Schrems", court: "ECJ" });
        expect(q).toContain("^6\\\\d{4}C[JOC]");
    });

    it("filters case-law search by General Court letter", () => {
        const q = buildSearchCaseLawQuery({ query: "Schrems", court: "GC" });
        expect(q).toContain("^6\\\\d{4}T[JOC]");
    });

    it("builds an ECLI→CELEX lookup", () => {
        const q = buildEcliLookupQuery("ECLI:EU:C:2020:559");
        expect(q).toContain('"ECLI:EU:C:2020:559"');
        expect(q).toContain("?work cdm:case-law_ecli ?ecli");
        expect(q).toContain("LIMIT 1");
    });

    it("centralises CDM property names", async () => {
        // Smoke test that the constants object is the single source of truth.
        const { CDM } = await import("../cellar/sparql");
        expect(CDM.work_id_document).toBe("cdm:work_id_document");
        expect(CDM.case_law_ecli).toBe("cdm:case-law_ecli");
    });
});
