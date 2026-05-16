import { z } from "zod";
import { fetchDocumentByEli } from "../cellar/rest";
import { cacheDocument } from "../util/cache";
import { isEli } from "../cellar/celex";
import { EU_LANGUAGES, type DocumentResult } from "../types";
import type { EuLanguage } from "../util/lang";

export const getDocumentByEliSchema = z.object({
    eli: z.string().refine(isEli, {
        message:
            "Not a valid ELI URL (e.g. http://data.europa.eu/eli/reg/2016/679/oj)",
    }),
    language: z.enum(EU_LANGUAGES as [EuLanguage, ...EuLanguage[]]).optional(),
    format: z.enum(["html", "text"]).optional(),
});

export type GetDocumentByEliInput = z.infer<typeof getDocumentByEliSchema>;

export async function runGetDocumentByEli(
    input: GetDocumentByEliInput,
): Promise<DocumentResult> {
    return cacheDocument(
        "doc_by_eli",
        input as unknown as Record<string, unknown>,
        () => fetchDocumentByEli(input),
    );
}
