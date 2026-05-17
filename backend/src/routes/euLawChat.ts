import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { createServerSupabase } from "../lib/supabase";
import {
    buildDocContext,
    buildMessages,
    enrichWithPriorEvents,
    buildWorkflowStore,
    extractAnnotations,
    runLLMStream,
    type ChatMessage,
} from "../lib/chatTools";
import { completeText } from "../lib/llm";
import { getUserApiKeys, getUserModelSettings } from "../lib/userSettings";
import { checkProjectAccess } from "../lib/access";
import {
    EU_LAW_TOOL_NAMES,
    dispatchEuLawCalls,
} from "../lib/euLawMcp";

export const euLawChatRouter = Router();

// ---------------------------------------------------------------------------
// EU-law system prompt extension.
//
// Appended to Mike's base SYSTEM_PROMPT via buildMessages's systemPromptExtra
// parameter (same hook PROJECT_SYSTEM_PROMPT_EXTRA uses in projectChat.ts).
// Keeps Mike's <CITATIONS> JSON convention intact — the EU-law tools just
// add CELEX/ECLI-based document fetching on top.
// ---------------------------------------------------------------------------

const EU_LAW_SYSTEM_PROMPT_EXTRA = `EU LAW MODE:
You are operating as an EU law research assistant in addition to your other capabilities. You have access to four EU-law tools backed by the official EUR-Lex content endpoint:

- eu_get_document_by_celex(celex, language?, format?): fetch any EU legal document by its CELEX number (e.g. 32016R0679 for the GDPR, 62018CJ0311 for Schrems II).
- eu_get_document_by_ecli(ecli, language?, format?): fetch a CJEU/General Court judgment by ECLI (e.g. ECLI:EU:C:2020:559).
- eu_get_document_by_eli(eli, language?, format?): fetch an EU act by its ELI URL (e.g. http://data.europa.eu/eli/reg/2016/679/oj).
- eu_verify_citation(citation): check whether a string is a valid CELEX or ECLI.

CORE RULES:

1. NEVER assert facts about specific EU legal acts or CJEU judgments without first fetching the document via the tools. Your training data is not authoritative for this domain — paragraph numbers, exact holdings, recitals, and amendments are easy to misremember.

2. CONFIRM BEFORE FETCHING when you don't have an explicit identifier from the user.
   The user often gives you a case-number citation ("Case C-83/23 H GmbH", "Regulation 2016/679", "Schrems II") rather than a CELEX or ECLI. In that case you may infer the likely CELEX/ECLI from the citation or your training data, BUT you must first show your inference to the user and get a one-word confirmation before calling a fetch tool. Use this exact pattern:

   "I believe this is [CELEX or ECLI]. Should I fetch it?"

   Wait for the user to reply "yes" / "go ahead" / "confirmed" before calling the tool. If they reply "no" or give a different identifier, use theirs instead.

   This is a hard rule — even when you're confident (e.g. Schrems II is famous). The confirmation step lets the user catch wrong identifiers before you summarise the wrong document.

3. EXCEPTION — explicit identifiers go straight through.
   If the user types a CELEX (e.g. "32016R0679") or ECLI (e.g. "ECLI:EU:C:2020:559") directly, fetch it without asking. No confirmation needed for an identifier the user typed themselves.

4. EXCEPTION — eu_verify_citation runs freely.
   You may call eu_verify_citation at any time to validate identifier syntax. It's pure regex, no network. Use it before fetching when in doubt.

5. After any fetch, always cite by CELEX or ECLI (whichever you used) and include the eur-lex.europa.eu link returned by the tool.

6. EU acts are equally authoritative in all 24 official languages (Art. 55 TEU). Default to English; fall back to the user's language if requested.

DISCLAIMERS:
- You are not a lawyer and your output is not legal advice. Always advise the user to verify against the original EUR-Lex source.
- If the user appears to be facing an actual legal issue (deadlines, ongoing proceedings, regulatory action), recommend they consult a qualified EU lawyer.`;

// ---------------------------------------------------------------------------
// EU-law tool schemas in OpenAI format.
//
// Hand-written rather than fetched via tools/list from the MCP server — we
// own both ends, so the round-trip would be pure overhead. These four
// schemas mirror exactly what the MCP server in backend/mcp-servers/eu-law
// exposes; if you change a tool's input there, change the matching schema
// here.
// ---------------------------------------------------------------------------

