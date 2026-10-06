import { createHash } from "node:crypto";
import type { PrismaClient } from "../generated/prisma/client.js";
import { createEmbedding } from "./embedding-client.js";
import { CORPUS_SOURCE_ID, CURATED_CORPUS } from "./corpus.js";

function stableId(key: string): string {
  const hex = createHash("sha256").update(`nexus-h17:${key}`).digest("hex").slice(0, 32).split("");
  hex[12] = "5"; hex[16] = ((parseInt(hex[16]!, 16) & 3) | 8).toString(16);
  const s = hex.join(""); return `${s.slice(0,8)}-${s.slice(8,12)}-${s.slice(12,16)}-${s.slice(16,20)}-${s.slice(20)}`;
}

export async function ingestCuratedCorpus(prisma: PrismaClient): Promise<{ documents: number; chunks: number; embedded: number }> {
  const source = await prisma.evidenceSource.upsert({ where: { id: CORPUS_SOURCE_ID }, create: { id: CORPUS_SOURCE_ID, name: "NEXUS internally authored MVP corpus", sourceType: "INTERNAL_CURATED", publisher: "NEXUS", reliability: { provenance: "ASSUMPTION" } }, update: { name: "NEXUS internally authored MVP corpus", sourceType: "INTERNAL_CURATED", publisher: "NEXUS" } });
  let embedded = 0;
  const extension = await prisma.$queryRawUnsafe<Array<{ enabled: boolean }>>("SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname='vector') AS enabled").catch(() => [{ enabled: false }]);
  for (const [slug, title, topic, content] of CURATED_CORPUS) {
    const docId = stableId(`document:${slug}`), chunkId = stableId(`chunk:${slug}`);
    const doc = await prisma.evidenceDocument.upsert({ where: { id: docId }, create: { id: docId, sourceId: source.id, title, contentMetadata: { topic, provenance: "ASSUMPTION", authoredBy: "NEXUS", corpusVersion: 1 } }, update: { sourceId: source.id, title, contentMetadata: { topic, provenance: "ASSUMPTION", authoredBy: "NEXUS", corpusVersion: 1 } } });
    const chunk = await prisma.evidenceChunk.upsert({ where: { id: chunkId }, create: { id: chunkId, documentId: doc.id, chunkIndex: 0, content, tokenCount: Math.ceil(content.split(/\s+/).length * 1.3), metadata: { topic, provenance: "ASSUMPTION", sourceId: source.id } }, update: { documentId: doc.id, content, metadata: { topic, provenance: "ASSUMPTION", sourceId: source.id } } });
    const embedding = extension[0]?.enabled ? await createEmbedding(`${title}\n${content}`) : null;
    if (embedding?.vector) {
      try { await prisma.$executeRawUnsafe("UPDATE evidence_chunks SET embedding = $1::vector WHERE id = $2::uuid", `[${embedding.vector.join(",")}]`, chunk.id); embedded++; }
      catch { /* Extension unavailable; content is still ingested and FTS-ready. */ }
    }
  }
  return { documents: CURATED_CORPUS.length, chunks: CURATED_CORPUS.length, embedded };
}
