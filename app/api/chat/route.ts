import { NextResponse } from "next/server";
import { z } from "zod";
import { chatSystemPrompt, extractReply, fallbackReply } from "@/lib/server/chat";
import { postJson } from "@/lib/server/http";

const Body = z.object({
  message: z.string().trim().min(1).max(2000),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(8000) }))
    .max(20)
    .default([]),
  projectContext: z.string().max(4000).default("No rooms added yet."),
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
  const { message, history, projectContext } = parsed.data;

  const webhook = process.env.N8N_CHAT_WEBHOOK_URL;
  if (webhook) {
    try {
      const data = await postJson(webhook, {
        message,
        history: [...history, { role: "user", content: message }].slice(-10),
        systemPrompt: chatSystemPrompt(projectContext),
      });
      const reply = extractReply(data);
      if (reply) return NextResponse.json({ reply, source: "ai" });
      console.error("[api/chat] webhook returned no reply text:", data);
    } catch (err) {
      console.error("[api/chat] webhook failed, using fallback:", err);
    }
  }

  return NextResponse.json({ reply: fallbackReply(message), source: "fallback" });
}
