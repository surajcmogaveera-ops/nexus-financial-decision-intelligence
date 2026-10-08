import test from "node:test";
import assert from "node:assert/strict";
import { CURATED_CORPUS } from "../dist/rag/corpus.js";
import { fuseRankedChunks } from "../dist/rag/fusion.js";
import { retrieveEvidence } from "../dist/rag/repository.js";

const chunk = (chunkId, rank, score = 1) => ({
  chunkId, documentId: `doc-${chunkId}`, title: "Emergency fund", topic: "emergency fund",
  content: "Liquid savings for unexpected expenses.", sourceId: "source-1", sourceName: "NEXUS corpus",
  sourceType: "INTERNAL_CURATED", sourceUrl: null, provenance: "ASSUMPTION", rank, score,
});

test("curated corpus covers exactly the eight H17 topics with internally authored text", () => {
  assert.deepEqual(CURATED_CORPUS.map((item) => item[0]), ["sebi", "budgeting", "emergency-fund", "debt", "liquidity", "risk", "diversification", "financial-goals"]);
  assert.equal(CURATED_CORPUS.length, 8);
  assert.ok(CURATED_CORPUS.every((item) => item[3].length > 30));
});

test("RRF merges duplicate chunks, records methods and orders results deterministically", () => {
  const first = fuseRankedChunks([chunk("a", 1), chunk("b", 2)], [chunk("b", 1), chunk("c", 2)], 60, 5);
  assert.deepEqual(first.map((item) => item.chunkId), ["b", "a", "c"]);
  assert.deepEqual(first[0].retrievalMethods, ["fts", "vector"]);
  assert.equal(first[0].ftsRank, 2);
  assert.equal(first[0].vectorRank, 1);
  assert.equal(first[0].rrfScore, 1 / 62 + 1 / 61);
  assert.deepEqual(fuseRankedChunks([], [chunk("c", 1)]).map((item) => item.retrievalMethods), [["vector"]]);
  assert.deepEqual(fuseRankedChunks([chunk("a", 1)], []).map((item) => item.retrievalMethods), [["fts"]]);
  const duplicates = fuseRankedChunks([chunk("a", 1), chunk("a", 2)], []);
  assert.equal(duplicates.length, 1);
  assert.deepEqual(duplicates[0].retrievalMethods, ["fts"]);
  assert.equal(duplicates[0].rrfScore, 1 / 61);
  assert.equal(fuseRankedChunks(Array.from({ length: 8 }, (_, i) => chunk(`id-${i}`, i + 1)), [], 60, 10).length, 5);
});

const row = (id, score = 0.5) => ({
  chunkId: id, documentId: `doc-${id}`, title: `Title ${id}`, topic: "emergency fund",
  content: `Grounded evidence ${id}.`, sourceId: "source-1", sourceName: "Curated NEXUS corpus",
  sourceType: "INTERNAL_CURATED", sourceUrl: null, provenance: "ASSUMPTION", score,
});
const readyEmbedding = { status: "READY", vector: Array(768).fill(0.25), model: "test-only" };

function repository({ ftsRows = [], vectorRows = [], ftsFails = false, extension = false, vectorFails = false } = {}) {
  const calls = [];
  const prisma = { async $queryRawUnsafe(sql) {
    calls.push(sql);
    if (sql.includes("pg_extension")) {
      if (vectorFails) throw new Error("catalog unavailable");
      return [{ enabled: extension }];
    }
    if (sql.includes("c.embedding <=>")) {
      if (vectorFails) throw new Error("vector query unavailable");
      return vectorRows;
    }
    if (ftsFails) throw new Error("fts unavailable");
    return ftsRows;
  } };
  return { prisma, calls };
}

test("FTS-only fallback preserves metadata, reports vector unavailable and returns no fabricated vector scores", async () => {
  const { prisma } = repository({ ftsRows: [row("fts-1", 0.75)] });
  const result = await retrieveEvidence(prisma, "emergency reserve");
  assert.equal(result.status, "READY");
  assert.deepEqual(result.metadata.methods, ["fts"]);
  assert.equal(result.metadata.ftsAvailable, true);
  assert.equal(result.metadata.vectorStatus, "UNAVAILABLE");
  assert.match(result.metadata.message, /pgvector is not installed/);
  assert.equal(result.results[0].chunkId, "fts-1");
  assert.equal(result.results[0].provenance, "ASSUMPTION");
  assert.equal(result.results[0].sourceName, "Curated NEXUS corpus");
  assert.equal(result.results[0].ftsScore, 0.75);
  assert.equal(result.results[0].vectorScore, null);
  assert.equal(result.results[0].vectorRank, null);
});

