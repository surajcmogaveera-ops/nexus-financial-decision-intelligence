import type { PrismaClient } from "../generated/prisma/client.js";
import type { RankedChunk } from "./fusion.js";
import { fuseRankedChunks } from "./fusion.js";
import { createEmbedding } from "./embedding-client.js";
import type { RetrievalResult } from "./types.js";

type Row = { chunkId: string; documentId: string; title: string; topic: string; content: string; sourceId: string; sourceName: string; sourceType: string; sourceUrl: string | null; provenance: string; score: number };

export async function retrieveEvidence(prisma: PrismaClient, query: string, options: { limit?: number; candidateCount?: number; rrfK?: number } = {}): Promise<RetrievalResult> {
  const cleanQuery = query.trim();
  if (!cleanQuery) return empty(cleanQuery, "NO_RESULTS", false, "A non-empty query is required.");
  const candidateCount = Math.min(50, Math.max(1, options.candidateCount ?? 20));
  const limit = Math.min(10, Math.max(1, options.limit ?? 5));
  let fts: RankedChunk[] = [];
  try {
    const rows = await prisma.$queryRawUnsafe<Row[]>(`
      SELECT c.id::text AS "chunkId", d.id::text AS "documentId", d.title,
        c.metadata->>'topic' AS topic, c.content, s.id::text AS "sourceId", s.name AS "sourceName",
        s.source_type AS "sourceType", s.source_url AS "sourceUrl", c.metadata->>'provenance' AS provenance,
        ts_rank_cd(to_tsvector('english', c.content), websearch_to_tsquery('english', $1)) AS score
      FROM evidence_chunks c JOIN evidence_documents d ON d.id=c.document_id
      JOIN evidence_sources s ON s.id=d.source_id
      WHERE to_tsvector('english', c.content) @@ websearch_to_tsquery('english', $1)
      ORDER BY score DESC, c.id ASC LIMIT $2`, cleanQuery, candidateCount);
    fts = rows.map((r, i) => asRanked(r, i + 1));
  } catch { return empty(cleanQuery, "UNAVAILABLE", false, "PostgreSQL full-text retrieval is unavailable."); }

  let vectorAvailable = false;
  let vector: RankedChunk[] = [];
  let vectorStatus: "READY" | "NOT_CONFIGURED" | "UNAVAILABLE" = "NOT_CONFIGURED";
  try {
    const ext = await prisma.$queryRawUnsafe<Array<{ enabled: boolean }>>("SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname='vector') AS enabled");
    vectorAvailable = ext[0]?.enabled === true;
  } catch { /* FTS remains independently useful. */ }
  if (vectorAvailable) {
    const embedding = await createEmbedding(cleanQuery);
    vectorStatus = embedding.status;
    if (embedding.vector) {
      try {
        const literal = `[${embedding.vector.join(",")}]`;
        const rows = await prisma.$queryRawUnsafe<Row[]>(`
          SELECT c.id::text AS "chunkId", d.id::text AS "documentId", d.title,
            c.metadata->>'topic' AS topic, c.content, s.id::text AS "sourceId", s.name AS "sourceName",
            s.source_type AS "sourceType", s.source_url AS "sourceUrl", c.metadata->>'provenance' AS provenance,
            (c.embedding <=> $1::vector) AS score
          FROM evidence_chunks c JOIN evidence_documents d ON d.id=c.document_id
          JOIN evidence_sources s ON s.id=d.source_id
          WHERE c.embedding IS NOT NULL ORDER BY c.embedding <=> $1::vector, c.id ASC LIMIT $2`, literal, candidateCount);
        vector = rows.map((r, i) => asRanked(r, i + 1)); vectorStatus = "READY";
      } catch { vectorStatus = "UNAVAILABLE"; }
    }
  }
  const results = fuseRankedChunks(fts, vector, options.rrfK ?? 60, limit);
  const methods = [...new Set(results.flatMap((r) => r.retrievalMethods))];
  const status = results.length ? "READY" : fts.length === 0 && vector.length === 0 ? "NO_RESULTS" : "UNAVAILABLE";
  const message = !vectorAvailable ? "pgvector is not installed; FTS results are available." : vectorStatus === "NOT_CONFIGURED" ? "Embedding provider is not configured; FTS results are available." : vectorStatus === "UNAVAILABLE" ? "Semantic retrieval is unavailable; FTS results are available." : null;
  return { query: cleanQuery, status, results, metadata: { methods, candidateCount, vectorAvailable, message } };
}

function asRanked(row: Row, rank: number): RankedChunk {
  if (!row.topic || !["ASSUMPTION", "EXTERNAL"].includes(row.provenance)) throw new Error("Stored evidence provenance is invalid.");
  return { ...row, provenance: row.provenance as "ASSUMPTION" | "EXTERNAL", rank, score: Number(row.score) };
}
function empty(query: string, status: RetrievalResult["status"], vectorAvailable: boolean, message: string): RetrievalResult {
  return { query, status, results: [], metadata: { methods: [], candidateCount: 0, vectorAvailable, message } };
}
