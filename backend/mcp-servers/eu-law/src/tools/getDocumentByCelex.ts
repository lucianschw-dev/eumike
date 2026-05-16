import { z } from "zod";
import { fetchDocumentByCelex } from "../cellar/rest";
import { cacheDocument } from "../util/cache";
import { isCelex } from "../cellar/celex";
import { EU_LANGUAGES, type DocumentResult } from "../types";
import type { EuLanguage } from "../util/lang";

export const getDocumentByCelexSchema = z.object({
    celex: z.string().refine(isCelex, {
        message: "Not a valid CELEX number (e.g. 32016R0679 or 62018CJ0311)",
    }),
    language: z.enum(EU_LANGUAGES as [EuLanguage, ...EuLanguage[]]).optional(),
    format: z.enum(["html", "text"]).optional(),
});

export type GetDocumentByCelexInput = z.infer<typeof getDocumentByCelexSchema>;

export async function runGetDocumentByCelex(
    input: GetDocumentByCelexInput,
): Promise<DocumentResult> {
    return cacheDocument(
        "doc_by_celex",
        input as unknown as Record<string, unknown>,
        () => fetchDocumentByCelex(input),
    );
}
