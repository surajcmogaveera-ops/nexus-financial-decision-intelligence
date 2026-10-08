import type { PrismaClient } from "../generated/prisma/client.js";
import type { RankedChunk } from "./fusion.js";
import { fuseRankedChunks } from "./fusion.js";
import { createEmbedding, type EmbeddingOutcome } from "./embedding-client.js";
import type { RetrievalResult } from "./types.js";

type Row = { chunkId: string; documentId: string; title: string; topic: string; content: string; sourceId: string; sourceName: string; sourceType: string; sourceUrl: string | null; provenance: string; score: number };
type QueryClient = Pick<PrismaClient, "$queryRawUnsafe">;
type Embed = (text: string) => Promise<EmbeddingOutcome>;
export interface RetrievalOptions { limit?: number; candidateCount?: number; rrfK?: number }
export interface RetrievalDependencies { embed?: Embed }

const MAX_QUERY_LENGTH = 2_000;
const MAX_RESULTS = 5;

/** PostgreSQL owns both candidate lists; optional embeddings affect only retrieval context, never simulation values. */
export async function retrieveEvidence(
  prisma: QueryClient,
  query: unknown,
  options: RetrievalOptions = {},
  dependencies: RetrievalDependencies = {},
): Promise<RetrievalResult> {
  if (typeof query !== "string") return empty("", "INVALID_QUERY", false, "Retrieval query must be text.");
  const cleanQuery = query.trim();
  if (!cleanQuery || cleanQuery.length > MAX_QUERY_LENGTH || !/[\p{L}\p{N}]/u.test(cleanQuery)) {
    return empty(cleanQuery, "INVALID_QUERY", false, "Retrieval query must contain searchable text and be at most 2000 characters.");
  }
  if (!isPositiveInteger(options.candidateCount) && options.candidateCount !== undefined) {
    return empty(cleanQuery, "INVALID_QUERY", false, "Retrieval candidateCount must be a positive integer.");
  }
  if (!isPositiveInteger(options.limit) && options.limit !== undefined) {
    return empty(cleanQuery, "INVALID_QUERY", false, "Retrieval limit must be a positive integer.");
  }
  if (options.rrfK !== undefined && !isPositiveInteger(options.rrfK)) {
    return empty(cleanQuery, "INVALID_QUERY", false, "Retrieval rrfK must be a positive integer.");
  }
  const candidateCount = Math.min(50, options.candidateCount ?? 20);
  const limit = Math.min(MAX_RESULTS, options.limit ?? MAX_RESULTS);
  let fts: RankedChunk[] = [];
  let ftsAvailable = false;
  let ftsMessage: string | null = null;
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
    ftsAvailable = true;
  } catch {
    ftsMessage = "PostgreSQL full-text retrieval is unavailable.";
  }

  let vectorAvailable = false;
  let vectorAvailabilityChecked = false;
  let vector: RankedChunk[] = [];
  let vectorStatus: "READY" | "NOT_CONFIGURED" | "UNAVAILABLE" = "UNAVAILABLE";
  try {
    const ext = await prisma.$queryRawUnsafe<Array<{ enabled: boolean }>>("SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname='vector') AS enabled");
    vectorAvailabilityChecked = true;
    vectorAvailable = ext[0]?.enabled === true;
    if (!vectorAvailable) vectorStatus = "UNAVAILABLE";
  } catch {
    vectorStatus = "UNAVAILABLE";
  }
  if (vectorAvailable) {
    let embedding: EmbeddingOutcome;
    try { embedding = await (dependencies.embed ?? createEmbedding)(cleanQuery); }
    catch { embedding = { status: "UNAVAILABLE", vector: null, model: null }; }
    vectorStatus = embedding.status;
    if (embedding.status === "READY" && isEmbeddingVector(embedding.vector)) {
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
        vector = rows.map((r, i) => asRanked(r, i + 1));
      } catch {
        vectorStatus = "UNAVAILABLE";
      }
    } else if (embedding.status === "READY") {
      vectorStatus = "UNAVAILABLE";
    }
  }

  const results = fuseRankedChunks(fts, vector, options.rrfK ?? 60, limit);
  const methods = [...new Set(results.flatMap((r) => r.retrievalMethods))];
  const vectorSearchAvailable = vectorStatus === "READY";
  const status = results.length > 0
    ? "READY"
    : ftsAvailable || vectorSearchAvailable ? "NO_RESULTS" : "UNAVAILABLE";
  const messages = [
    ftsMessage,
    !vectorAvailabilityChecked ? "pgvector availability could not be checked." : !vectorAvailable ? "pgvector is not installed." : null,
    vectorStatus === "NOT_CONFIGURED" ? "Embedding provider is not configured." : null,
    vectorStatus === "UNAVAILABLE" && vectorAvailable ? "Semantic retrieval is unavailable." : null,
    results.length === 0 && status === "NO_RESULTS" ? "No evidence matched the query." : null,
  ].filter((message): message is string => Boolean(message));
  return {
    query: cleanQuery,
    status,
    results,
    metadata: { methods, candidateCount, ftsAvailable, vectorAvailable, vectorStatus, message: messages.length ? messages.join(" ") : null },
  };
}

function asRanked(row: Row, rank: number): RankedChunk {
  if (!row.topic || !["ASSUMPTION", "EXTERNAL"].includes(row.provenance)) throw new Error("Stored evidence provenance is invalid.");
  const score = Number(row.score);
  if (!Number.isFinite(score)) throw new Error("Stored evidence ranking score is invalid.");
  return { ...row, provenance: row.provenance as "ASSUMPTION" | "EXTERNAL", rank, score };
}

function isEmbeddingVector(value: number[] | null): value is number[] {
  return Array.isArray(value) && value.length === 768 && value.every((item) => Number.isFinite(item));
}

function isPositiveInteger(value: number | undefined): value is number {
  return value !== undefined && Number.isInteger(value) && value > 0;
}

function empty(query: string, status: RetrievalResult["status"], vectorAvailable: boolean, message: string): RetrievalResult {
  return {
    query,
    status,
    results: [],
    metadata: { methods: [], candidateCount: 0, ftsAvailable: false, vectorAvailable, vectorStatus: "UNAVAILABLE", message },
  };
}
