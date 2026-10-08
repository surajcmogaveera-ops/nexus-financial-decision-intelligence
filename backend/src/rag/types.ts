export type RetrievalStatus = "READY" | "NOT_CONFIGURED" | "UNAVAILABLE" | "NO_RESULTS" | "INVALID_QUERY";
export type RetrievalMethod = "fts" | "vector";

export interface RetrievedEvidence {
  chunkId: string;
  documentId: string;
  title: string;
  topic: string;
  content: string;
  sourceId: string;
  sourceName: string;
  sourceType: string;
  sourceUrl: string | null;
  provenance: "ASSUMPTION" | "EXTERNAL";
  retrievalMethods: RetrievalMethod[];
  ftsRank: number | null;
  ftsScore: number | null;
  vectorRank: number | null;
  vectorScore: number | null;
  rrfScore: number;
}

export interface RetrievalResult {
  query: string;
  status: RetrievalStatus;
  results: RetrievedEvidence[];
  metadata: {
    methods: RetrievalMethod[];
    candidateCount: number;
    ftsAvailable: boolean;
    vectorAvailable: boolean;
    vectorStatus: "READY" | "NOT_CONFIGURED" | "UNAVAILABLE";
    message: string | null;
  };
}

export interface RetrievedContextItem {
  chunkId: string;
  documentId: string;
  title: string;
  topic: string;
  content: string;
  sourceId: string;
  sourceType: string;
  sourceUrl: string | null;
  provenance: "ASSUMPTION" | "EXTERNAL";
}
