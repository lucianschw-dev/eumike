// CELLAR SPARQL client.
//
// Endpoint: https://publications.europa.eu/webapi/rdf/sparql
// Docs:     https://op.europa.eu/en/web/eu-vocabularies/sparql
//
// The CDM (Common Data Model) ontology defines the property names used here.
// They are *centralised* in the constants object below — if CELLAR ships a
// new CDM version that renames a property, change it in one place.

import { fetchThrottled } from "../util/throttle";
import { languageUri, type EuLanguage } from "../util/lang";

export const CELLAR_SPARQL_URL =
    process.env.EU_LAW_MCP_SPARQL_URL ??
    "https://publications.europa.eu/webapi/rdf/sparql";

// CDM property URIs — single source of truth. If CELLAR renames any of these
// in a future ontology version, this is the only place that changes.
export const CDM = {
    work_id_document: "cdm:work_id_document",
    work_date_document: "cdm:work_date_document",
    work_created_by_agent: "cdm:work_created_by_agent",
    expression_belongs_to_work: "cdm:expression_belongs_to_work",
    expression_title: "cdm:expression_title",
    expression_uses_language: "cdm:expression_uses_language",
    case_law_ecli: "cdm:case-law_ecli",
    case_law_court: "cdm:case-law_delivered_by_court",
    case_law_judgment_type: "cdm:case-law_judgment_type",
    work_has_eli: "cdm:resource_legal_id_eli",
};

export const PREFIXES = `
PREFIX cdm: <http://publications.europa.eu/ontology/cdm#>
PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
PREFIX dcterms: <http://purl.org/dc/terms/>
PREFIX lang: <http://publications.europa.eu/resource/authority/language/>
`.trim();

