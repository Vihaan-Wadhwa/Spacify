import "server-only";

/**
 * Sketch recognition with Google's Gemini API (vision). Needs GEMINI_API_KEY in .env.local
 * (create one at https://aistudio.google.com/apikey). The key stays on the server.
 */

export const GEMINI_DEFAULTS = {
  // Reads a typical sketch in about 10 s with minimal thinking; reading room labels and boxes needs no long reasoning.
  model: "gemini-3.5-flash",
  timeoutMs: 90_000,
};

/** A problem the user can fix (no API key, bad key, quota). The message is shown in the UI. */
export class SketchSetupError extends Error {}

const SKETCH_PROMPT = `You are reading a floor plan sketch (hand-drawn or digital) of an Indian home.
Find every enclosed, labelled room and return them as JSON matching the given schema.

For each room:
- "label": the text written in the room, exactly as written (e.g. "MB").
- "name": the room's full name. Expand short labels:
  MB → Master Bedroom, B2 → Bedroom 2, B3 → Bedroom 3 (if bedrooms are numbered from B1, B1 → Bedroom 2 and B2 → Bedroom 3),
  Drg or Drawing → Drawing Room, LR → Living Room, Din or DR → Dining Room, K → Kitchen,
  Bath, T or Toilet → Bathroom, WIC → Walk-in Closet, PR, Puja or Pooja → Pooja Room, St → Study,
  Bal → Balcony, Store → Store, Stair → Staircase.
  Any other room (an office, gaming room, gym, guest room, library, laundry, passage…): use the name written on the sketch,
  in Title Case, without a leading "O" or "Other" ("O Office" → "Office", "Gaming Room" → "Gaming Room").
  If the label is only "O" or "Other", the name is "Other".
  If a label is unreadable, use the closest room type from these lists.
- "w" and "l": the dimensions written in the room, in FEET, in the order written ("14x13" or "14'×13'" → w 14, l 13).
  If no dimensions are written in that room, use 0 for both. Do not guess.
- "point": [y, x], the centre of the room's label text, normalized to 0-1000.
- "box_2d": [ymin, xmin, ymax, xmax], the room's walls, normalized to 0-1000.
  Rooms can sit side by side or be stacked one above another; follow the wall lines you can see.
- "floor": 1 unless the sketch marks a group of rooms as Floor 2 or Floor 3.

Include each room exactly once. Do not invent rooms that are not drawn. Do not include the outer plot boundary as a room.`;

const coords = (n: number) => ({ type: "ARRAY", items: { type: "NUMBER" }, minItems: n, maxItems: n });

/** Gemini's responseSchema (OpenAPI subset): the reply can only be JSON in this shape. */
const ROOMS_SCHEMA = {
  type: "OBJECT",
  properties: {
    rooms: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          label: { type: "STRING" },
          name: { type: "STRING" },
          w: { type: "NUMBER" },
          l: { type: "NUMBER" },
          floor: { type: "INTEGER" },
          point: coords(2),
          box_2d: coords(4),
        },
        required: ["label", "name", "w", "l", "floor", "point", "box_2d"],
        propertyOrdering: ["label", "name", "w", "l", "floor", "point", "box_2d"],
      },
    },
  },
  required: ["rooms"],
};

type GeminiResponse = {
  candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  error?: { code?: number; message?: string; status?: string };
};

/** The image's size in pixels, so Gemini's 0–1000 coordinates can be turned back into pixels. */
export type ImageSize = { width: number; height: number };

const isNums = (v: unknown, n: number): v is number[] => Array.isArray(v) && v.length === n && v.every((x) => typeof x === "number");

/**
 * Converts Gemini's [y, x] / [ymin, xmin, ymax, xmax] (0–1000) into the pixel `label_point_2d` / `bbox_2d`
 * ([x, y] / [x1, y1, x2, y2]) that parseSketchRooms and lib/server/sketchLayout.ts read. Pixels matter: a 0–1000 scale
 * on both axes would stretch a non-square sketch, and the layout uses one feet-per-pixel scale for both.
 */
