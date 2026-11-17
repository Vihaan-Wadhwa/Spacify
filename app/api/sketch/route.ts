import { NextResponse } from "next/server";
import { z } from "zod";
import { SketchSetupError, analyzeSketchWithGemini } from "@/lib/server/gemini";
import { postJson } from "@/lib/server/http";
import { parseSketchRooms } from "@/lib/server/sketch";

// A vision model can take a while on a busy sketch; let the route run long enough on hosts that cap execution time.
export const maxDuration = 120;

const Body = z.object({
  image: z.string().min(100).max(8_000_000), // base64, already compressed in the browser
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  // Pixel size of the image, to turn Gemini's 0–1000 coordinates back into pixels. Square if an older page leaves it out.
  width: z.number().int().positive().max(10_000).default(1000),
  height: z.number().int().positive().max(10_000).default(1000),
});

type Provider = "gemini" | "n8n";

/**
 * POST /api/sketch — reads a floor-plan sketch and returns validated rooms.
 * SKETCH_PROVIDER picks the model: "gemini" (Gemini API, the default) or "n8n" (hosted workflow).
 */
export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Send { image: <base64>, mimeType } with a JPG, PNG or WebP image." }, { status: 400 });
  }

  const provider: Provider = process.env.SKETCH_PROVIDER === "n8n" ? "n8n" : "gemini";
  const started = Date.now();
  const { image, mimeType, width, height } = parsed.data;

  let data: unknown;
  try {
    if (provider === "gemini") {
      data = await analyzeSketchWithGemini(image, mimeType, { width, height });
    } else {
      const webhook = process.env.N8N_SKETCH_WEBHOOK_URL;
      if (!webhook) {
        return NextResponse.json({ error: "SKETCH_PROVIDER is n8n but N8N_SKETCH_WEBHOOK_URL is missing." }, { status: 503 });
      }
      data = await postJson(webhook, { image, mimeType });
    }
  } catch (err) {
    console.error(`[api/sketch] ${provider} failed:`, err);
    if (err instanceof SketchSetupError) return NextResponse.json({ error: err.message }, { status: 503 });
    return NextResponse.json({ error: "The sketch analyser didn't respond. Try again, or add rooms manually." }, { status: 502 });
  }

  const rooms = parseSketchRooms(data);
  console.info(`[api/sketch] ${provider}: ${rooms.length} rooms in ${Date.now() - started} ms`);
  if (!rooms.length) {
    return NextResponse.json({ error: "Could not detect rooms. Try a clearer sketch or add rooms manually." }, { status: 422 });
  }
  return NextResponse.json({ rooms, provider });
}
