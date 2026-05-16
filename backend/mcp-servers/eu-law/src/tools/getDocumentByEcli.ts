import { z } from "zod";
import { fetchDocumentByEcli } from "../cellar/rest";
import { cacheDocument } from "../util/cache";
import { isEcli } from "../cellar/celex";
import { EU_LANGUAGES, type DocumentResult } from "../types";
import type { EuLanguage } from "../util/lang";

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
        () => fetchDocumentByEcli(input),
    );
}