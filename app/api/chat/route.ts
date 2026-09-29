import { NextResponse } from "next/server";
import { z } from "zod";
import { chatSystemPrompt, extractReply, fallbackReply } from "@/lib/server/chat";
import { getCurrentUserId } from "@/lib/server/currentUser";
import { postJson } from "@/lib/server/http";
import { logAiSuggestion } from "@/lib/server/projects";

const Body = z.object({
  message: z.string().trim().min(1).max(2000),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(8000) }))
    .max(20)
    .default([]),
  projectContext: z.string().max(4000).default("No rooms added yet."),
  // Set once the project is saved; the exchange is then logged in the ai_suggestions table.
  projectId: z.number().int().positive().optional(),
});

/**
 * POST /api/chat — the AI design assistant.
 * Today it forwards to an n8n chat workflow (or answers from canned replies if none is configured).
 * Task 5 replaces the middle with the RAG pipeline: embed → ChromaDB top-K → LLM → store.
 */
export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Send { message, history?, projectContext? }." }, { status: 400 });
  }
  const { message, history, projectContext, projectId } = parsed.data;

  const webhook = process.env.N8N_CHAT_WEBHOOK_URL;
  if (webhook) {
    try {
      const data = await postJson(webhook, {
        message,
        history: [...history, { role: "user", content: message }].slice(-10),
        systemPrompt: chatSystemPrompt(projectContext),
      });
      const reply = extractReply(data);
      if (reply) {
        if (projectId) await recordSuggestion(projectId, message, reply);
        return NextResponse.json({ reply, source: "ai" });
      }
      console.error("[api/chat] webhook returned no reply text:", data);
    } catch (err) {
      console.error("[api/chat] webhook failed, using fallback:", err);
    }
  }

  return NextResponse.json({ reply: fallbackReply(message), source: "fallback" });
}

/** Logs a real AI answer (not canned fallbacks) to Postgres. Never fails the chat if the database is down. */
async function recordSuggestion(projectId: number, prompt: string, response: string) {
  if (!process.env.DATABASE_URL) return;
  try {
    await logAiSuggestion(await getCurrentUserId(), projectId, prompt, response);
  } catch (err) {
    console.error("[api/chat] couldn't log suggestion:", (err as Error).message);
  }
}
