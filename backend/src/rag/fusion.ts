import type { RetrievalMethod, RetrievedEvidence } from "./types.js";

export interface RankedChunk {
  chunkId: string; documentId: string; title: string; topic: string; content: string;
  sourceId: string; sourceName: string; sourceType: string; sourceUrl: string | null;
  provenance: "ASSUMPTION" | "EXTERNAL"; rank: number; score: number;
}

/** Stable Reciprocal Rank Fusion; score reflects rank positions, not confidence. */
export function fuseRankedChunks(fts: RankedChunk[], vector: RankedChunk[], k = 60, limit = 5): RetrievedEvidence[] {
  if (!Number.isInteger(k) || k < 1 || !Number.isInteger(limit) || limit < 1) throw new RangeError("Invalid RRF options.");
  const combined = new Map<string, RetrievedEvidence>();
  const add = (items: RankedChunk[], method: RetrievalMethod) => {
    const unique = new Map<string, RankedChunk>();
    for (const item of items) {
      const previous = unique.get(item.chunkId);
      if (!previous || item.rank < previous.rank) unique.set(item.chunkId, item);
    }
    for (const item of unique.values()) {
      if (!Number.isInteger(item.rank) || item.rank < 1 || !Number.isFinite(item.score)) continue;
    const prior = combined.get(item.chunkId);
    const result = prior ?? {
      chunkId: item.chunkId, documentId: item.documentId, title: item.title, topic: item.topic,
      content: item.content, sourceId: item.sourceId, sourceName: item.sourceName, sourceType: item.sourceType,
      sourceUrl: item.sourceUrl, provenance: item.provenance, retrievalMethods: [], ftsRank: null, ftsScore: null,
      vectorRank: null, vectorScore: null, rrfScore: 0,
    };
    if (!result.retrievalMethods.includes(method)) result.retrievalMethods.push(method);
    result.rrfScore += 1 / (k + item.rank);
    if (method === "fts") { result.ftsRank = item.rank; result.ftsScore = item.score; }
    else { result.vectorRank = item.rank; result.vectorScore = item.score; }
    combined.set(item.chunkId, result);
    }
  };
  add(fts, "fts"); add(vector, "vector");
  return [...combined.values()].sort((a, b) =>
    b.rrfScore - a.rrfScore || (a.chunkId < b.chunkId ? -1 : a.chunkId > b.chunkId ? 1 : 0),
  ).slice(0, Math.min(5, limit));
}
