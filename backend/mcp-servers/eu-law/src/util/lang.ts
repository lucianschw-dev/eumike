// EU acts are published in 24 languages. CELLAR's content negotiation uses
// 3-letter ISO 639-2 codes (eng, fra, deu, …) but the rest of the world uses
// the 2-letter ISO 639-1 codes (en, fr, de). We accept the 2-letter codes
// from callers and map them ourselves.

import type { EuLanguage } from "../types";

// Re-export so downstream modules can import `EuLanguage` from here without
// reaching across to ../types — keeps the language-handling concerns colocated.
export type { EuLanguage };

export const LANG_2_TO_3: Record<EuLanguage, string> = {
    bg: "bul", cs: "ces", da: "dan", de: "deu", el: "ell", en: "eng",
    es: "spa", et: "est", fi: "fin", fr: "fra", ga: "gle", hr: "hrv",
    hu: "hun", it: "ita", lt: "lit", lv: "lav", mt: "mlt", nl: "nld",
    pl: "pol", pt: "por", ro: "ron", sk: "slk", sl: "slv", sv: "swe",
};

export const LANG_2_TO_URI: Record<EuLanguage, string> = {
    bg: "http://publications.europa.eu/resource/authority/language/BUL",
    cs: "http://publications.europa.eu/resource/authority/language/CES",
    da: "http://publications.europa.eu/resource/authority/language/DAN",
    de: "http://publications.europa.eu/resource/authority/language/DEU",
    el: "http://publications.europa.eu/resource/authority/language/ELL",
    en: "http://publications.europa.eu/resource/authority/language/ENG",
    es: "http://publications.europa.eu/resource/authority/language/SPA",
    et: "http://publications.europa.eu/resource/authority/language/EST",
    fi: "http://publications.europa.eu/resource/authority/language/FIN",
    fr: "http://publications.europa.eu/resource/authority/language/FRA",
    ga: "http://publications.europa.eu/resource/authority/language/GLE",
    hr: "http://publications.europa.eu/resource/authority/language/HRV",
    hu: "http://publications.europa.eu/resource/authority/language/HUN",
    it: "http://publications.europa.eu/resource/authority/language/ITA",
    lt: "http://publications.europa.eu/resource/authority/language/LIT",
    lv: "http://publications.europa.eu/resource/authority/language/LAV",
    mt: "http://publications.europa.eu/resource/authority/language/MLT",
    nl: "http://publications.europa.eu/resource/authority/language/NLD",
    pl: "http://publications.europa.eu/resource/authority/language/POL",
    pt: "http://publications.europa.eu/resource/authority/language/POR",
    ro: "http://publications.europa.eu/resource/authority/language/RON",
    sk: "http://publications.europa.eu/resource/authority/language/SLK",
    sl: "http://publications.europa.eu/resource/authority/language/SLV",
    sv: "http://publications.europa.eu/resource/authority/language/SWE",
};

export const DEFAULT_LANGUAGE: EuLanguage = "en";

// Fallback chain — if the requested language isn't available for a given
// manifestation, try these in order before giving up.
export const FALLBACK_CHAIN: EuLanguage[] = ["en", "fr", "de"];

export function normaliseLanguage(lang?: string): EuLanguage {
    if (!lang) return DEFAULT_LANGUAGE;
    const l = lang.toLowerCase().slice(0, 2) as EuLanguage;
    return l in LANG_2_TO_3 ? l : DEFAULT_LANGUAGE;
}

export function languageUri(lang: EuLanguage): string {
    return LANG_2_TO_URI[lang];
}
