// CELLAR REST API client.
//
// Endpoint family: https://publications.europa.eu/resource/celex/{CELEX}
//                  https://publications.europa.eu/resource/ecli/{ECLI}
//                  https://publications.europa.eu/resource/eli/{ELI-path}
//
// Content negotiation:
//   - `Accept` selects the format (HTML, XML, PDF, …).
//   - `Accept-Language` selects the language manifestation (3-letter code).
//
// CELLAR returns 300 Multiple Choices when multiple language manifestations
// match; in that case the body contains an alternates list. For simplicity
// we re-issue with a more specific Accept-Language.

import * as cheerio from "cheerio";
import { fetchThrottled } from "../util/throttle";
import {
    DEFAULT_LANGUAGE,
    FALLBACK_CHAIN,
    LANG_2_TO_3,
    normaliseLanguage,
    type EuLanguage,
} from "../util/lang";
import { buildEurLexUrl } from "./celex";
import type { DocumentResult } from "../types";

export type FetchByCelexArgs = {
    celex: string;
    language?: EuLanguage;
    format?: "html" | "text";
};

export async function fetchDocumentByCelex(
    args: FetchByCelexArgs,
): Promise<DocumentResult> {
    const lang = normaliseLanguage(args.language);
    const format = args.format ?? "text";
    const { html, resolvedLang } = await fetchHtmlWithFallback(
        `https://publications.europa.eu/resource/celex/${encodeURIComponent(args.celex)}`,
        lang,
    );

    const { title, body } = extractContent(html, format);
    return {
        celex: args.celex,
        title: title || `Document ${args.celex}`,
        body,
        bodyFormat: format,
        language: resolvedLang,
        sourceUrl: buildEurLexUrl(args.celex, resolvedLang.toUpperCase()),
        metadata: {},
    };
}

export type FetchByEcliArgs = {
    ecli: string;
    language?: EuLanguage;
    format?: "html" | "text";
};

export async function fetchDocumentByEcli(
    args: FetchByEcliArgs,
): Promise<DocumentResult> {
    const lang = normaliseLanguage(args.language);
    const format = args.format ?? "text";
    const { html, resolvedLang } = await fetchHtmlWithFallback(
        `https://publications.europa.eu/resource/ecli/${encodeURIComponent(args.ecli)}`,
        lang,
    );

    const { title, body } = extractContent(html, format);
    return {
        celex: "", // populated by the tool layer if it has run an ECLI→CELEX resolve
        ecli: args.ecli,
        title: title || `Case ${args.ecli}`,
        body,
        bodyFormat: format,
        language: resolvedLang,
        sourceUrl: `https://eur-lex.europa.eu/legal-content/${resolvedLang.toUpperCase()}/TXT/?qid=&uri=ECLI:${encodeURIComponent(args.ecli)}`,
        metadata: {},
    };
}

export type FetchByEliArgs = {
    eli: string;
    language?: EuLanguage;
    format?: "html" | "text";
};

export async function fetchDocumentByEli(
    args: FetchByEliArgs,
): Promise<DocumentResult> {
    const lang = normaliseLanguage(args.language);
    const format = args.format ?? "text";
    // ELI URIs come in their own URL form already — pass directly.
    const { html, resolvedLang } = await fetchHtmlWithFallback(args.eli, lang);

    const { title, body } = extractContent(html, format);
    return {
        celex: "",
        eli: args.eli,
        title: title || "Document",
        body,
        bodyFormat: format,
        language: resolvedLang,
        sourceUrl: args.eli,
        metadata: {},
    };
}

async function fetchHtmlWithFallback(
    url: string,
    preferred: EuLanguage,
): Promise<{ html: string; resolvedLang: EuLanguage }> {
    const tryOrder: EuLanguage[] = [
        preferred,
        ...FALLBACK_CHAIN.filter((l) => l !== preferred),
    ];

    let last: { status: number; body: string } | null = null;
    for (const lang of tryOrder) {
        const res = await fetchThrottled(url, {
            headers: {
                Accept: "application/xhtml+xml; notice=object, application/xhtml+xml, text/html",
                "Accept-Language": LANG_2_TO_3[lang],
            },
        });
        last = { status: res.status, body: res.body };
        if (res.status >= 200 && res.status < 300 && res.body.trim().length > 0) {
            return { html: res.body, resolvedLang: lang };
        }
    }

    throw new Error(
        `CELLAR fetch failed for ${url}: last status ${last?.status ?? "unknown"}`,
    );
}

// Strip scripts/styles, keep paragraphs/headings. The CELLAR HTML payloads
// are XHTML with a mix of structural and metadata markup; for "text" mode we
// concatenate visible text, for "html" we return a lightly-sanitised HTML.
function extractContent(
    html: string,
    format: "html" | "text",
): { title: string; body: string } {
    const $ = cheerio.load(html);
    $("script, style, noscript").remove();

    let title = $("title").first().text().trim();
    if (!title) {
        title = $("h1, h2").first().text().trim();
    }

    if (format === "html") {
        // Return body innerHTML if present, otherwise the full doc.
        const bodyHtml = $("body").html();
        return { title, body: (bodyHtml ?? html).trim() };
    }

    // Text mode: collapse whitespace, separate block elements with newlines.
    $("br").replaceWith("\n");
    const text = $("body").text() || $.root().text();
    const cleaned = text.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
    return { title, body: cleaned };
}

// Used by the case-law search post-processor to build a richer hit object.
export function celexToEurLexUrl(celex: string, lang: EuLanguage = DEFAULT_LANGUAGE): string {
    return buildEurLexUrl(celex, lang.toUpperCase());
}
