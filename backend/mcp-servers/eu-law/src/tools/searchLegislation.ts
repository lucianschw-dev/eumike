import { z } from "zod";
import {
    buildSearchLegislationQuery,
    runSparql,
    type SearchLegislationArgs,
} from "../cellar/sparql";
import { cacheSearch } from "../util/cache";
import { buildEurLexUrl } from "../cellar/celex";
import { normaliseLanguage, type EuLanguage } from "../util/lang";
import { EU_LANGUAGES, type SearchHit } from "../types";

export const searchLegislationSchema = z.object({
    query: z.string().min(2).max(200),
    sector: z.enum(["1", "3"]).optional(),
    dateFrom: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional(),
    dateTo: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional(),
    language: z.enum(EU_LANGUAGES as [EuLanguage, ...EuLanguage[]]).optional(),
    limit: z.number().int().min(1).max(50).optional(),
});

export type SearchLegislationInput = z.infer<typeof searchLegislationSchema>;

export async function runSearchLegislation(
    input: SearchLegislationInput,
): Promise<SearchHit[]> {
    const args: SearchLegislationArgs = {
        query: input.query,
        sector: input.sector,
        dateFrom: input.dateFrom,
        dateTo: input.dateTo,
        language: input.language,
        limit: input.limit,
    };

    return cacheSearch("search_legislation", args as unknown as Record<string, unknown>, async () => {
        const sparql = buildSearchLegislationQuery(args);
        const result = await runSparql(sparql);
        const lang = normaliseLanguage(input.language);

        return result.results.bindings.map((row): SearchHit => {
            const celex = row.celex?.value ?? "";
            return {
                celex,
                title: row.title?.value ?? "",
                date: row.date?.value?.slice(0, 10),
                language: lang,
                eurlexUrl: buildEurLexUrl(celex, lang.toUpperCase()),
            };
        });
    });
}
