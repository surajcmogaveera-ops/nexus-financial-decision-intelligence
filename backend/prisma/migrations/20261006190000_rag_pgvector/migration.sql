-- pgvector is optional in local/development PostgreSQL installations. Keep the
-- existing evidence schema usable when the server package or permission is absent.
DO $$ BEGIN
  CREATE EXTENSION IF NOT EXISTS vector;
EXCEPTION WHEN insufficient_privilege OR undefined_file OR feature_not_supported THEN
  RAISE NOTICE 'pgvector is unavailable; semantic retrieval remains disabled';
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN
    ALTER TABLE evidence_chunks ADD COLUMN IF NOT EXISTS embedding vector(768);
    CREATE INDEX IF NOT EXISTS evidence_chunks_embedding_hnsw_idx
      ON evidence_chunks USING hnsw (embedding vector_cosine_ops);
  END IF;
EXCEPTION WHEN insufficient_privilege OR undefined_file OR undefined_object OR feature_not_supported THEN
  RAISE NOTICE 'pgvector column/index is unavailable; semantic retrieval remains disabled';
END $$;

CREATE INDEX IF NOT EXISTS evidence_chunks_content_fts_idx
  ON evidence_chunks USING gin (to_tsvector('english', content));
