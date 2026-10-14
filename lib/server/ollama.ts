/**
 * Sketch recognition with a local vision model served by Ollama (default: Qwen2.5-VL 7B).
 * Nothing leaves your machine and there's no per-request cost.
 *
 *   ollama pull qwen2.5vl:7b
 *   ollama serve            # listens on http://localhost:11434
 */

export const OLLAMA_DEFAULTS = {
  url: "http://localhost:11434",
  model: "qwen2.5vl:7b",
  timeoutMs: 180_000, // local vision inference on a CPU can take a minute or more
};

/** A problem the user can fix (Ollama not running, model not pulled). The message is shown in the UI. */
export class OllamaSetupError extends Error {}

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
- "label_point_2d": [x, y], the pixel position of the centre of the room's label text.
- "bbox_2d": [x1, y1, x2, y2], the pixel coordinates of the room's walls: top-left and bottom-right corners.
  Rooms can sit side by side or be stacked one above another; follow the wall lines you can see.
- "floor": 1 unless the sketch marks a group of rooms as Floor 2 or Floor 3.

Include each room exactly once. Do not invent rooms that are not drawn. Do not include the outer plot boundary as a room.`;

const pixels = (n: number) => ({ type: "array", items: { type: "number" }, minItems: n, maxItems: n });

/**
 * JSON schema passed to Ollama's `format` option, so the model can only produce this shape.
 * label_point_2d / bbox_2d use Qwen2.5-VL's own grounding format (pixel coordinates), which it was trained to output;
 * lib/server/sketchLayout.ts turns them into positions in feet.
 */
const ROOMS_SCHEMA = {
  type: "object",
  properties: {
    rooms: {
      type: "array",
      items: {
        type: "object",
        properties: {
          label: { type: "string" },
          name: { type: "string" },
          w: { type: "number" },
          l: { type: "number" },
          floor: { type: "integer" },
          label_point_2d: pixels(2),
          bbox_2d: pixels(4),
        },
        required: ["label", "name", "w", "l", "floor", "label_point_2d", "bbox_2d"],
      },
    },
  },
  required: ["rooms"],
};

type OllamaChatResponse = { message?: { content?: string }; error?: string };

/**
 * Sends the sketch to Ollama and returns the model's raw JSON (validated later by parseSketchRooms).
 * @param base64Image raw base64 with no "data:image/...;base64," prefix
 */
export async function analyzeSketchWithOllama(base64Image: string): Promise<unknown> {
  const url = (process.env.OLLAMA_URL || OLLAMA_DEFAULTS.url).replace(/\/+$/, "");
  const model = process.env.OLLAMA_VISION_MODEL || OLLAMA_DEFAULTS.model;

  let res: Response;
  try {
    res = await fetch(`${url}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: SKETCH_PROMPT, images: [base64Image] }],
        format: ROOMS_SCHEMA, // structured output: the reply is guaranteed to be JSON in this shape
        stream: false,
        keep_alive: "10m", // keep the model loaded between uploads so the next one is faster
        options: { temperature: 0 }, // extraction, not creativity
      }),
      signal: AbortSignal.timeout(OLLAMA_DEFAULTS.timeoutMs),
      cache: "no-store",
    });
  } catch (err) {
    if ((err as Error).name === "TimeoutError") {
      throw new OllamaSetupError("The local model took too long. Try a smaller image, or a GPU / smaller model (e.g. qwen2.5vl:3b).");
    }
    throw new OllamaSetupError(`Can't reach Ollama at ${url}. Is it running? Start it with "ollama serve".`);
  }

  const body = (await res.json().catch(() => ({}))) as OllamaChatResponse;
  if (!res.ok) {
    if (res.status === 404 || /not found/i.test(body.error ?? "")) {
      throw new OllamaSetupError(`The model "${model}" isn't downloaded. Run: ollama pull ${model}`);
    }
    throw new Error(`Ollama responded ${res.status}: ${body.error ?? "unknown error"}`);
  }

  const content = body.message?.content ?? "";
  try {
    return JSON.parse(content);
  } catch {
    // Older Ollama versions ignore schema formats; parseSketchRooms can still dig JSON out of text.
    return { text: content };
  }
}
