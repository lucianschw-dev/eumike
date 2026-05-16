// CELEX, ECLI, and ELI parsing/validation.
//
// References:
//   CELEX format: https://eur-lex.europa.eu/content/help/faq/intro.html
//   ECLI format:  https://e-justice.europa.eu/175/EN/european_case_law_identifier_ecli
//   ELI format:   https://eur-lex.europa.eu/eli-register/about.html
//
// CELEX structure (10–13 characters):
//   sector(1) | year(4) | descriptor(1–2) | natural-number(4)
//   e.g. 32016R0679 = sector 3 (legislation), 2016, Regulation (R), no. 0679
//   e.g. 62018CJ0311 = sector 6 (case-law), 2018, judgment ECJ (CJ), no. 0311
//
// ECLI structure (mandatory parts):
//   ECLI:<country>:<court>:<year>:<ordinal>
//   For EU: ECLI:EU:<C|T|F>:<year>:<seq>
//     C = Court of Justice, T = General Court, F = Civil Service Tribunal

import type { CelexSector } from "../types";

const CELEX_REGEX = /^([1-9CE])(\d{4})([A-Z]{1,2})(\d{4})(?:\(\d{2}\))?$/;
const ECLI_REGEX = /^ECLI:([A-Z]{2,8}):([A-Z0-9]{1,7}):(\d{4}):([A-Z0-9.]{1,25})$/i;

export type CelexParts = {
    sector: CelexSector;
    year: number;
    descriptor: string; // R = Regulation, L = Directive, D = Decision, CJ = ECJ judgment, …
    number: string;     // 4-digit string, preserves leading zeros
};

export function parseCelex(raw: string): CelexParts | null {
    const trimmed = raw.trim().toUpperCase();
    const m = CELEX_REGEX.exec(trimmed);
    if (!m) return null;
    const [, sector, year, descriptor, num] = m;
    return {
        sector: sector as CelexSector,
        year: parseInt(year, 10),
        descriptor,
        number: num,
    };
}

export function isCelex(raw: string): boolean {
    return parseCelex(raw) !== null;
}

export type EcliParts = {
    country: string;
    court: string;
    year: number;
    ordinal: string;
};

export function parseEcli(raw: string): EcliParts | null {
    const trimmed = raw.trim();
    const m = ECLI_REGEX.exec(trimmed);
    if (!m) return null;
    const [, country, court, year, ordinal] = m;
    return {
        country: country.toUpperCase(),
        court: court.toUpperCase(),
        year: parseInt(year, 10),
        ordinal,
    };
}

export function isEcli(raw: string): boolean {
    return parseEcli(raw) !== null;
}

// ELI URLs look like: http://data.europa.eu/eli/reg/2016/679/oj
// We accept the canonical form and the legacy form with `eli.eli.eli` typos.
const ELI_REGEX =
    /^https?:\/\/(?:data\.europa\.eu|eur-lex\.europa\.eu)\/eli\/([a-z_]+)\/(\d{4})\/(\d+)(?:\/[^?#]*)?$/i;

export type EliParts = {
    type: string;   // reg, dir, dec, …
    year: number;
    number: number;
};

export function parseEli(raw: string): EliParts | null {
    const m = ELI_REGEX.exec(raw.trim());
    if (!m) return null;
    return {
        type: m[1].toLowerCase(),
        year: parseInt(m[2], 10),
        number: parseInt(m[3], 10),
    };
}

export function isEli(raw: string): boolean {
    return parseEli(raw) !== null;
}

// Convert a parsed CJEU case citation like "Case C-403/03" into the
// case-number form that is concatenated into a CELEX number. Returns the
// natural-number portion (4 digits) and the inferred court letter.
export function caseNumberToCelexParts(
    rawCaseNumber: string,
): { courtLetter: "C" | "T" | "F"; ordinal: string } | null {
    const m = /^([CTF])-(\d{1,4})\/(\d{2,4})\s*(?:[A-Z]{1,4})?$/i.exec(
        rawCaseNumber.trim(),
    );
    if (!m) return null;
    return {
        courtLetter: m[1].toUpperCase() as "C" | "T" | "F",
        ordinal: m[2].padStart(4, "0"),
    };
}

export function buildEurLexUrl(celex: string, language = "EN"): string {
    return `https://eur-lex.europa.eu/legal-content/${language.toUpperCase()}/TXT/?uri=CELEX:${encodeURIComponent(celex)}`;
}

export function buildCuriaUrl(ecli: string): string {
    // curia.europa.eu's juris-search supports the ECLI as a direct query
    // parameter; this is the user-facing browse URL.
    return `https://curia.europa.eu/juris/liste.jsf?language=en&num=${encodeURIComponent(ecli)}`;
}
