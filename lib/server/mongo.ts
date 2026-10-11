import "server-only";
import {
  MongoBulkWriteError,
  MongoClient,
  MongoError,
  MongoNetworkError,
  MongoServerError,
  MongoServerSelectionError,
  type Db,
} from "mongodb";

/** MONGODB_URI isn't set. */
export class MongoNotConfiguredError extends Error {
  constructor() {
    super("MongoDB isn't configured. Set MONGODB_URI in .env.local and run npm run db:setup.");
  }
}

/** The room_designs collection (with its validator) hasn't been created. */
export class MongoNotSetUpError extends Error {
  constructor() {
    super("MongoDB isn't set up yet. Run: npm run db:setup");
  }
}

// Reuse one client (it holds a connection pool) across hot reloads, like the pg Pool in db.ts.
const globalForMongo = globalThis as unknown as { spacifyMongo?: MongoClient };

export function getMongoClient(): MongoClient {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new MongoNotConfiguredError();
  if (!globalForMongo.spacifyMongo) {
    // Short timeouts: if MongoDB is down, pages and saves should fall back within seconds, not the driver's default 30.
    // No explicit connect(): the driver connects on the first operation and reconnects by itself once MongoDB is back.
    globalForMongo.spacifyMongo = new MongoClient(uri, {
      appName: "spacify",
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 3000,
      connectTimeoutMS: 3000,
    });
  }
  return globalForMongo.spacifyMongo;
}

export function getDb(): Db {
  return getMongoClient().db(process.env.MONGODB_DB || "spacify");
}

/** True for errors meaning "MongoDB isn't reachable" (not running, wrong host/port, auth failed while connecting). */
export function isMongoConnectionError(err: unknown): boolean {
  // A bulkWrite that can't reach the server throws a MongoBulkWriteError wrapping the real error.
  const cause: unknown = err instanceof MongoBulkWriteError ? err.errorResponse : err;
  return cause instanceof MongoServerSelectionError || cause instanceof MongoNetworkError;
}

/** Any error from the MongoDB driver. */
export const isMongoError = (err: unknown): boolean => err instanceof MongoError;

/** True when the collection's $jsonSchema validator rejected a document (server error 121; bulkWrite errors carry it too). */
export function isMongoValidationError(err: unknown): boolean {
  return err instanceof MongoServerError && err.code === 121;
}
