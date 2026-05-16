import { z } from "zod";
import {
    buildSearchCaseLawQuery,
    runSparql,
    type SearchCaseLawArgs,
} from "../cellar/sparql";
import { cacheSearch } from "../util/cache";
import { buildCuriaUrl, buildEurLexUrl } from "../cellar/celex";
import { normaliseLanguage, type EuLanguage } from "../util/lang";
import { EU_LANGUAGES, type SearchHit } from "../types";

export const searchCaseLawSchema = z.object({
    query: z.string().min(2).max(200),
    court: z.enum(["ECJ", "GC", "any"]).optional(),
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

export type SearchCaseLawInput = z.infer<typeof searchCaseLawSchema>;

export async function runSearchCaseLaw(
    input: SearchCaseLawInput,
): Promise<SearchHit[]> {
    const args: SearchCaseLawArgs = {
        query: input.query,
        court: input.court,
        dateFrom: input.dateFrom,
        dateTo: input.dateTo,
        language: input.language,
        limit: input.limit,
    };

    return cacheSearch("search_case_law", args as unknown as Record<string, unknown>, async () => {
        const sparql = buildSearchCaseLawQuery(args);
        const result = await runSparql(sparql);
        const lang = normaliseLanguage(input.language);

        return result.results.bindings.map((row): SearchHit => {
            const celex = row.celex?.value ?? "";
            const ecli = row.ecli?.value;
            return {
                celex,
                ecli,
                title: row.title?.value ?? "",
                date: row.date?.value?.slice(0, 10),
                language: lang,
                eurlexUrl: buildEurLexUrl(celex, lang.toUpperCase()),
                curiaUrl: ecli ? buildCuriaUrl(ecli) : undefined,
            };
        });
    });
}
