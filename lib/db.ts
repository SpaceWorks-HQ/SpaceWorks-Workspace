import { PrismaClient, type Prisma } from "@prisma/client";

const PRISMA_KEY = Symbol.for("sww.prisma");
type GlobalWithPrisma = typeof globalThis & { [PRISMA_KEY]?: PrismaClient };

function createPrismaClient(): PrismaClient {
  return new PrismaClient<Prisma.PrismaClientOptions>({
    log: process.env.PRISMA_LOG_QUERIES === "1" ? ["query", "error", "warn"] : ["error"],
  });
}

/**
 * One PrismaClient per process, shared across Next.js bundles and dev HMR.
 * After `prisma generate` adds models, restart the dev server so the cached
 * client picks up the new delegates.
 */
const store = globalThis as GlobalWithPrisma;
export const prisma: PrismaClient = store[PRISMA_KEY] ?? (store[PRISMA_KEY] = createPrismaClient());

export type Db = PrismaClient;
export type Tx = Prisma.TransactionClient;
/** Either the root client or an interactive transaction client. */
export type DbClient = PrismaClient | Tx;
