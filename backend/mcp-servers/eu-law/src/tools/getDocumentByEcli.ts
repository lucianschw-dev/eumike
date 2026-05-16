import { z } from "zod";
import { fetchDocumentByEcli } from "../cellar/rest";
import { buildEcliLookupQuery, runSparql } from "../cellar/sparql";
import { cacheDocument } from "../util/cache";
import { isEcli, buildEurLexUrl } from "../cellar/celex";
import { EU_LANGUAGES, type DocumentResult } from "../types";
import { normaliseLanguage, type EuLanguage } from "../util/lang";

export const getDocumentByEcliSchema = z.object({
    ecli: z.string().refine(isEcli, {
        message: "Not a valid ECLI (e.g. ECLI:EU:C:2020:559)",
    }),
    language: z.enum(EU_LANGUAGES as [EuLanguage, ...EuLanguage[]]).optional(),
    format: z.enum(["html", "text"]).optional(),
});

export type GetDocumentByEcliInput = z.infer<typeof getDocumentByEcliSchema>;

export async function runGetDocumentByEcli(
    input: GetDocumentByEcliInput,
): Promise<DocumentResult> {
    return cacheDocument(
        "doc_by_ecli",
        input as unknown as Record<string, unknown>,
        async () => {
            const lang = normaliseLanguage(input.language);

            // Resolve ECLI → CELEX first so the result object has a CELEX
            // populated. CELLAR can serve the document directly off the ECLI
            // URL too; we do both in parallel for robustness.
            let celex = "";
            try {
                const lookup = await runSparql(buildEcliLookupQuery(input.ecli));
                celex = lookup.results.bindings[0]?.celex?.value ?? "";
            } catch {
                /* swallow — we still try the direct ECLI fetch below */
            }

            const doc = await fetchDocumentByEcli({
                ecli: input.ecli,
                language: lang,
                format: input.format,
            });

            return {
                ...doc,
                celex,
                sourceUrl: celex
                    ? buildEurLexUrl(celex, lang.toUpperCase())
                    : doc.sourceUrl,
            };
        },
    );
}