export function toPixelRooms(data: unknown, { width, height }: ImageSize): unknown {
  const rooms = (data as { rooms?: unknown })?.rooms;
  if (!Array.isArray(rooms)) return data;
  const px = (v: number, size: number) => (v / 1000) * size;
  return {
    rooms: rooms.map((r) => {
      if (!r || typeof r !== "object") return r;
      const { point, box_2d, ...rest } = r as Record<string, unknown>;
      return {
        ...rest,
        ...(isNums(point, 2) && { label_point_2d: [px(point[1], width), px(point[0], height)] }),
        ...(isNums(box_2d, 4) && { bbox_2d: [px(box_2d[1], width), px(box_2d[0], height), px(box_2d[3], width), px(box_2d[2], height)] }),
      };
    }),
  };
}

/**
 * Sends the sketch to Gemini and returns the rooms with pixel coordinates (validated later by parseSketchRooms).
 * @param base64Image raw base64 with no "data:image/...;base64," prefix
 */
export async function analyzeSketchWithGemini(base64Image: string, mimeType: string, size: ImageSize): Promise<unknown> {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) throw new SketchSetupError("Sketch reading needs a Gemini API key. Add GEMINI_API_KEY to .env.local and restart the server.");
  const model = process.env.GEMINI_VISION_MODEL?.trim() || GEMINI_DEFAULTS.model;

  /** One request; `thinking` asks for minimal thinking, which this kind of reading doesn't need and which is far faster. */
  const ask = async (thinking: boolean) => {
    let res: Response;
    try {
      res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ inline_data: { mime_type: mimeType, data: base64Image } }, { text: SKETCH_PROMPT }] }],
          generationConfig: {
            temperature: 0, // extraction, not creativity
            responseMimeType: "application/json",
            responseSchema: ROOMS_SCHEMA,
            ...(thinking && { thinkingConfig: { thinkingLevel: "minimal" } }),
          },
        }),
        signal: AbortSignal.timeout(GEMINI_DEFAULTS.timeoutMs),
        cache: "no-store",
      });
    } catch (err) {
      if ((err as Error).name === "TimeoutError") throw new SketchSetupError("Gemini took too long to answer. Try again.");
      throw new SketchSetupError("Can't reach the Gemini API. Check the server's internet connection.");
    }
    return { res, body: (await res.json().catch(() => ({}))) as GeminiResponse };
  };

  let { res, body } = await ask(true);
  // Some models don't offer minimal thinking: ask again with their default.
  if (res.status === 400 && /thinking/i.test(body.error?.message ?? "")) ({ res, body } = await ask(false));
  // A busy model ("high demand") usually answers a moment later.
  if (res.status === 503 || res.status === 500) {
    await new Promise((r) => setTimeout(r, 2000));
    ({ res, body } = await ask(true));
  }
  if (!res.ok) {
    const msg = body.error?.message ?? `HTTP ${res.status}`;
    if (res.status === 400 && /api key/i.test(msg)) throw new SketchSetupError("Gemini rejected the API key. Check GEMINI_API_KEY in .env.local.");
    if (res.status === 401 || res.status === 403) throw new SketchSetupError("Gemini rejected the API key. Check GEMINI_API_KEY in .env.local.");
    if (res.status === 404) throw new SketchSetupError(`Gemini has no model "${model}". Check GEMINI_VISION_MODEL in .env.local.`);
    if (res.status === 429) throw new SketchSetupError("The Gemini API's rate limit or quota was reached. Wait a minute and try again.");
    if (res.status === 503 || res.status === 500) throw new SketchSetupError("Gemini is busy right now (high demand). Try again in a minute.");
    throw new Error(`Gemini responded ${res.status}: ${msg}`);
  }
  if (body.promptFeedback?.blockReason) throw new SketchSetupError("Gemini declined to read this image. Try another sketch.");

  const content = (body.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("");
  try {
    return toPixelRooms(JSON.parse(content), size);
  } catch {
    // Not clean JSON; parseSketchRooms can still dig rooms out of text (without positions, which stay in 0–1000).
    return { text: content };
  }
}