const EU_LANG_ENUM = [
    "bg", "cs", "da", "de", "el", "en", "es", "et", "fi", "fr",
    "ga", "hr", "hu", "it", "lt", "lv", "mt", "nl", "pl", "pt",
    "ro", "sk", "sl", "sv",
];

const EU_LAW_EXTRA_TOOLS = [
    {
        type: "function",
        function: {
            name: "eu_get_document_by_celex",
            description:
                "Fetch the full text of an EU legal document by its CELEX number (e.g. 32016R0679 for the GDPR, 62018CJ0311 for Schrems II). Returns the title, body text, and a eur-lex.europa.eu source URL.",
            parameters: {
                type: "object",
                properties: {
                    celex: {
                        type: "string",
                        description:
                            "CELEX identifier (e.g. '32016R0679' or '62018CJ0311'). Must match the regex /^[1-9CE]\\d{4}[A-Z]{1,2}\\d{4}$/.",
                    },
                    language: {
                        type: "string",
                        enum: EU_LANG_ENUM,
                        description:
                            "Two-letter ISO 639-1 language code. Defaults to 'en'.",
                    },
                    format: {
                        type: "string",
                        enum: ["html", "text"],
                        description:
                            "'text' (default) returns clean plain text; 'html' returns the structured document.",
                    },
                },
                required: ["celex"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "eu_get_document_by_ecli",
            description:
                "Fetch a CJEU or General Court judgment by its ECLI (e.g. ECLI:EU:C:2020:559 for Schrems II). Returns the title, body text, and a eur-lex.europa.eu source URL.",
            parameters: {
                type: "object",
                properties: {
                    ecli: {
                        type: "string",
                        description:
                            "ECLI identifier (e.g. 'ECLI:EU:C:2020:559').",
                    },
                    language: {
                        type: "string",
                        enum: EU_LANG_ENUM,
                    },
                    format: {
                        type: "string",
                        enum: ["html", "text"],
                    },
                },
                required: ["ecli"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "eu_get_document_by_eli",
            description:
                "Fetch an EU act by its ELI URL (European Legislation Identifier), e.g. http://data.europa.eu/eli/reg/2016/679/oj for the GDPR.",
            parameters: {
                type: "object",
                properties: {
                    eli: {
                        type: "string",
                        description:
                            "ELI URL (e.g. 'http://data.europa.eu/eli/reg/2016/679/oj').",
                    },
                    language: {
                        type: "string",
                        enum: EU_LANG_ENUM,
                    },
                    format: {
                        type: "string",
                        enum: ["html", "text"],
                    },
                },
                required: ["eli"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "eu_verify_citation",
            description:
                "Check whether a citation string is a valid CELEX number or ECLI. Returns canonical identifiers and a confidence score. Does NOT resolve free-text citations like 'Case C-403/03' — call the document fetch tools directly with a known CELEX/ECLI instead.",
            parameters: {
                type: "object",
                properties: {
                    citation: {
                        type: "string",
                        description:
                            "The citation string to verify (e.g. '32016R0679', 'ECLI:EU:C:2020:559').",
                    },
                },
                required: ["citation"],
            },
        },
    },
];

type Db = ReturnType<typeof createServerSupabase>;
const isDev = process.env.NODE_ENV !== "production";
const devLog = (...args: Parameters<typeof console.log>) => {
    if (isDev) console.log(...args);
};

type AccessibleChat = {
    id: string;
    title: string | null;
    user_id: string;
    project_id: string | null;
} & Record<string, unknown>;

function parseOptionalProjectId(value: unknown):
    | { ok: true; provided: boolean; projectId: string | null }
    | { ok: false; detail: string } {
    if (value === undefined)
        return { ok: true, provided: false, projectId: null };
    if (value === null) return { ok: true, provided: true, projectId: null };
    if (typeof value !== "string" || !value.trim()) {
        return {
            ok: false,
            detail: "project_id must be a non-empty string or null",
        };
    }
    return { ok: true, provided: true, projectId: value.trim() };
}

function parseOptionalChatId(value: unknown):
    | { ok: true; chatId: string | null }
    | { ok: false; detail: string } {
    if (value === undefined || value === null) return { ok: true, chatId: null };
    if (typeof value !== "string" || !value.trim()) {
        return { ok: false, detail: "chat_id must be a non-empty string" };
    }
    return { ok: true, chatId: value.trim() };
}

function parseChatMessages(value: unknown):
    | { ok: true; messages: ChatMessage[] }
    | { ok: false; detail: string } {
    if (!Array.isArray(value) || value.length === 0) {
        return { ok: false, detail: "messages must be a non-empty array" };
    }

    for (const message of value) {
        if (!message || typeof message !== "object" || Array.isArray(message)) {
            return { ok: false, detail: "messages must contain objects" };
        }
        const row = message as Record<string, unknown>;
        if (typeof row.role !== "string") {
            return { ok: false, detail: "message.role must be a string" };
        }
        if (row.content !== null && typeof row.content !== "string") {
            return {
                ok: false,
                detail: "message.content must be a string or null",
            };
        }
    }

    return { ok: true, messages: value as ChatMessage[] };
}

function parseOptionalModel(value: unknown):
    | { ok: true; model: string | undefined }
    | { ok: false; detail: string } {
    if (value === undefined) return { ok: true, model: undefined };
    if (typeof value !== "string" || !value.trim()) {
        return { ok: false, detail: "model must be a non-empty string" };
    }
    return { ok: true, model: value.trim() };
}

async function validateAccessibleProjectId(
    projectId: string | null,
    userId: string,
    userEmail: string | null | undefined,
    db: Db,
): Promise<{ ok: true } | { ok: false; status: number; detail: string }> {
    if (!projectId) return { ok: true };
    const access = await checkProjectAccess(projectId, userId, userEmail, db);
    if (!access.ok)
        return { ok: false, status: 404, detail: "Project not found" };
    return { ok: true };
}

async function getAccessibleChat(
    chatId: string,
    userId: string,
    userEmail: string | null | undefined,
    db: Db,
): Promise<AccessibleChat | null> {
    const { data: chat, error } = await db
        .from("chats")
        .select("*")
        .eq("id", chatId)
        .maybeSingle();
    if (error || !chat) return null;

    const row = chat as AccessibleChat;
    if (row.user_id === userId) return row;

    if (row.project_id) {
        const access = await checkProjectAccess(
            row.project_id,
            userId,
            userEmail,
            db,
        );
        if (access.ok) return row;
    }

    return null;
}

// GET /chat
// Visible chats = the user's own chats + every chat under a project the
// user owns (so a project owner sees all collaborator chats in their
// own projects in the global recent-chats list). Chats in projects that
// are merely *shared with* the user are NOT included here — those are
// listed per-project via GET /projects/:projectId/chats.
euLawChatRouter.get("/", requireAuth, async (req, res) => {
    const userId = res.locals.userId as string;
    const db = createServerSupabase();

    const { data: ownProjects, error: projErr } = await db
        .from("projects")
        .select("id")
        .eq("user_id", userId);
    if (projErr) return void res.status(500).json({ detail: projErr.message });
    const ownProjectIds = ((ownProjects ?? []) as { id: string }[]).map(
        (p) => p.id,
    );

    const filter =
        ownProjectIds.length > 0
            ? `user_id.eq.${userId},project_id.in.(${ownProjectIds.join(",")})`
            : `user_id.eq.${userId}`;

    const { data, error } = await db
        .from("chats")
        .select("*")
        .or(filter)
        .order("created_at", { ascending: false });
    if (error) return void res.status(500).json({ detail: error.message });
    res.json(data ?? []);
});

// POST /chat/create
euLawChatRouter.post("/create", requireAuth, async (req, res) => {
    const userId = res.locals.userId as string;
    const userEmail = res.locals.userEmail as string | undefined;
    const parsedProjectId = parseOptionalProjectId(req.body?.project_id);
    if (!parsedProjectId.ok) {
        return void res.status(400).json({ detail: parsedProjectId.detail });
    }
    const projectId = parsedProjectId.projectId;
    const db = createServerSupabase();
    const projectAccess = await validateAccessibleProjectId(
        projectId,
        userId,
        userEmail,
        db,
    );
    if (!projectAccess.ok)
        return void res
            .status(projectAccess.status)
            .json({ detail: projectAccess.detail });

    const { data, error } = await db
        .from("chats")
        .insert({ user_id: userId, project_id: projectId ?? null })
        .select("id")
        .single();

    if (error) return void res.status(500).json({ detail: error.message });
    res.json({ id: data.id });
});

// GET /chat/:chatId
euLawChatRouter.get("/:chatId", requireAuth, async (req, res) => {
    const userId = res.locals.userId as string;
    const userEmail = res.locals.userEmail as string | undefined;
    const { chatId } = req.params;
    const db = createServerSupabase();

    const chat = await getAccessibleChat(chatId, userId, userEmail, db);
    if (!chat)
        return void res.status(404).json({ detail: "Chat not found" });

    const { data: messages } = await db
        .from("chat_messages")
        .select("*")
        .eq("chat_id", chatId)
        .order("created_at", { ascending: true });

    const hydrated = await hydrateEditStatuses(messages ?? [], db);
    res.json({ chat, messages: hydrated });
});

// Stored message annotations/events capture the `status` at the time the
// assistant produced the edit (always "pending"). If the user later accepts
// or rejects, `document_edits.status` is updated but the stored message
// annotation is not. On chat load we merge the current DB status in so
// EditCards render with the real state.
async function hydrateEditStatuses(
    messages: Record<string, unknown>[],
    db: ReturnType<typeof createServerSupabase>,
): Promise<Record<string, unknown>[]> {
    const editIds = new Set<string>();
    const versionIds = new Set<string>();
    const collectFromAnnList = (list: unknown) => {
        if (!Array.isArray(list)) return;
        for (const a of list as Record<string, unknown>[]) {
            if (typeof a?.edit_id === "string") editIds.add(a.edit_id);
            if (typeof a?.version_id === "string")
                versionIds.add(a.version_id);
        }
    };
    for (const m of messages) {
        collectFromAnnList(m.annotations);
        const content = m.content;
        if (Array.isArray(content)) {
            for (const ev of content as Record<string, unknown>[]) {
                if (ev?.type === "doc_edited") {
                    collectFromAnnList(ev.annotations);
                    if (typeof ev.version_id === "string")
                        versionIds.add(ev.version_id);
                }
            }
        }
    }
    if (editIds.size === 0 && versionIds.size === 0) return messages;

    // Edit status patch.
    const statusById = new Map<string, "pending" | "accepted" | "rejected">();
    if (editIds.size > 0) {
        const { data: rows } = await db
            .from("document_edits")
            .select("id, status")
            .in("id", Array.from(editIds));
        for (const r of (rows ?? []) as { id: string; status: string }[]) {
            if (
                r.status === "pending" ||
                r.status === "accepted" ||
                r.status === "rejected"
            ) {
                statusById.set(r.id, r.status);
            }
        }
    }

    // Version-number patch — old stored events don't carry `version_number`
    // because they predate the schema change. Look it up from
    // document_versions so the UI can render "V3" chips + download filenames.
    const versionNumberById = new Map<string, number | null>();
    if (versionIds.size > 0) {
        const { data: vrows } = await db
            .from("document_versions")
            .select("id, version_number")
            .in("id", Array.from(versionIds));
        for (const r of (vrows ?? []) as {
            id: string;
            version_number: number | null;
        }[]) {
            versionNumberById.set(r.id, r.version_number ?? null);
        }
    }

    const patchAnnList = (list: unknown): unknown => {
        if (!Array.isArray(list)) return list;
        return (list as Record<string, unknown>[]).map((a) => {
            let next = a;
            if (typeof a?.edit_id === "string" && statusById.has(a.edit_id)) {
                next = { ...next, status: statusById.get(a.edit_id) };
            }
            if (
                typeof a?.version_id === "string" &&
                versionNumberById.has(a.version_id)
            ) {
                next = {
                    ...next,
                    version_number: versionNumberById.get(a.version_id) ?? null,
                };
            }
            return next;
        });
    };
    return messages.map((m) => {
        const next: Record<string, unknown> = { ...m };
        next.annotations = patchAnnList(m.annotations);
        if (Array.isArray(m.content)) {
            next.content = (m.content as Record<string, unknown>[]).map(
                (ev) => {
                    if (ev?.type !== "doc_edited") return ev;
                    let patched: Record<string, unknown> = {
                        ...ev,
                        annotations: patchAnnList(ev.annotations),
                    };
                    if (
                        typeof ev.version_id === "string" &&
                        versionNumberById.has(ev.version_id)
                    ) {
                        patched = {
                            ...patched,
                            version_number:
                                versionNumberById.get(ev.version_id) ?? null,
                        };
                    }
                    return patched;
                },
            );
        }
        return next;
    });
}

// PATCH /chat/:chatId
euLawChatRouter.patch("/:chatId", requireAuth, async (req, res) => {
    const userId = res.locals.userId as string;
    const { chatId } = req.params;
    const title = (req.body.title ?? "").trim();
    if (!title)
        return void res.status(400).json({ detail: "title is required" });

    const db = createServerSupabase();
    const { data, error } = await db
        .from("chats")
        .update({ title })
        .eq("id", chatId)
        .eq("user_id", userId)
        .select("id, title")
        .single();

    if (error || !data)
        return void res.status(404).json({ detail: "Chat not found" });
    res.json(data);
});

// DELETE /chat/:chatId
euLawChatRouter.delete("/:chatId", requireAuth, async (req, res) => {
    const userId = res.locals.userId as string;
    const { chatId } = req.params;
    const db = createServerSupabase();
    const { error } = await db
        .from("chats")
        .delete()
        .eq("id", chatId)
        .eq("user_id", userId);

    if (error) return void res.status(500).json({ detail: error.message });
    res.status(204).send();
});

// POST /chat/:chatId/generate-title
euLawChatRouter.post("/:chatId/generate-title", requireAuth, async (req, res) => {
    const userId = res.locals.userId as string;
    const userEmail = res.locals.userEmail as string | undefined;
    const { chatId } = req.params;
    const message =
        typeof req.body?.message === "string" ? req.body.message.trim() : "";
    if (!message)
        return void res.status(400).json({ detail: "message is required" });

    const db = createServerSupabase();
    const chat = await getAccessibleChat(chatId, userId, userEmail, db);
    if (!chat)
        return void res.status(404).json({ detail: "Chat not found" });

    try {
        const { title_model, api_keys } = await getUserModelSettings(
            userId,
            db,
        );
        const titleText = await completeText({
            model: title_model,
            user: `Generate a concise title (3–6 words) for a chat in an AI Legal Platform that starts with this message. The title should describe the topic or document — do NOT include words like "Legal Assistant", "AI", "Chat", or any similar prefix. Return only the title, no quotes or punctuation.\n\nMessage: ${message.slice(0, 500)}`,
            maxTokens: 64,
            apiKeys: api_keys,
        });
        const title = titleText.trim() || message.slice(0, 60);

        await db
            .from("chats")
            .update({ title })
            .eq("id", chatId);

        res.json({ title });
    } catch (err) {
        console.error("[generate-title]", err);
        res.status(500).json({ detail: "Failed to generate title" });
    }
});

// POST /chat — streaming
euLawChatRouter.post("/", requireAuth, async (req, res) => {
    const userId = res.locals.userId as string;
    const body =
        req.body && typeof req.body === "object" && !Array.isArray(req.body)
            ? (req.body as Record<string, unknown>)
            : {};
    const parsedMessages = parseChatMessages(body.messages);
    if (!parsedMessages.ok) {
        return void res.status(400).json({ detail: parsedMessages.detail });
    }
    const parsedChatId = parseOptionalChatId(body.chat_id);
    if (!parsedChatId.ok) {
        return void res.status(400).json({ detail: parsedChatId.detail });
    }
    const parsedProjectId = parseOptionalProjectId(body.project_id);
    if (!parsedProjectId.ok) {
        return void res.status(400).json({ detail: parsedProjectId.detail });
    }
    const parsedModel = parseOptionalModel(body.model);
    if (!parsedModel.ok) {
        return void res.status(400).json({ detail: parsedModel.detail });
    }

    const messages = parsedMessages.messages;
    const chat_id = parsedChatId.chatId;
    const project_id = parsedProjectId.projectId;
    const model = parsedModel.model;

    devLog("[chat/stream] incoming request", {
        userId,
        chat_id,
        project_id,
        model,
        messageCount: messages?.length,
    });

    const userEmail = res.locals.userEmail as string | undefined;
    const db = createServerSupabase();
    let chatId = chat_id ?? null;
    let chatTitle: string | null = null;
    let resolvedProjectId: string | null = parsedProjectId.projectId;

    if (chatId) {
        const existing = await getAccessibleChat(chatId, userId, userEmail, db);
        if (!existing)
            return void res.status(404).json({ detail: "Chat not found" });

        const existingProjectId = existing.project_id ?? null;
        if (
            parsedProjectId.provided &&
            parsedProjectId.projectId !== existingProjectId
        ) {
            return void res
                .status(400)
                .json({ detail: "project_id does not match chat" });
        }
        resolvedProjectId = existingProjectId;
        chatTitle = existing.title;
    }

    if (!chatId) {
        // If creating a chat tied to a project, the user must have access
        // to the project (own or shared).
        const projectAccess = await validateAccessibleProjectId(
            resolvedProjectId,
            userId,
            userEmail,
            db,
        );
        if (!projectAccess.ok)
            return void res
                .status(projectAccess.status)
                .json({ detail: projectAccess.detail });

        const { data: newChat, error } = await db
            .from("chats")
            .insert({ user_id: userId, project_id: resolvedProjectId })
            .select("id, title")
            .single();
        if (error || !newChat) {
            console.error("[chat/stream] failed to create chat", error);
            return void res
                .status(500)
                .json({ detail: "Failed to create chat" });
        }
        chatId = newChat.id as string;
        chatTitle = newChat.title;
    }

    devLog("[chat/stream] resolved chatId", chatId);

    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    if (lastUser) {
        await db.from("chat_messages").insert({
            chat_id: chatId,
            role: "user",
            content: lastUser.content,
            files: lastUser.files ?? null,
            workflow: lastUser.workflow ?? null,
        });
    }

    const { docIndex, docStore } = await buildDocContext(
        messages,
        userId,
        db,
        chatId,
    );
    const docAvailability = Object.entries(docIndex).map(([doc_id, info]) => ({
        doc_id,
        filename: info.filename,
    }));
    const enrichedMessages = await enrichWithPriorEvents(
        messages,
        chatId,
        db,
        docIndex,
    );
    const apiMessages = buildMessages(
        enrichedMessages,
        docAvailability,
        EU_LAW_SYSTEM_PROMPT_EXTRA,
    );

    const workflowStore = await buildWorkflowStore(userId, userEmail, db);

    devLog("[chat/stream] starting LLM stream", {
        apiMessageCount: apiMessages.length,
        docCount: Object.keys(docIndex).length,
        workflowCount: Object.keys(workflowStore).length,
    });

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    const write = (line: string) => res.write(line);

    const apiKeys = await getUserApiKeys(userId, db);

    try {
        write(`data: ${JSON.stringify({ type: "chat_id", chatId })}\n\n`);

        const { fullText, events } = await runLLMStream({
            apiMessages,
            docStore,
            docIndex,
            userId,
            db,
            write,
            extraTools: EU_LAW_EXTRA_TOOLS,
            mcpTools: {
                names: EU_LAW_TOOL_NAMES as unknown as string[],
                dispatch: dispatchEuLawCalls,
            },
            workflowStore,
            model,
            apiKeys,
            projectId: resolvedProjectId,
        });

        devLog("[chat/stream] LLM stream finished", {
            fullTextLen: fullText?.length ?? 0,
            eventCount: events?.length ?? 0,
        });

        const annotations = extractAnnotations(fullText, docIndex, events);
        await db.from("chat_messages").insert({
            chat_id: chatId,
            role: "assistant",
            content: events.length ? events : null,
            annotations: annotations.length ? annotations : null,
        });

        if (!chatTitle && lastUser?.content) {
            await db
                .from("chats")
                .update({ title: lastUser.content.slice(0, 120) })
                .eq("id", chatId);
        }
    } catch (err) {
        console.error("[chat/stream] error:", err);
        try {
            write(
                `data: ${JSON.stringify({ type: "error", message: "Stream error" })}\n\n`,
            );
            write("data: [DONE]\n\n");
        } catch {
            /* ignore */
        }
    } finally {
        res.end();
    }
});
