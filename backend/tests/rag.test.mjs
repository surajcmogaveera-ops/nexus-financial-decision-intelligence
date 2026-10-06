import test from "node:test";
import assert from "node:assert/strict";
import { CURATED_CORPUS } from "../dist/rag/corpus.js";
import { fuseRankedChunks } from "../dist/rag/fusion.js";

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
});
