import { notImplemented } from "@/lib/server/http";

// ChromaDB (Task 3.4 / 5.4): similarity search over past AI suggestions. The chat route will call this logic directly.

export async function POST() {
  return notImplemented("POST /api/ai", "Embed the query and return the top-K similar suggestions from ChromaDB.");
}
