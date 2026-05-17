# EU-Mike

EU-Mike is an AI-powered EU law research assistant. It is a fork of [Mike](https://github.com/willchen96/mike) by [Will Chen](https://github.com/willchen96), extended with live EU law document lookup via the official [EUR-Lex](https://eur-lex.europa.eu/) endpoint.

When you ask about an EU regulation or a CJEU judgment, EU-Mike fetches the actual text from EUR-Lex, summarises from the source, and cites back to the original document. No paid legal database subscription required.

Created by Lucian Schwartz-Croft.

## What this fork adds

Mike is a legal document assistant: upload contracts and legal documents, ask questions, get cited answers. EU-Mike keeps all of that and adds four EU-law tools:

| Tool | What it does |
|---|---|
| `eu_get_document_by_celex` | Fetch any EU legal document by CELEX number (e.g. `32016R0679` for the GDPR) |
| `eu_get_document_by_ecli` | Fetch a CJEU/General Court judgment by ECLI (e.g. `ECLI:EU:C:2020:559` for Schrems II) |
| `eu_get_document_by_eli` | Fetch an EU act by its ELI URL |
| `eu_verify_citation` | Check whether a string is a valid CELEX or ECLI |

All 24 official EU languages are supported. The tools are backed by the public EUR-Lex content endpoint — no API key, no credentials, free.

The tools run as a standalone MCP server (Model Context Protocol) in a separate process. A new `/eu-law-chat` endpoint on Mike's backend wires the tools into the chat with a system prompt that instructs the LLM to fetch documents before making assertions about EU law.

All existing Mike features (document chat, projects, tabular review, workflows) are unchanged.

## Contents

- `frontend/` — Next.js application
- `backend/` — Express API, Supabase access, document processing, and database schema
- `backend/schema.sql` — Supabase schema for fresh databases
- `backend/migrations/` — incremental database updates for existing deployments
- `backend/mcp-servers/eu-law/` — standalone EU-law MCP server (new in this fork)
- `backend/src/lib/euLawMcp.ts` — MCP HTTP client (new in this fork)
- `backend/src/routes/euLawChat.ts` — `/eu-law-chat` endpoint (new in this fork)

## Prerequisites

- Node.js 20 or newer
- npm
- git
- A Supabase project
- At least one supported model provider API key: Anthropic, Google Gemini, or OpenAI
- LibreOffice installed locally if you need DOC/DOCX to PDF conversion

Cloudflare R2 or another S3-compatible bucket is optional — needed only if you use Mike's document upload features.

## Database Setup

For a new Supabase database, open the Supabase SQL editor and run:

```sql
-- copy and run the contents of:
-- backend/schema.sql
```

The schema file is based on `supabase-migration.sql` and folds in the later files in `backend/migrations/`.

For an existing database, do not run the full schema file over production data. Apply the incremental files in `backend/migrations/` instead.

The EU-law tools do not add any database tables or columns. The schema is identical to upstream Mike.

## Environment

Create local env files:

```bash
touch backend/.env
touch frontend/.env.local
```

Create `backend/.env`:

```bash
PORT=3001
FRONTEND_URL=http://localhost:3000
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SECRET_KEY=your-supabase-service-role-key
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY=your-supabase-anon-key

ANTHROPIC_API_KEY=your-anthropic-key

# EU Law MCP server (running locally on port 4040)
EU_LAW_MCP_URL=http://localhost:4040/mcp

NODE_ENV=development
```

Create `frontend/.env.local`:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY=your-supabase-anon-key
NEXT_PUBLIC_API_URL=http://localhost:3001
```

Supabase values come from the project dashboard. Use the project URL for `SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_URL`, the service role key for the backend `SUPABASE_SECRET_KEY`, and the anon/public key for `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY`. If your Supabase project shows multiple key formats, use the legacy JWT-style anon and service role keys expected by the Supabase client libraries.

Provider keys are only needed for the models you plan to use. Model provider keys can be configured in `backend/.env` for the whole instance, or per user in **Account > Models & API Keys**.

## Install

Install each package:

```bash
npm install --prefix backend
npm install --prefix backend/mcp-servers/eu-law
npm install --prefix frontend
```

## Run Locally

EU-Mike requires three processes. Start them in this order:

**1. EU-law MCP server** (must start first — the backend connects to it):

```bash
cd backend/mcp-servers/eu-law
npm start
```

Wait for `{"event":"eu-law-mcp.listening","port":4040,...}`.

**2. Backend:**

```bash
npm run dev --prefix backend
```

Wait for `Mike backend running on port 3001`.

**3. Frontend:**

```bash
npm run dev --prefix frontend
```

Open `http://localhost:3000`.

## First Run

1. Sign up in the app.
2. If you did not set provider keys in `backend/.env`, open **Account > Models & API Keys** and add an Anthropic, Gemini, or OpenAI API key.
3. Start a chat and try: **"Fetch the text of the GDPR using CELEX 32016R0679 and tell me what Article 17 says."**

The LLM should call `eu_get_document_by_celex`, fetch the actual GDPR text from EUR-Lex, and cite the source URL in its response.

For case law, try: **"What did the CJEU hold in Schrems II? The ECLI is ECLI:EU:C:2020:559."**

When the user provides a case name without an identifier (e.g. "Tell me about Case C-83/23"), the LLM will show its inferred CELEX/ECLI and ask the user to confirm before fetching.

## Limitations

- **No keyword search.** The original build plan included SPARQL-based search across the EU legal corpus via CELLAR. This was built and tested but the live CELLAR SPARQL endpoint returned zero results for the CDM property names in the official documentation. The search tools were scrapped. Users must provide a CELEX, ECLI, or ELI identifier — or look one up at [eur-lex.europa.eu](https://eur-lex.europa.eu/).
- **Pre-1990s CJEU cases** may not be available on EUR-Lex in HTML format.
- **Not legal advice.** The system prompt includes disclaimers, but this is a research tool, not a substitute for qualified legal counsel.

## Troubleshooting

**Sign-up confirmation email never arrives.** Confirmation emails are sent by Supabase Auth, not by Mike. For local development, the simplest fix is to disable email confirmation in **Supabase > Authentication > Providers > Email**. For production, configure custom SMTP in Supabase; the built-in mailer is heavily rate-limited and may be restricted on newer projects.

**The model picker shows a missing-key warning.** Add a key for that provider in **Account > Models & API Keys**, or configure the provider key in `backend/.env` and restart the backend.

**DOC or DOCX conversion fails.** Install LibreOffice locally and restart the backend so document conversion commands are available on the process path.

**EU-law tools return errors.** Check that the MCP server is running on port 4040 (`npm start` in `backend/mcp-servers/eu-law/`). Check that `EU_LAW_MCP_URL=http://localhost:4040/mcp` is set in `backend/.env`. The MCP server logs to stdout — look for errors there.

**TypeScript build fails with heap out of memory.** The MCP server's `package.json` already sets `--max-old-space-size=6144` in the build script. If the backend build also runs out of memory, prefix the command: `NODE_OPTIONS="--max-old-space-size=6144" npm run build --prefix backend`.

## Useful Checks

```bash
npm run build --prefix backend
npm run build --prefix backend/mcp-servers/eu-law
npm test --prefix backend/mcp-servers/eu-law
npm run build --prefix frontend
npm run lint --prefix frontend
```

## Credits

This project is a fork of [Mike](https://github.com/willchen96/mike) by [Will Chen](https://github.com/willchen96), released under [AGPL-3.0](LICENSE). Mike is the foundation — the frontend, backend, chat engine, document processing, project management, tabular review, and workflow system are all Will Chen's work. EU-Mike adds the EU-law MCP server and integration layer on top.

## License

[AGPL-3.0](LICENSE), same as upstream Mike.
