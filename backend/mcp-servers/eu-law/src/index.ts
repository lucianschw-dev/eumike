// EU-law MCP server entry point.
//
// Exposes the 7 tools defined in src/tools/* over the Model Context Protocol's
// Streamable HTTP transport. This matches the transport used by the existing
// MCP servers in bettercallmitch (`mcp.bettercallclaude.ch/<server>/mcp`).
//
// Run with:
//   PORT=4040 node dist/index.js
//
// Health endpoint at `/health`. MCP endpoint at `/mcp` (POST).

import express, { type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import {
    runSearchLegislation,
    searchLegislationSchema,
} from "./tools/searchLegislation";
import {
    runSearchCaseLaw,
    searchCaseLawSchema,
} from "./tools/searchCaseLaw";
import {
    runSearchTreaties,
    searchTreatiesSchema,
} from "./tools/searchTreaties";
import {
    runGetDocumentByCelex,
    getDocumentByCelexSchema,
} from "./tools/getDocumentByCelex";
import {
    runGetDocumentByEcli,
    getDocumentByEcliSchema,
} from "./tools/getDocumentByEcli";
import {
    runGetDocumentByEli,
    getDocumentByEliSchema,
} from "./tools/getDocumentByEli";
import {
    runVerifyCitation,
    verifyCitationSchema,
} from "./tools/verifyCitation";

// ---------------------------------------------------------------------------
// MCP server with tool definitions
// ---------------------------------------------------------------------------

export function buildMcpServer(): McpServer {
    const server = new McpServer({
        name: "eu-law",
        version: "0.1.0",
    });

    server.registerTool(
        "eu_search_legislation",
        {
            description:
                "Search EU secondary legislation (regulations, directives, decisions) by keyword. " +
                "Returns up to 50 hits with CELEX number, title, date, and a EUR-Lex link. " +
                "Use sector=1 to search treaties instead. Always call eu_get_document_by_celex " +
                "before quoting or summarising the content.",
            inputSchema: searchLegislationSchema.shape,
        },
        async (args) => {
            const result = await runSearchLegislation(args);
            return { content: [{ type: "text", text: JSON.stringify(result) }] };
        },
    );

    server.registerTool(
        "eu_search_case_law",
        {
            description:
                "Search CJEU and General Court case law by keyword. Filter by court " +
                "(ECJ = Court of Justice, GC = General Court, any = both). Returns CELEX, " +
                "ECLI, case title, date, and links to EUR-Lex and curia.europa.eu.",
            inputSchema: searchCaseLawSchema.shape,
        },
        async (args) => {
            const result = await runSearchCaseLaw(args);
            return { content: [{ type: "text", text: JSON.stringify(result) }] };
        },
    );

    server.registerTool(
        "eu_search_treaties",
        {
            description:
                "Search EU primary law: TEU, TFEU, Charter of Fundamental Rights, " +
                "protocols, and accession acts. Returns the same shape as eu_search_legislation.",
            inputSchema: searchTreatiesSchema.shape,
        },
        async (args) => {
            const result = await runSearchTreaties(args);
            return { content: [{ type: "text", text: JSON.stringify(result) }] };
        },
    );

    server.registerTool(
        "eu_get_document_by_celex",
        {
            description:
                "Fetch the full text of an EU legal document by its CELEX number " +
                "(e.g. 32016R0679 for the GDPR, 62018CJ0311 for Schrems II). " +
                "Returns title, body text, and a EUR-Lex source URL. Use format='text' " +
                "for clean plain text, 'html' for the raw structured document.",
            inputSchema: getDocumentByCelexSchema.shape,
        },
        async (args) => {
            const result = await runGetDocumentByCelex(args);
            return { content: [{ type: "text", text: JSON.stringify(result) }] };
        },
    );

    server.registerTool(
        "eu_get_document_by_ecli",
        {
            description:
                "Fetch a CJEU/GC judgment by its ECLI (e.g. ECLI:EU:C:2020:559 for Schrems II). " +
                "Internally resolves ECLI to CELEX so the returned object carries both identifiers.",
            inputSchema: getDocumentByEcliSchema.shape,
        },
        async (args) => {
            const result = await runGetDocumentByEcli(args);
            return { content: [{ type: "text", text: JSON.stringify(result) }] };
        },
    );

    server.registerTool(
        "eu_get_document_by_eli",
        {
            description:
                "Fetch an EU act by its ELI URL (European Legislation Identifier), e.g. " +
                "http://data.europa.eu/eli/reg/2016/679/oj for the GDPR.",
            inputSchema: getDocumentByEliSchema.shape,
        },
        async (args) => {
            const result = await runGetDocumentByEli(args);
            return { content: [{ type: "text", text: JSON.stringify(result) }] };
        },
    );

    server.registerTool(
        "eu_verify_citation",
        {
            description:
                "Resolve a citation string ('Case C-403/03 Schempp', 'Regulation (EU) 2016/679', " +
                "'ECLI:EU:C:2020:559') into canonical identifiers (CELEX, ECLI, title). " +
                "Returns a confidence score; call this before relying on any user-supplied " +
                "citation, and before citing your own results.",
            inputSchema: verifyCitationSchema.shape,
        },
        async (args) => {
            const result = await runVerifyCitation(args);
            return { content: [{ type: "text", text: JSON.stringify(result) }] };
        },
    );

    return server;
}

// ---------------------------------------------------------------------------
// HTTP wrapper
// ---------------------------------------------------------------------------

export function buildApp(): express.Express {
    const app = express();
    app.use(express.json({ limit: "1mb" }));

    app.get("/health", (_req, res) => {
        res.json({ status: "ok", server: "eu-law-mcp", version: "0.1.0" });
    });

    app.post("/mcp", async (req: Request, res: Response) => {
        // Stateless: a fresh transport+server per request. Matches the
        // pattern in the MCP SDK docs for stateless HTTP deployments —
        // cheap to create and avoids cross-request state.
        const server = buildMcpServer();
        const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: undefined, // stateless mode
        });

        res.on("close", () => {
            transport.close().catch(() => undefined);
            server.close().catch(() => undefined);
        });

        try {
            await server.connect(transport);
            await transport.handleRequest(req, res, req.body);
        } catch (err) {
            console.error("[eu-law-mcp] request error:", err);
            if (!res.headersSent) {
                res.status(500).json({
                    jsonrpc: "2.0",
                    error: {
                        code: -32603,
                        message:
                            err instanceof Error ? err.message : "internal error",
                    },
                    id: null,
                });
            }
        }
    });

    // GET /mcp and DELETE /mcp are not supported in stateless mode.
    app.get("/mcp", (_req, res) => {
        res.status(405).json({
            jsonrpc: "2.0",
            error: { code: -32000, message: "GET not supported in stateless mode" },
            id: null,
        });
    });

    return app;
}

if (require.main === module) {
    const port = parseInt(process.env.PORT ?? "4040", 10);
    const app = buildApp();
    app.listen(port, () => {
        // Log a single line so deploy logs are easy to grep.
        console.log(
            JSON.stringify({
                event: "eu-law-mcp.listening",
                port,
                instance: randomUUID(),
            }),
        );
    });
}