test("FTS remains usable when pgvector exists but the embedding provider is not configured", async () => {
  const { prisma } = repository({ ftsRows: [row("fts-1", 0.75)], extension: true });
  const result = await retrieveEvidence(prisma, "emergency reserve", {}, {
    embed: async () => ({ status: "NOT_CONFIGURED", vector: null, model: null }),
  });
  assert.equal(result.status, "READY");
  assert.equal(result.metadata.vectorAvailable, true);
  assert.equal(result.metadata.vectorStatus, "NOT_CONFIGURED");
  assert.match(result.metadata.message, /Embedding provider is not configured/);
  assert.deepEqual(result.results[0].retrievalMethods, ["fts"]);
  assert.equal(result.results[0].vectorScore, null);
});

test("vector-only results remain available when PostgreSQL FTS fails", async () => {
  const { prisma } = repository({ ftsFails: true, extension: true, vectorRows: [row("vec-1", 0.08)] });
  const result = await retrieveEvidence(prisma, "emergency reserve", {}, { embed: async () => readyEmbedding });
  assert.equal(result.status, "READY");
  assert.deepEqual(result.metadata.methods, ["vector"]);
  assert.equal(result.metadata.ftsAvailable, false);
  assert.equal(result.metadata.vectorStatus, "READY");
  assert.equal(result.results[0].vectorRank, 1);
  assert.equal(result.results[0].vectorScore, 0.08);
  assert.match(result.metadata.message, /full-text retrieval is unavailable/);
});

test("hybrid retrieval merges overlap by RRF, deduplicates, and enforces a five-result ceiling", async () => {
  const { prisma } = repository({
    ftsRows: [row("overlap", 0.9), row("fts-only", 0.6), ...Array.from({ length: 6 }, (_, i) => row(`extra-${i}`, 0.1))],
    vectorRows: [row("overlap", 0.05), row("vector-only", 0.12)], extension: true,
  });
  const result = await retrieveEvidence(prisma, "emergency reserve", { limit: 10 }, { embed: async () => readyEmbedding });
  assert.equal(result.status, "READY");
  assert.equal(result.results.length, 5);
  assert.equal(new Set(result.results.map((item) => item.chunkId)).size, result.results.length);
  const overlap = result.results.find((item) => item.chunkId === "overlap");
  assert.deepEqual(overlap.retrievalMethods, ["fts", "vector"]);
  assert.equal(overlap.ftsRank, 1);
  assert.equal(overlap.vectorRank, 1);
  assert.equal(overlap.rrfScore, 1 / 61 + 1 / 61);
  assert.deepEqual(result.metadata.methods, ["fts", "vector"]);
});

test("invalid queries are rejected before any database or embedding calls", async () => {
  const { prisma, calls } = repository({ ftsRows: [row("should-not-appear")] });
  for (const query of ["", "   ", "!!!", "x".repeat(2001), null]) {
    const result = await retrieveEvidence(prisma, query);
    assert.equal(result.status, "INVALID_QUERY");
    assert.deepEqual(result.results, []);
  }
  assert.deepEqual(calls, []);
});

test("invalid embedding dimensions or non-finite values never reach vector SQL", async () => {
  const { prisma, calls } = repository({ extension: true, ftsRows: [row("fts-1")] });
  const result = await retrieveEvidence(prisma, "emergency reserve", {}, { embed: async () => ({ ...readyEmbedding, vector: [1, 2] }) });
  assert.equal(result.status, "READY");
  assert.equal(result.metadata.vectorStatus, "UNAVAILABLE");
  assert.equal(result.results.length, 1);
  assert.equal(calls.some((sql) => sql.includes("c.embedding <=>")), false);
});

test("complete retrieval failure and successful no-match queries return no evidence", async () => {
  const unavailable = repository({ ftsFails: true, vectorFails: true });
  const failed = await retrieveEvidence(unavailable.prisma, "emergency reserve");
  assert.equal(failed.status, "UNAVAILABLE");
  assert.deepEqual(failed.results, []);
  assert.equal(failed.metadata.ftsAvailable, false);
  const emptySearch = repository({ ftsRows: [] });
  const noMatch = await retrieveEvidence(emptySearch.prisma, "emergency reserve");
  assert.equal(noMatch.status, "NO_RESULTS");
  assert.deepEqual(noMatch.results, []);
});

test("identical retrieval queries preserve the same rank order", async () => {
  const data = { ftsRows: [row("b", 0.7), row("a", 0.7), row("c", 0.2)] };
  const first = await retrieveEvidence(repository(data).prisma, "emergency reserve");
  const second = await retrieveEvidence(repository(data).prisma, "emergency reserve");
  assert.deepEqual(first.results, second.results);
});