// Escape a user-provided string for safe interpolation into a SPARQL
// FILTER(CONTAINS(...)) literal. SPARQL string literals need backslash,
// double-quote, and newline escaped.
export function escapeSparqlLiteral(s: string): string {
    return s
        .replace(/\\/g, "\\\\")
        .replace(/"/g, '\\"')
        .replace(/\n/g, "\\n")
        .replace(/\r/g, "\\r")
        .replace(/\t/g, "\\t");
}

export type SparqlRow = Record<string, { type: string; value: string }>;

export type SparqlResult = {
    head: { vars: string[] };
    results: { bindings: SparqlRow[] };
};

export async function runSparql(query: string): Promise<SparqlResult> {
    const url = `${CELLAR_SPARQL_URL}?query=${encodeURIComponent(query)}&format=application%2Fsparql-results%2Bjson`;
    const res = await fetchThrottled(url, {
        headers: {
            Accept: "application/sparql-results+json",
        },
    });
    if (res.status < 200 || res.status >= 300) {
        throw new Error(`SPARQL ${res.status}: ${res.body.slice(0, 300)}`);
    }
    return JSON.parse(res.body) as SparqlResult;
}

// ---------------------------------------------------------------------------
// Query builders
// ---------------------------------------------------------------------------

export type SearchLegislationArgs = {
    query: string;
    sector?: "1" | "3"; // 1 = treaties, 3 = secondary legislation (default 3)
    dateFrom?: string;
    dateTo?: string;
    language?: EuLanguage;
    limit?: number;
};

export function buildSearchLegislationQuery(args: SearchLegislationArgs): string {
    const lang = args.language ?? "en";
    const sector = args.sector ?? "3";
    const limit = Math.min(args.limit ?? 20, 50);
    const q = escapeSparqlLiteral(args.query);
    const dateFilter = buildDateFilter("?date", args.dateFrom, args.dateTo);

    return `${PREFIXES}
SELECT DISTINCT ?work ?celex ?title ?date WHERE {
  ?work ${CDM.work_id_document} ?celex .
  OPTIONAL { ?work ${CDM.work_date_document} ?date . }
  ?expr ${CDM.expression_belongs_to_work} ?work .
  ?expr ${CDM.expression_title} ?title .
  ?expr ${CDM.expression_uses_language} <${languageUri(lang)}> .
  FILTER(CONTAINS(LCASE(STR(?title)), LCASE("${q}")))
  FILTER(STRSTARTS(STR(?celex), "${sector}"))
  ${dateFilter}
}
ORDER BY DESC(?date)
LIMIT ${limit}`;
}

export type SearchCaseLawArgs = {
    query: string;
    court?: "ECJ" | "GC" | "any";
    dateFrom?: string;
    dateTo?: string;
    language?: EuLanguage;
    limit?: number;
};

export function buildSearchCaseLawQuery(args: SearchCaseLawArgs): string {
    const lang = args.language ?? "en";
    const limit = Math.min(args.limit ?? 20, 50);
    const q = escapeSparqlLiteral(args.query);
    const dateFilter = buildDateFilter("?date", args.dateFrom, args.dateTo);

    // CELEX sector 6 covers all EU case law. Within sector 6, the descriptor
    // letters identify the court:
    //   CJ, CO, CC = Court of Justice
    //   TJ, TO, TC = General Court (Tribunal)
    //   FJ, FO, FC = Civil Service Tribunal (defunct since 2016)
    let courtFilter = "";
    if (args.court === "ECJ") {
        courtFilter = `FILTER(REGEX(STR(?celex), "^6\\\\d{4}C[JOC]"))`;
    } else if (args.court === "GC") {
        courtFilter = `FILTER(REGEX(STR(?celex), "^6\\\\d{4}T[JOC]"))`;
    }

    return `${PREFIXES}
SELECT DISTINCT ?work ?celex ?ecli ?title ?date WHERE {
  ?work ${CDM.work_id_document} ?celex .
  OPTIONAL { ?work ${CDM.case_law_ecli} ?ecli . }
  OPTIONAL { ?work ${CDM.work_date_document} ?date . }
  ?expr ${CDM.expression_belongs_to_work} ?work .
  ?expr ${CDM.expression_title} ?title .
  ?expr ${CDM.expression_uses_language} <${languageUri(lang)}> .
  FILTER(CONTAINS(LCASE(STR(?title)), LCASE("${q}")))
  FILTER(STRSTARTS(STR(?celex), "6"))
  ${courtFilter}
  ${dateFilter}
}
ORDER BY DESC(?date)
LIMIT ${limit}`;
}

export type SearchTreatiesArgs = {
    query: string;
    language?: EuLanguage;
    limit?: number;
};

export function buildSearchTreatiesQuery(args: SearchTreatiesArgs): string {
    return buildSearchLegislationQuery({
        ...args,
        sector: "1",
    });
}

// Resolve ECLI → CELEX via SPARQL.
export function buildEcliLookupQuery(ecli: string): string {
    const e = escapeSparqlLiteral(ecli);
    return `${PREFIXES}
SELECT DISTINCT ?celex ?work WHERE {
  ?work ${CDM.case_law_ecli} ?ecli .
  ?work ${CDM.work_id_document} ?celex .
  FILTER(STR(?ecli) = "${e}")
}
LIMIT 1`;
}

// Pull title + date for a given CELEX, in a target language.
export function buildCelexMetadataQuery(
    celex: string,
    language: EuLanguage,
): string {
    const c = escapeSparqlLiteral(celex);
    return `${PREFIXES}
SELECT DISTINCT ?title ?date ?ecli WHERE {
  ?work ${CDM.work_id_document} ?celex .
  OPTIONAL { ?work ${CDM.case_law_ecli} ?ecli . }
  OPTIONAL { ?work ${CDM.work_date_document} ?date . }
  ?expr ${CDM.expression_belongs_to_work} ?work .
  ?expr ${CDM.expression_title} ?title .
  ?expr ${CDM.expression_uses_language} <${languageUri(language)}> .
  FILTER(STR(?celex) = "${c}")
}
LIMIT 1`;
}

function buildDateFilter(
    varName: string,
    from?: string,
    to?: string,
): string {
    const parts: string[] = [];
    if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) {
        parts.push(`${varName} >= "${from}"^^<http://www.w3.org/2001/XMLSchema#date>`);
    }
    if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) {
        parts.push(`${varName} <= "${to}"^^<http://www.w3.org/2001/XMLSchema#date>`);
    }
    return parts.length ? `FILTER(${parts.join(" && ")})` : "";
}
