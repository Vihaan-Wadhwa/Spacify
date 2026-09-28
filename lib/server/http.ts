import { NextResponse } from "next/server";

/** Standard 501 for route handlers whose implementation arrives in a later task. */
export function notImplemented(route: string, plan: string) {
  return NextResponse.json({ error: "Not implemented yet", route, plan }, { status: 501 });
}

/** POSTs JSON to a webhook with a timeout and returns the parsed body (or text wrapped as { text }). */
export async function postJson(url: string, body: unknown, timeoutMs = 60_000): Promise<unknown> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Webhook responded ${res.status}`);
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { text };
  }
}
