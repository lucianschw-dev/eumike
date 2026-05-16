import { z } from "zod";
import {
    buildCelexMetadataQuery,
    buildEcliLookupQuery,
    runSparql,
} from "../cellar/sparql";
import { cacheSearch } from "../util/cache";
import { isCelex, isEcli, parseCelex, parseEcli } from "../cellar/celex";
import type { CitationVerification } from "../types";
import { normaliseLanguage } from "../util/lang";

export const verifyCitationSchema = z.object({
    citation: z.string().min(2).max(500),
});

export type VerifyCitationInput = z.infer<typeof verifyCitationSchema>;

// Deterministic-only citation verification.
//
// We handle the two forms where a *single* canonical answer exists:
//   1. CELEX → metadata lookup
//   2. ECLI → CELEX resolution → metadata
//
// Free-text citations like "Case C-403/03 Schempp" or "Regulation (EU) 2016/679"
// have multiple plausible CELEX numbers (e.g. judgment vs. order vs. opinion
// from the same case number, or amending vs. original regulation). The LLM
// should call `eu_search_case_law` or `eu_search_legislation` for those —
// trying to guess the CELEX here was the bug-prone path in v1.
export async function runVerifyCitation(
    input: VerifyCitationInput,
): Promise<CitationVerification> {
    return cacheSearch(
        "verify_citation",
        input as unknown as Record<string, unknown>,
        () => verifyCitationImpl(input.citation),
    );
}

async function verifyCitationImpl(
    citation: string,
): Promise<CitationVerification> {
    const text = citation.trim();

    if (isCelex(text)) {
        const meta = await tryGetMetadataByCelex(text);
        return {
            canonical: {
                celex: text,
                title: meta?.title,
                ecli: meta?.ecli,
            },
            confidence: meta ? 0.95 : 0.7,
            notes: meta ? undefined : "CELEX valid but no metadata returned",
        };
    }

    if (isEcli(text)) {
        const lookup = await runSparql(buildEcliLookupQuery(text));
        const celex = lookup.results.bindings[0]?.celex?.value;
        if (celex) {
            const meta = await tryGetMetadataByCelex(celex);
            return {
                canonical: {
                    ecli: text,
                    celex,
                    title: meta?.title,
                },
                confidence: 0.95,
            };
        }
        return {
            canonical: { ecli: text },
            confidence: 0.5,
            notes:
                "ECLI is well-formed but not found in CELLAR " +
                "(may be a legacy case — try curia.europa.eu)",
        };
    }

    return {
        canonical: { title: text },
        confidence: 0.1,
        notes:
            "Citation is not a CELEX or ECLI. Use eu_search_case_law for case " +
            "citations like 'Case C-403/03' or eu_search_legislation for act " +
            "citations like 'Regulation (EU) 2016/679'.",
    };
}

async function tryGetMetadataByCelex(celex: string): Promise<
    { title?: string; ecli?: string; date?: string } | null
> {
    try {
        const sparql = buildCelexMetadataQuery(celex, normaliseLanguage("en"));
        const r = await runSparql(sparql);
        const row = r.results.bindings[0];
        if (!row) return null;
        return {
            title: row.title?.value,
            ecli: row.ecli?.value,
            date: row.date?.value?.slice(0, 10),
        };
    } catch {
        return null;
    }
}

export { parseCelex, parseEcli };
