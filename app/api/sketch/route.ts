import { NextResponse } from "next/server";
import { z } from "zod";
import { postJson } from "@/lib/server/http";
import { parseSketchRooms } from "@/lib/server/sketch";

const Body = z.object({
  image: z.string().min(100).max(8_000_000), // base64, already compressed in the browser
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
});

/**
 * POST /api/sketch — sends a floor-plan sketch to the n8n → Gemini workflow and returns validated rooms.
 * Runs on the server, so the webhook URL stays private and no CORS proxy is needed.
 */
export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Send { image: <base64>, mimeType } with a JPG, PNG or WebP image." }, { status: 400 });
  }

  const webhook = process.env.N8N_SKETCH_WEBHOOK_URL;
  if (!webhook) {
    return NextResponse.json(
      { error: "Sketch recognition isn't configured yet (N8N_SKETCH_WEBHOOK_URL is missing). Add rooms manually for now." },
      { status: 503 }
    );
  }

  let data: unknown;
  try {
    data = await postJson(webhook, parsed.data);
  } catch (err) {
    console.error("[api/sketch] webhook failed:", err);
    return NextResponse.json({ error: "The sketch analyser didn't respond. Try again, or add rooms manually." }, { status: 502 });
  }

  const rooms = parseSketchRooms(data);
  if (!rooms.length) {
    return NextResponse.json({ error: "Could not detect rooms. Try a clearer sketch or add rooms manually." }, { status: 422 });
  }
  return NextResponse.json({ rooms });
}
