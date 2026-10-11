import "server-only";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { DbNotConfiguredError, isConnectionError } from "./db";
import { MongoNotConfiguredError, MongoNotSetUpError, isMongoConnectionError, isMongoError, isMongoValidationError } from "./mongo";

/** An error whose message is safe to show the user, with the HTTP status to send. */
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}

/** Maps anything thrown by the data layer to an HTTP status and a message that's safe to show the user. */
export function describeError(err: unknown, context: string): { status: number; message: string } {
  if (err instanceof HttpError) return { status: err.status, message: err.message };
  if (err instanceof ZodError) {
    const first = err.issues[0];
    return { status: 400, message: `Invalid ${first?.path.join(".") || "request"}: ${first?.message}` };
  }
  if (err instanceof DbNotConfiguredError) return { status: 503, message: err.message };
  // MongoDB (room designs). Checked before isConnectionError(), whose message match would also catch these.
  if (err instanceof MongoNotConfiguredError || err instanceof MongoNotSetUpError) return { status: 503, message: err.message };
  if (isMongoConnectionError(err)) {
    console.error(`[${context}] MongoDB unreachable:`, err);
    return { status: 503, message: "Can't reach MongoDB. Is it running? (see README → MongoDB)" };
  }
  if (isMongoValidationError(err)) {
    // The room_designs $jsonSchema validator rejected the document — MongoDB's version of a CHECK violation.
    return { status: 422, message: "MongoDB rejected that design: it doesn't match the room_designs schema." };
  }
  if (isMongoError(err)) {
    console.error(`[${context}] MongoDB error:`, err);
    return { status: 500, message: "Something went wrong in MongoDB." };
  }
  const pgCode = (err as { code?: string }).code;
  if (pgCode === "42P01") return { status: 503, message: "The database tables don't exist yet. Run: npm run db:setup" };
  if (pgCode === "23514" || pgCode === "23505" || pgCode === "23503") {
    // CHECK / UNIQUE / FOREIGN KEY violation — the database rejected bad data.
    return { status: 422, message: `The database rejected that: ${(err as Error).message}` };
  }
  if (isConnectionError(err)) {
    console.error(`[${context}] database unreachable:`, err);
    return { status: 503, message: "Can't reach the database. Is PostgreSQL running? (see README → Database)" };
  }
  console.error(`[${context}]`, err);
  return { status: 500, message: "Something went wrong on the server." };
}

/**
 * Turns anything thrown inside a route handler into a JSON error response.
 * Validation errors also carry `fields`: the first message for each invalid field, for forms to show inline.
 */
export function errorResponse(err: unknown, context: string) {
  const { status, message } = describeError(err, context);
  if (err instanceof ZodError) {
    const fields: Record<string, string> = {};
    for (const issue of err.issues) fields[String(issue.path[0] ?? "")] ??= issue.message;
    return NextResponse.json({ error: message, fields }, { status });
  }
  return NextResponse.json({ error: message }, { status });
}
