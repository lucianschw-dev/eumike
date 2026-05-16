import { z } from "zod";
import {
    runSearchLegislation,
    searchLegislationSchema,
} from "./searchLegislation";
import { EU_LANGUAGES } from "../types";
import type { EuLanguage } from "../util/lang";

export const searchTreatiesSchema = z.object({
    query: z.string().min(2).max(200),
    language: z.enum(EU_LANGUAGES as [EuLanguage, ...EuLanguage[]]).optional(),
    limit: z.number().int().min(1).max(50).optional(),
});

export type SearchTreatiesInput = z.infer<typeof searchTreatiesSchema>;

export async function runSearchTreaties(input: SearchTreatiesInput) {
    // Sector 1 = treaties (TEU, TFEU, Charter, protocols, accession acts).
    return runSearchLegislation({
        ...input,
        sector: "1",
    });
}

// Re-exported for symmetry; not strictly needed since this re-uses
// `searchLegislationSchema` shape internally.
export { searchLegislationSchema };
