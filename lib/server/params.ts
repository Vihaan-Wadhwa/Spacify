import "server-only";
import { HttpError } from "./errors";

/** Parses a positive integer id from a URL segment or query string, or throws a 400. */
export function parseId(value: string | null | undefined, what = "id"): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, `Invalid ${what}.`);
  return id;
}
