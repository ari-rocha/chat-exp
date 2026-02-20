CREATE EXTENSION IF NOT EXISTS vector;
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'vectorscale') THEN
        CREATE EXTENSION IF NOT EXISTS vectorscale;
    ELSE
        RAISE NOTICE 'vectorscale extension is not installed; continuing with pgvector only';
    END IF;
END
$$;

CREATE TABLE
    IF NOT EXISTS kb_collections (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    );

CREATE INDEX IF NOT EXISTS idx_kb_collections_tenant ON kb_collections (tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_kb_collections_tenant_name ON kb_collections (tenant_id, name);

CREATE TABLE
    IF NOT EXISTS kb_articles (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
        collection_id TEXT NOT NULL REFERENCES kb_collections (id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        slug TEXT NOT NULL,
        markdown TEXT NOT NULL DEFAULT '',
        plain_text TEXT NOT NULL DEFAULT '',
        content_hash TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'draft',
        published_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    );

CREATE INDEX IF NOT EXISTS idx_kb_articles_tenant ON kb_articles (tenant_id);
CREATE INDEX IF NOT EXISTS idx_kb_articles_collection ON kb_articles (collection_id);
CREATE INDEX IF NOT EXISTS idx_kb_articles_status ON kb_articles (tenant_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_kb_articles_tenant_slug ON kb_articles (tenant_id, slug);

CREATE TABLE
    IF NOT EXISTS kb_chunks (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
        article_id TEXT NOT NULL REFERENCES kb_articles (id) ON DELETE CASCADE,
        chunk_index INTEGER NOT NULL,
        content_text TEXT NOT NULL,
        token_count INTEGER NOT NULL DEFAULT 0,
        embedding vector(3072),
        tsv tsvector,
        created_at TEXT NOT NULL
    );

CREATE INDEX IF NOT EXISTS idx_kb_chunks_article ON kb_chunks (article_id, chunk_index);
CREATE INDEX IF NOT EXISTS idx_kb_chunks_tenant_article ON kb_chunks (tenant_id, article_id);
CREATE INDEX IF NOT EXISTS idx_kb_chunks_tsv ON kb_chunks USING GIN (tsv);
DO $$
BEGIN
    RAISE NOTICE 'skipping ANN index for 3072-dim vectors on this pgvector build; using exact vector search + BM25';
END
$$;

CREATE TABLE
    IF NOT EXISTS kb_tags (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        color TEXT NOT NULL DEFAULT '#6366f1',
        description TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
    );

CREATE INDEX IF NOT EXISTS idx_kb_tags_tenant ON kb_tags (tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_kb_tags_tenant_name ON kb_tags (tenant_id, name);

CREATE TABLE
    IF NOT EXISTS kb_collection_tags (
        collection_id TEXT NOT NULL REFERENCES kb_collections (id) ON DELETE CASCADE,
        tag_id TEXT NOT NULL REFERENCES kb_tags (id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        PRIMARY KEY (collection_id, tag_id)
    );

CREATE TABLE
    IF NOT EXISTS kb_article_tags (
        article_id TEXT NOT NULL REFERENCES kb_articles (id) ON DELETE CASCADE,
        tag_id TEXT NOT NULL REFERENCES kb_tags (id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        PRIMARY KEY (article_id, tag_id)
    );

CREATE TABLE
    IF NOT EXISTS kb_sync_runs (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        status TEXT NOT NULL,
        collections_count INTEGER NOT NULL DEFAULT 0,
        articles_count INTEGER NOT NULL DEFAULT 0,
        chunks_count INTEGER NOT NULL DEFAULT 0,
        error TEXT NOT NULL DEFAULT ''
    );
