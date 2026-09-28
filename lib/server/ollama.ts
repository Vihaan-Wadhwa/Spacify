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
- "name": the room's full name. Expand short labels:
  MB → Master Bedroom, LR → Living Room, K → Kitchen, DR → Dining Room,
  B1 → Bedroom 2, B2 → Bedroom 3, Bath or T → Bathroom, WIC → Walk-in Closet,
  PR → Pooja Room, St → Study, Bal → Balcony, Store → Store, Stair → Staircase.
  If a label is unreadable, use the closest room type from that list.
- "w" and "l": width and length in FEET.
  If dimensions are written next to the label (e.g. "14x13" or "14'×13'"), copy them exactly.
  Otherwise estimate from the room's size relative to the other rooms and any overall plot dimensions drawn on the sketch.
  Typical sizes: bedrooms 10–15 ft, kitchen 8–12 ft, bathroom 5–8 ft.
- "floor": 1 unless the sketch marks a group of rooms as Floor 2 or Floor 3.

Include each room exactly once. Do not invent rooms that are not drawn. Do not include the outer plot boundary as a room.`;

/** JSON schema passed to Ollama's `format` option, so the model can only produce this shape. */
const ROOMS_SCHEMA = {
  type: "object",
  properties: {
    rooms: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          w: { type: "number" },
          l: { type: "number" },
          floor: { type: "integer" },
        },
        required: ["name", "w", "l", "floor"],
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
