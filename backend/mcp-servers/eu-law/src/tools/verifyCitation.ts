import { z } from "zod";
import { isCelex, isEcli, parseCelex, parseEcli } from "../cellar/celex";
import type { CitationVerification } from "../types";

export const verifyCitationSchema = z.object({
    citation: z.string().min(2).max(500),
});

export type VerifyCitationInput = z.infer<typeof verifyCitationSchema>;

// Pure regex-based citation verification. No network calls.
//
// We accept the two forms where a *single* canonical answer exists:
//   1. CELEX numbers (e.g. 32016R0679, 62018CJ0311)
//   2. ECLIs (e.g. ECLI:EU:C:2020:559)
//
// Free-text citations like "Case C-403/03 Schempp" or "Regulation (EU)
// 2016/679" can map to multiple CELEX numbers (judgment vs. order vs.
// opinion; original vs. amending act), so we don't try to guess. The LLM
// should call eu_get_document_by_celex or eu_get_document_by_ecli directly
// once it has resolved the citation through other means (search, the
// EUR-Lex web UI, the user's own clarification, etc.).
export async function runVerifyCitation(
    input: VerifyCitationInput,
): Promise<CitationVerification> {
    const text = input.citation.trim();

    if (isCelex(text)) {
        return {
            canonical: { celex: text },
            confidence: 0.95,
            notes:
                "Valid CELEX number. Use eu_get_document_by_celex to fetch.",
        };
    }

    if (isEcli(text)) {
        return {
            canonical: { ecli: text },
            confidence: 0.95,
            notes:
                "Valid ECLI. Use eu_get_document_by_ecli to fetch the case.",
        };
    }

    return {
        canonical: { title: text },
        confidence: 0.1,
        notes:
            "Citation is not a CELEX or ECLI. Ask the user for an identifier, " +
            "or look it up at https://eur-lex.europa.eu/ and call the document " +
            "fetch tools with the result.",
    };
}

export { parseCelex, parseEcli };