import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";
import { getDatabaseUrl } from "./config.js";

const prismaGlobal = globalThis as typeof globalThis & { nexusPrisma?: PrismaClient };

export function createPrismaClient(connectionString = getDatabaseUrl()): PrismaClient {
  const adapter = new PrismaPg({ connectionString, connectionTimeoutMillis: 5_000 });
  return new PrismaClient({ adapter });
}

/** Returns one shared client, including across development module reloads. */
export function getPrismaClient(): PrismaClient {
  prismaGlobal.nexusPrisma ??= createPrismaClient();
  return prismaGlobal.nexusPrisma;
}

export async function disconnectPrismaClient(): Promise<void> {
  const client = prismaGlobal.nexusPrisma;
  delete prismaGlobal.nexusPrisma;
  if (client) await client.$disconnect();
}

export async function checkDatabaseConnection(): Promise<void> {
  await getPrismaClient().$queryRaw`SELECT 1`;
}
