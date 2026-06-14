import { loadEnvConfig } from "@next/env";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema";

loadEnvConfig(process.cwd());

type PostgresClient = ReturnType<typeof postgres>;

const globalForDb = globalThis as unknown as {
  postgresClient?: PostgresClient;
};

function getConnectionString() {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error("DATABASE_URL is required to access Resource Allocator data.");
  }

  return connectionString;
}

export const sqlClient =
  globalForDb.postgresClient ??
  postgres(getConnectionString(), {
    max: 5,
    prepare: false,
  });

if (process.env.NODE_ENV !== "production") {
  globalForDb.postgresClient = sqlClient;
}

export const db = drizzle(sqlClient, { schema });

export type Db = typeof db;
