// EUR-Lex / CELLAR REST client.
//
// We use eur-lex.europa.eu's legal-content endpoint, which is the same URL
// users see when they click through to a document. It returns HTML and is
// content-negotiated by language via the URL path (`/EN/TXT/HTML/...`,
// `/FR/TXT/HTML/...`, etc.).
//
// Why not the publications.europa.eu CELLAR resource endpoint?
//   - CELLAR's resource URLs (https://publications.europa.eu/resource/celex/...)
//     return 300 Multiple Choices and require complex Accept-Language
//     content-negotiation to reach a usable manifestation.
//   - eur-lex.europa.eu's legal-content endpoint is the canonical user-facing
//     URL anyway — using it means our `sourceUrl` is identical to what we
//     would link the user to.

import * as cheerio from "cheerio";
import { fetchThrottled } from "../util/throttle";
import {
    DEFAULT_LANGUAGE,
    FALLBACK_CHAIN,
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

    const { html, resolvedLang, sourceUrl } = await fetchHtmlWithFallback(
        (l) => buildEurLexHtmlUrl(args.celex, l),
        lang,
    );

    const { title, body } = extractContent(html, format);
    return {
        celex: args.celex,
        title: title || `Document ${args.celex}`,
        body,
        bodyFormat: format,
        language: resolvedLang,
        sourceUrl,
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

    // EUR-Lex accepts ECLIs directly as a URI parameter.
    const { html, resolvedLang, sourceUrl } = await fetchHtmlWithFallback(
        (l) =>
            `https://eur-lex.europa.eu/legal-content/${l.toUpperCase()}/TXT/HTML/?uri=ECLI:${encodeURIComponent(args.ecli)}`,
        lang,
    );

    const { title, body } = extractContent(html, format);
    return {
        celex: "",
        ecli: args.ecli,
        title: title || `Case ${args.ecli}`,
        body,
        bodyFormat: format,
        language: resolvedLang,
        sourceUrl,
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
    // ELI URIs are themselves dereferenceable URLs — fetch them directly.
    const { html, resolvedLang, sourceUrl } = await fetchHtmlWithFallback(
        () => args.eli,
        lang,
    );

    const { title, body } = extractContent(html, format);
    return {
        celex: "",
        eli: args.eli,
        title: title || "Document",
        body,
        bodyFormat: format,
        language: resolvedLang,
        sourceUrl,
        metadata: {},
    };
}

function buildEurLexHtmlUrl(celex: string, lang: EuLanguage): string {
    return `https://eur-lex.europa.eu/legal-content/${lang.toUpperCase()}/TXT/HTML/?uri=CELEX:${encodeURIComponent(celex)}`;
}

async function fetchHtmlWithFallback(
    urlBuilder: (lang: EuLanguage) => string,
    preferred: EuLanguage,
): Promise<{ html: string; resolvedLang: EuLanguage; sourceUrl: string }> {
    const tryOrder: EuLanguage[] = [
        preferred,
        ...FALLBACK_CHAIN.filter((l) => l !== preferred),
    ];

    let last: { status: number; body: string; url: string } | null = null;
    for (const lang of tryOrder) {
        const url = urlBuilder(lang);
        const res = await fetchThrottled(url, {
            headers: {
                Accept: "text/html, application/xhtml+xml",
                "Accept-Language": lang,
            },
        });
        last = { status: res.status, body: res.body, url };
        if (
            res.status >= 200 &&
            res.status < 300 &&
            res.body.trim().length > 0 &&
            // EUR-Lex returns a 200 with a "document not found" page for
            // unknown CELEX numbers. We detect that by looking for a marker
            // string that appears on error pages but not real documents.
            !res.body.includes("The requested document does not exist") &&
            !res.body.includes("No documents matching")
        ) {
            return { html: res.body, resolvedLang: lang, sourceUrl: url };
        }
    }

    throw new Error(
        `EUR-Lex fetch failed: last status ${last?.status ?? "unknown"} at ${last?.url ?? "unknown URL"}`,
    );
}

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
        const bodyHtml = $("body").html();
        return { title, body: (bodyHtml ?? html).trim() };
    }

    $("br").replaceWith("\n");
    const text = $("body").text() || $.root().text();
    const cleaned = text.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
    return { title, body: cleaned };
}

export function celexToEurLexUrl(celex: string, lang: EuLanguage = DEFAULT_LANGUAGE): string {
    return buildEurLexUrl(celex, lang.toUpperCase());
}