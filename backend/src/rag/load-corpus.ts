import "dotenv/config";
import { disconnectPrismaClient, getPrismaClient } from "../db/prisma.js";
import { ingestCuratedCorpus } from "./ingest.js";

try {
  const result = await ingestCuratedCorpus(getPrismaClient());
  console.log(JSON.stringify(result));
} catch {
  console.error("Curated corpus ingestion failed.");
  process.exitCode = 1;
} finally { await disconnectPrismaClient(); }
