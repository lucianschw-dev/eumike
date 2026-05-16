// Shared types for the EU-law MCP server.
//
// Tools return JSON-serialisable objects with stable shapes. The shape stays
// the same across CELLAR / curia.europa.eu fallback paths so the LLM never
// has to branch on data source.

export type EuLanguage =
    | "bg" | "cs" | "da" | "de" | "el" | "en" | "es" | "et" | "fi" | "fr"
    | "ga" | "hr" | "hu" | "it" | "lt" | "lv" | "mt" | "nl" | "pl" | "pt"
    | "ro" | "sk" | "sl" | "sv";

export const EU_LANGUAGES: EuLanguage[] = [
    "bg", "cs", "da", "de", "el", "en", "es", "et", "fi", "fr",
    "ga", "hr", "hu", "it", "lt", "lv", "mt", "nl", "pl", "pt",
    "ro", "sk", "sl", "sv",
];

// CELLAR sector codes (first digit of CELEX):
//   1 = Treaties
//   2 = International agreements
//   3 = Legislation (regulations, directives, decisions, …)
//   4 = Internal agreements / complementary legislation
//   5 = Preparatory acts
//   6 = Case-law (CJEU, GC, …)
//   7 = National implementing measures
//   8 = National case law
//   9 = Parliamentary questions
//   C = OJ C series
//   E = EFTA documents
export type CelexSector = "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "C" | "E";

export type SearchHit = {
    celex: string;
    ecli?: string;
    eli?: string;
    title: string;
    type?: string;
    court?: "ECJ" | "GC" | "CST" | "other";
    date?: string;       // ISO YYYY-MM-DD
    language: EuLanguage;
    eurlexUrl: string;
    curiaUrl?: string;
};

export type DocumentResult = {
    celex: string;
    ecli?: string;
    eli?: string;
    title: string;
    body: string;        // plain text or HTML depending on `format`
    bodyFormat: "html" | "text";
    language: EuLanguage;
    sourceUrl: string;
    metadata: {
        date?: string;
        type?: string;
        court?: string;
    };
};

export type CitationVerification = {
    canonical: {
        celex?: string;
        ecli?: string;
        eli?: string;
        title?: string;
    };
    confidence: number; // 0..1
    notes?: string;
};
