"""
Hierarchia RAG Service
======================

FastAPI service that owns the Retrieval-Augmented Generation pipeline for the
manager portal. Indexes Supabase/Postgres rows + uploaded files into a
pgvector collection and serves similarity search + scoped analytics back to
the Node.js MCP service.

Architecture
------------

    Next.js portal  ──HTTP──>  mcp-service (Node)  ──HTTP──>  rag-service (this)
                                       │                            │
                                       │                            ├─ pgvector (PostgreSQL on Railway)
                                       │                            ├─ LangChain text splitters
                                       │                            └─ Embeddings (OpenAI / OpenRouter)
                                       │
                                       └─ AI Gateway / model providers (LLM completions)

The RAG service never returns LLM completions itself — orchestration of
the chat turn happens in the MCP service, which uses the AI SDK to compose:

    1. POST /v1/retrieve   → top-k pgvector chunks for the user's question
    2. LLM completion in MCP land
    3. POST /v1/log/query  → audit trail + analytics counters

Endpoints implemented here:

    GET  /health                   liveness + version
    POST /v1/index                 (re)ingest a row or file into pgvector
    POST /v1/retrieve              role-scoped similarity search
    POST /v1/log/query             append a query to the analytics ledger
    GET  /v1/analytics             aggregate metrics consumed by the UI

Authentication: every request must include `Authorization: Bearer <token>`,
where the token equals `RAG_SERVICE_TOKEN`. The MCP service holds the same
secret. Supabase + portal-issued JWTs are NOT accepted directly to keep the
trust boundary tight.

Environment variables (Railway)
-------------------------------

    DATABASE_URL          Postgres URL with pgvector extension installed
    RAG_SERVICE_TOKEN     Shared bearer token (same value on the MCP)
    OPENAI_API_KEY        Used for embedding generation via langchain_openai
    EMBEDDING_MODEL       e.g. "text-embedding-3-small"
    PORT                  Set automatically by Railway

Run locally with:

    uvicorn main:app --reload --port 8000
"""

from __future__ import annotations

import math
import os
import re
import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Annotated, Any, Literal

import asyncpg
from fastapi import Depends, FastAPI, Header, HTTPException, status
from pydantic import BaseModel, Field

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

DATABASE_URL = os.environ.get("DATABASE_URL", "")
RAG_SERVICE_TOKEN = os.environ.get("RAG_SERVICE_TOKEN", "")
EMBEDDING_MODEL = os.environ.get("EMBEDDING_MODEL", "text-embedding-3-small")
EMBEDDING_DIM = int(os.environ.get("EMBEDDING_DIM", "1536"))

# Chunking configuration
CHUNK_SIZE = int(os.environ.get("CHUNK_SIZE", "800"))
CHUNK_OVERLAP = int(os.environ.get("CHUNK_OVERLAP", "200"))

# Retrieval configuration
SCORE_THRESHOLD = float(os.environ.get("SCORE_THRESHOLD", "0.35"))
RERANK_KEYWORD_WEIGHT = float(os.environ.get("RERANK_KEYWORD_WEIGHT", "0.15"))

# Embedding provider resolution.
#
# Priority:
#   1. EMBEDDING_API_KEY + EMBEDDING_BASE_URL (explicit override — useful when
#      you want chat on OpenRouter but embeddings on OpenAI direct).
#   2. OPENROUTER_API_KEY (single-key setup — chat + embeddings via OpenRouter).
#   3. OPENAI_API_KEY (legacy / OpenAI direct).
#
# OpenRouter is OpenAI-compatible, so we just swap the base URL.
EMBEDDING_API_KEY = (
    os.environ.get("EMBEDDING_API_KEY")
    or os.environ.get("OPENROUTER_API_KEY")
    or os.environ.get("OPENAI_API_KEY", "")
)
EMBEDDING_BASE_URL = (
    os.environ.get("EMBEDDING_BASE_URL")
    or (
        "https://openrouter.ai/api/v1"
        if os.environ.get("OPENROUTER_API_KEY")
        and not os.environ.get("EMBEDDING_API_KEY")
        else None
    )
)

# Semantic cache configuration
CACHE_ENABLED = os.environ.get("CACHE_ENABLED", "true").lower() == "true"
CACHE_MAX_SIZE = int(os.environ.get("CACHE_MAX_SIZE", "200"))
CACHE_TTL_SECONDS = int(os.environ.get("CACHE_TTL_SECONDS", "300"))  # 5 minutes
CACHE_SIMILARITY_THRESHOLD = float(os.environ.get("CACHE_SIMILARITY_THRESHOLD", "0.92"))


# ---------------------------------------------------------------------------
# Semantic Query Cache
#
# Saves embedding API calls and pgvector queries by caching recent
# query-vector + result pairs. When a new query's cosine similarity to
# a cached query exceeds the threshold, we return cached results directly.
#
# Uses an in-memory LRU approach — no Redis dependency needed since the
# RAG service is a long-running process (not serverless).
# ---------------------------------------------------------------------------

import time
from collections import OrderedDict


def _cosine_sim(a: list[float], b: list[float]) -> float:
    """Fast cosine similarity between two vectors."""
    dot = sum(x * y for x, y in zip(a, b))
    mag_a = math.sqrt(sum(x * x for x in a))
    mag_b = math.sqrt(sum(x * x for x in b))
    if mag_a == 0 or mag_b == 0:
        return 0.0
    return dot / (mag_a * mag_b)


class SemanticCache:
    """
    In-memory LRU cache with semantic similarity matching.

    Each entry stores:
      - cache_key: a composite of scope + filters for exact-match partitioning
      - query_vector: the embedding of the query text
      - results: the retrieval results
      - timestamp: for TTL expiration
    """

    def __init__(
        self,
        max_size: int = CACHE_MAX_SIZE,
        ttl_seconds: int = CACHE_TTL_SECONDS,
        similarity_threshold: float = CACHE_SIMILARITY_THRESHOLD,
    ):
        self.max_size = max_size
        self.ttl_seconds = ttl_seconds
        self.similarity_threshold = similarity_threshold
        self._cache: OrderedDict[str, dict[str, Any]] = OrderedDict()
        self._stats = {"hits": 0, "misses": 0, "evictions": 0}

    def _make_partition_key(
        self,
        user_id: str,
        role: str,
        team_id: str | None,
        source_type: str | None,
        document_id: str | None,
    ) -> str:
        """Partition key ensures we never return results from a different user's scope."""
        return f"{user_id}:{role}:{team_id or ''}:{source_type or ''}:{document_id or ''}"

    def _evict_expired(self) -> None:
        """Remove entries older than TTL."""
        now = time.monotonic()
        keys_to_remove = [
            k for k, v in self._cache.items()
            if now - v["timestamp"] > self.ttl_seconds
        ]
        for k in keys_to_remove:
            del self._cache[k]
            self._stats["evictions"] += 1

    def get(
        self,
        query_vector: list[float],
        user_id: str,
        role: str,
        team_id: str | None = None,
        source_type: str | None = None,
        document_id: str | None = None,
    ) -> list[dict[str, Any]] | None:
        """
        Look for a cached result whose query embedding is semantically
        similar to the new query. Returns None on cache miss.
        """
        if not CACHE_ENABLED:
            return None

        self._evict_expired()
        partition = self._make_partition_key(user_id, role, team_id, source_type, document_id)

        for key, entry in self._cache.items():
            if entry["partition"] != partition:
                continue
            sim = _cosine_sim(query_vector, entry["vector"])
            if sim >= self.similarity_threshold:
                # Cache hit — move to end (most recently used)
                self._cache.move_to_end(key)
                self._stats["hits"] += 1
                return entry["results"]

        self._stats["misses"] += 1
        return None

    def put(
        self,
        query_vector: list[float],
        results: list[dict[str, Any]],
        user_id: str,
        role: str,
        team_id: str | None = None,
        source_type: str | None = None,
        document_id: str | None = None,
    ) -> None:
        """Store a query+results in the cache."""
        if not CACHE_ENABLED:
            return

        partition = self._make_partition_key(user_id, role, team_id, source_type, document_id)
        cache_key = f"{partition}:{id(query_vector)}:{time.monotonic()}"

        # Evict oldest if at capacity
        while len(self._cache) >= self.max_size:
            self._cache.popitem(last=False)
            self._stats["evictions"] += 1

        self._cache[cache_key] = {
            "partition": partition,
            "vector": query_vector,
            "results": results,
            "timestamp": time.monotonic(),
        }

    def invalidate_for_source(self, source_type: str, source_id: str) -> int:
        """
        Invalidate cache entries that might contain results from a
        specific source. Called after index updates.
        """
        keys_to_remove = []
        for key, entry in self._cache.items():
            for result in entry.get("results", []):
                if result.get("source_type") == source_type and result.get("source_id") == source_id:
                    keys_to_remove.append(key)
                    break
        for k in keys_to_remove:
            del self._cache[k]
        return len(keys_to_remove)

    def clear(self) -> None:
        """Clear the entire cache."""
        self._cache.clear()

    @property
    def stats(self) -> dict[str, int]:
        return {**self._stats, "size": len(self._cache)}


# Module-level singleton
_semantic_cache = SemanticCache()


# ---------------------------------------------------------------------------
# Text Chunking
# ---------------------------------------------------------------------------

def chunk_text(text: str, chunk_size: int = CHUNK_SIZE, overlap: int = CHUNK_OVERLAP) -> list[str]:
    """
    Split text into overlapping chunks using LangChain's
    RecursiveCharacterTextSplitter. Falls back to naive splitting if
    LangChain is unavailable.

    Each chunk becomes a separate vector in pgvector, dramatically improving
    retrieval precision for long documents.
    """
    if not text or len(text.strip()) < chunk_size:
        return [text.strip()] if text and text.strip() else []

    try:
        from langchain_text_splitters import RecursiveCharacterTextSplitter

        splitter = RecursiveCharacterTextSplitter(
            chunk_size=chunk_size,
            chunk_overlap=overlap,
            length_function=len,
            separators=["\n\n", "\n", ". ", " ", ""],
        )
        chunks = splitter.split_text(text)
    except ImportError:
        # Fallback: naive split by paragraphs then by size
        chunks = []
        paragraphs = text.split("\n\n")
        current = ""
        for para in paragraphs:
            if len(current) + len(para) + 2 > chunk_size:
                if current.strip():
                    chunks.append(current.strip())
                current = para
            else:
                current = f"{current}\n\n{para}" if current else para
        if current.strip():
            chunks.append(current.strip())

    # Filter out trivially short chunks
    return [c for c in chunks if len(c.strip()) >= 20]


# ---------------------------------------------------------------------------
# Reciprocal Rank Fusion (RRF)
#
# Combines results from multiple retrieval strategies (vector + BM25) into
# a single ranked list. RRF is parameter-free and outperforms simple score
# averaging for heterogeneous scoring systems.
# ---------------------------------------------------------------------------

RRF_K = 60  # Standard RRF constant from the original paper


def reciprocal_rank_fusion(
    *result_lists: list[dict[str, Any]],
    k: int = RRF_K,
) -> list[dict[str, Any]]:
    """
    Merge multiple ranked lists using RRF.
    Each item's fused score = sum(1 / (k + rank_in_list_i)) across all lists.
    Items are identified by their 'id' field.
    """
    fused_scores: dict[str, float] = {}
    item_map: dict[str, dict[str, Any]] = {}

    for result_list in result_lists:
        for rank, item in enumerate(result_list):
            item_id = item["id"]
            fused_scores[item_id] = fused_scores.get(item_id, 0.0) + 1.0 / (k + rank + 1)
            if item_id not in item_map:
                item_map[item_id] = item

    # Sort by fused score descending
    sorted_ids = sorted(fused_scores.keys(), key=lambda x: fused_scores[x], reverse=True)

    results = []
    for item_id in sorted_ids:
        item = item_map[item_id].copy()
        item["score"] = fused_scores[item_id]  # Replace with fused score
        results.append(item)

    return results


# ---------------------------------------------------------------------------
# Keyword Reranker
# ---------------------------------------------------------------------------

def rerank_by_keywords(
    query: str,
    chunks: list[dict[str, Any]],
    keyword_weight: float = RERANK_KEYWORD_WEIGHT,
) -> list[dict[str, Any]]:
    """
    Lightweight reranking: boost chunks that contain exact keyword matches
    from the query. This improves precision without needing a paid
    cross-encoder API.

    Each chunk's final score = (1 - keyword_weight) * vector_score + keyword_weight * keyword_score
    """
    if not chunks or not query.strip():
        return chunks

    # Extract meaningful keywords (3+ chars, lowercased, deduplicated)
    stop_words = {
        "the", "and", "for", "are", "but", "not", "you", "all", "can", "had",
        "her", "was", "one", "our", "out", "has", "have", "from", "with",
        "they", "been", "this", "that", "each", "which", "their", "what",
        "about", "would", "there", "when", "make", "like", "will", "how",
        "show", "give", "tell", "find",
    }
    words = re.findall(r'\b[a-z]{3,}\b', query.lower())
    keywords = [w for w in words if w not in stop_words]

    if not keywords:
        return chunks

    for chunk in chunks:
        snippet_lower = (chunk.get("snippet", "") or "").lower()
        if not snippet_lower:
            continue

        # Count keyword hits as a fraction of total keywords
        hits = sum(1 for kw in keywords if kw in snippet_lower)
        keyword_score = hits / len(keywords)

        # Blend with vector similarity score
        vector_score = chunk.get("score", 0.0)
        chunk["score"] = (1.0 - keyword_weight) * vector_score + keyword_weight * keyword_score

    # Re-sort by blended score
    chunks.sort(key=lambda c: c.get("score", 0.0), reverse=True)
    return chunks


# ---------------------------------------------------------------------------
# Lifespan: open a single asyncpg pool reused across requests
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    if DATABASE_URL:
        import pgvector.asyncpg

        async def init_connection(conn):
            # The vector extension must exist before registering the type
            await conn.execute("CREATE EXTENSION IF NOT EXISTS vector")
            await pgvector.asyncpg.register_vector(conn)

        app.state.pool = await asyncpg.create_pool(
            DATABASE_URL,
            min_size=1,
            max_size=10,
            command_timeout=15,
            init=init_connection,
        )
        # Best-effort schema bootstrap. In production this should be done via
        # versioned migrations (e.g. dbmate, sqitch, or your existing scripts/).
        async with app.state.pool.acquire() as conn:
            await conn.execute(
                f"""
                CREATE TABLE IF NOT EXISTS rag_documents (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    source_type TEXT NOT NULL,
                    source_id TEXT NOT NULL,
                    chunk_index INT NOT NULL DEFAULT 0,
                    team_id TEXT,
                    owner_id TEXT,
                    title TEXT,
                    content TEXT NOT NULL,
                    embedding vector({EMBEDDING_DIM}),
                    metadata JSONB DEFAULT '{{}}'::jsonb,
                    tsv tsvector,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
                """
            )
            # Add tsv column for full-text search if it doesn't exist.
            try:
                await conn.execute(
                    "ALTER TABLE rag_documents ADD COLUMN IF NOT EXISTS tsv tsvector"
                )
            except Exception:
                pass
            # Unique constraint on (source_type, source_id, chunk_index) so
            # re-indexing replaces stale chunks cleanly.
            await conn.execute(
                "CREATE UNIQUE INDEX IF NOT EXISTS rag_documents_source_chunk_uniq "
                "ON rag_documents (source_type, source_id, chunk_index)"
            )
            # Add chunk_index column to existing tables that predate chunking.
            # ALTER TABLE ADD COLUMN IF NOT EXISTS is idempotent.
            try:
                await conn.execute(
                    "ALTER TABLE rag_documents ADD COLUMN IF NOT EXISTS chunk_index INT NOT NULL DEFAULT 0"
                )
            except Exception:
                pass  # Column already exists

            # Drop the old IVFFlat index if it exists — it requires 10k+ rows
            # to be effective and gives worse recall than HNSW at low counts.
            await conn.execute(
                "DROP INDEX IF EXISTS rag_documents_embedding_idx"
            )

            # HNSW index: works well at ANY data size, better recall than
            # IVFFlat, and doesn't need retraining as data grows.
            await conn.execute(
                "CREATE INDEX IF NOT EXISTS rag_documents_embedding_hnsw_idx "
                "ON rag_documents USING hnsw (embedding vector_cosine_ops) "
                "WITH (m = 16, ef_construction = 64)"
            )
            await conn.execute(
                "CREATE INDEX IF NOT EXISTS rag_documents_team_idx ON rag_documents (team_id)"
            )
            await conn.execute(
                "CREATE INDEX IF NOT EXISTS rag_documents_owner_idx ON rag_documents (owner_id)"
            )
            await conn.execute(
                "CREATE INDEX IF NOT EXISTS rag_documents_source_idx ON rag_documents (source_type, source_id)"
            )
            # GIN index for full-text search — enables fast BM25 queries.
            await conn.execute(
                "CREATE INDEX IF NOT EXISTS rag_documents_tsv_idx ON rag_documents USING gin (tsv)"
            )
            await conn.execute(
                """
                CREATE TABLE IF NOT EXISTS rag_query_log (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    user_id TEXT NOT NULL,
                    role TEXT NOT NULL,
                    team_id TEXT,
                    question TEXT NOT NULL,
                    sources INT NOT NULL DEFAULT 0,
                    latency_ms INT NOT NULL DEFAULT 0,
                    tokens_in INT NOT NULL DEFAULT 0,
                    tokens_out INT NOT NULL DEFAULT 0,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
                """
            )

            # Migrate existing data: drop the old unique index that doesn't
            # include chunk_index (if it still exists).
            try:
                await conn.execute("DROP INDEX IF EXISTS rag_documents_source_uniq")
            except Exception:
                pass

        yield
        await app.state.pool.close()
    else:
        # Allow boot without DB so /health remains responsive in CI.
        app.state.pool = None
        yield


app = FastAPI(
    title="Hierarchia RAG Service",
    version="0.3.0",
    lifespan=lifespan,
)


# ---------------------------------------------------------------------------
# Request tracing middleware
#
# Propagates x-request-id from the MCP service (or generates one) and
# logs request/response timing for every endpoint. This enables end-to-end
# trace correlation across the Next.js portal → MCP → RAG pipeline.
# ---------------------------------------------------------------------------

import uuid

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response


class RequestTracingMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        request_id = request.headers.get("x-request-id", str(uuid.uuid4()))
        start = time.monotonic()

        # Make request_id available to route handlers
        request.state.request_id = request_id

        response: Response = await call_next(request)

        elapsed_ms = round((time.monotonic() - start) * 1000, 1)
        response.headers["x-request-id"] = request_id
        response.headers["x-response-time-ms"] = str(elapsed_ms)

        # Log for observability (skip health checks to reduce noise)
        if request.url.path != "/health":
            print(
                f"[rag] [{request_id[:8]}] {request.method} {request.url.path} "
                f"→ {response.status_code} ({elapsed_ms}ms)"
            )

        return response


app.add_middleware(RequestTracingMiddleware)


# ---------------------------------------------------------------------------
# Auth dependency
# ---------------------------------------------------------------------------

def require_bearer(authorization: Annotated[str | None, Header()] = None) -> None:
    if not RAG_SERVICE_TOKEN:
        # In local dev without a token configured, accept everything.
        return
    expected = f"Bearer {RAG_SERVICE_TOKEN}"
    if authorization != expected:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid bearer token",
            headers={"WWW-Authenticate": "Bearer"},
        )


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------

UserRole = Literal["main_admin", "manager", "member"]


class Scope(BaseModel):
    user_id: str
    role: UserRole
    team_id: str | None = None


class IndexRequest(BaseModel):
    """Upsert a single document into pgvector."""
    source_type: str = Field(..., description="e.g. 'submission', 'announcement', 'task'")
    source_id: str
    team_id: str | None = None
    owner_id: str | None = None
    title: str | None = None
    content: str
    metadata: dict[str, Any] = Field(default_factory=dict)


class RetrieveRequest(BaseModel):
    scope: Scope
    query: str
    document_id: str | None = None
    source_type: str | None = Field(
        default=None,
        description="Optional filter to only search within a specific source kind, e.g. 'chat_attachment'.",
    )
    top_k: int = Field(default=6, ge=1, le=20)


class RetrievedChunk(BaseModel):
    id: str
    source_type: str
    source_id: str
    title: str | None
    snippet: str
    score: float
    metadata: dict[str, Any]


class LogQueryRequest(BaseModel):
    scope: Scope
    question: str
    sources: int = 0
    latency_ms: int = 0
    tokens_in: int = 0
    tokens_out: int = 0


# ---------------------------------------------------------------------------
# Embedding helper — singleton cached
#
# The embedder is constructed ONCE at module level and reused across all
# requests. This avoids creating a new HTTP client + TLS handshake per call.
# ---------------------------------------------------------------------------

_embedder_instance = None


def _get_embedder():
    global _embedder_instance
    if _embedder_instance is None:
        from langchain_openai import OpenAIEmbeddings  # type: ignore[import-not-found]

        kwargs: dict[str, Any] = {"model": EMBEDDING_MODEL}
        if EMBEDDING_API_KEY:
            kwargs["api_key"] = EMBEDDING_API_KEY
        if EMBEDDING_BASE_URL:
            kwargs["base_url"] = EMBEDDING_BASE_URL

        _embedder_instance = OpenAIEmbeddings(**kwargs)
    return _embedder_instance


async def embed(text: str) -> list[float]:
    """Embed a single text string."""
    import anyio

    embedder = _get_embedder()
    return await anyio.to_thread.run_sync(embedder.embed_query, text)


async def embed_batch(texts: list[str]) -> list[list[float]]:
    """
    Embed multiple texts in a single API call. Much more efficient than
    calling embed() in a loop — the OpenAI API supports batch embedding
    natively.
    """
    if not texts:
        return []
    if len(texts) == 1:
        return [await embed(texts[0])]

    import anyio

    embedder = _get_embedder()
    return await anyio.to_thread.run_sync(embedder.embed_documents, texts)


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.get("/health")
async def health() -> dict[str, Any]:
    return {
        "ok": True,
        "version": app.version,
        "embedding_model": EMBEDDING_MODEL,
        "embedding_dim": EMBEDDING_DIM,
        "chunking": {"chunk_size": CHUNK_SIZE, "chunk_overlap": CHUNK_OVERLAP},
        "score_threshold": SCORE_THRESHOLD,
        "db": app.state.pool is not None,
        "cache": _semantic_cache.stats if CACHE_ENABLED else {"enabled": False},
    }


@app.post("/v1/index", dependencies=[Depends(require_bearer)])
async def index_document(req: IndexRequest) -> dict[str, Any]:
    if app.state.pool is None:
        raise HTTPException(503, "Database not configured")

    # Split content into chunks for better retrieval precision
    chunks = chunk_text(req.content)
    if not chunks:
        raise HTTPException(400, "Content is too short to index")

    # Batch embed all chunks in a single API call
    vectors = await embed_batch(chunks)

    async with app.state.pool.acquire() as conn:
        # Delete existing chunks for this source before re-indexing.
        # This handles the case where a document shrinks (fewer chunks).
        await conn.execute(
            "DELETE FROM rag_documents WHERE source_type = $1 AND source_id = $2",
            req.source_type,
            req.source_id,
        )

        # Insert all chunks
        inserted_ids = []
        for i, (chunk, vector) in enumerate(zip(chunks, vectors)):
            row = await conn.fetchrow(
                """
                INSERT INTO rag_documents
                    (source_type, source_id, chunk_index, team_id, owner_id,
                     title, content, embedding, metadata, tsv)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb,
                        to_tsvector('english', COALESCE($6, '') || ' ' || $7))
                RETURNING id
                """,
                req.source_type,
                req.source_id,
                i,
                req.team_id,
                req.owner_id,
                req.title,
                chunk,
                vector,
                {**req.metadata, "chunk_index": i, "total_chunks": len(chunks)},
            )
            inserted_ids.append(str(row["id"]))

    # Invalidate cached queries that might have returned this source
    _semantic_cache.invalidate_for_source(req.source_type, req.source_id)

    return {"ok": True, "chunks": len(chunks), "ids": inserted_ids}


@app.delete("/v1/index", dependencies=[Depends(require_bearer)])
async def delete_indexed(source_type: str, source_id: str) -> dict[str, Any]:
    """Remove all chunks for a document from the index. Idempotent."""
    if app.state.pool is None:
        raise HTTPException(503, "Database not configured")
    async with app.state.pool.acquire() as conn:
        result = await conn.execute(
            "DELETE FROM rag_documents WHERE source_type = $1 AND source_id = $2",
            source_type,
            source_id,
        )
    deleted = int(result.split(" ")[-1]) if result.startswith("DELETE") else 0
    if deleted == 0:
        raise HTTPException(404, f"No rows for {source_type}:{source_id}")
    # Purge any cached results that referenced this document
    _semantic_cache.invalidate_for_source(source_type, source_id)
    return {"ok": True, "deleted": deleted}


@app.post("/v1/retrieve", dependencies=[Depends(require_bearer)])
async def retrieve(req: RetrieveRequest) -> list[RetrievedChunk]:
    if app.state.pool is None:
        raise HTTPException(503, "Database not configured")

    vector = await embed(req.query)

    # --- Semantic cache check ---
    cached = _semantic_cache.get(
        query_vector=vector,
        user_id=req.scope.user_id,
        role=req.scope.role,
        team_id=req.scope.team_id,
        source_type=req.source_type,
        document_id=req.document_id,
    )
    if cached is not None:
        return [
            RetrievedChunk(**c) for c in cached
        ]

    # ---- Build scoped WHERE clause (shared by both retrieval paths) ----
    where_clauses: list[str] = []
    scope_params: list[Any] = []
    scope_idx = 1

    is_chat_attachment = req.source_type == "chat_attachment"

    if is_chat_attachment:
        where_clauses.append(f"owner_id = ${scope_idx}")
        scope_params.append(req.scope.user_id)
        scope_idx += 1
    elif req.scope.role == "member":
        where_clauses.append(f"owner_id = ${scope_idx}")
        scope_params.append(req.scope.user_id)
        scope_idx += 1
    elif req.scope.role == "manager" and req.scope.team_id:
        where_clauses.append(f"(team_id = ${scope_idx} OR owner_id = ${scope_idx + 1})")
        scope_params.append(req.scope.team_id)
        scope_params.append(req.scope.user_id)
        scope_idx += 2

    if req.source_type:
        where_clauses.append(f"source_type = ${scope_idx}")
        scope_params.append(req.source_type)
        scope_idx += 1

    if req.document_id:
        where_clauses.append(f"source_id = ${scope_idx}")
        scope_params.append(req.document_id)
        scope_idx += 1

    where_sql = f"WHERE {' AND '.join(where_clauses)}" if where_clauses else ""

    limit_count = req.top_k * 3  # Fetch extra for RRF fusion headroom

    async with app.state.pool.acquire() as conn:
        # ---- Path 1: Vector similarity search (cosine) ----
        vec_idx = scope_idx
        vec_limit_idx = scope_idx + 1
        vec_sql = f"""
            SELECT id, source_type, source_id, title,
                   LEFT(content, 800) AS snippet,
                   metadata,
                   1 - (embedding <=> ${vec_idx}) AS score
            FROM rag_documents
            {where_sql}
            ORDER BY embedding <=> ${vec_idx}
            LIMIT ${vec_limit_idx}
        """
        vector_rows = await conn.fetch(vec_sql, *scope_params, vector, limit_count)

        # ---- Path 2: Full-text BM25 search (tsvector/tsquery) ----
        # Build a tsquery from the user's natural language query.
        # plainto_tsquery handles arbitrary text safely.
        bm25_rows = []
        ts_idx = scope_idx
        ts_limit_idx = scope_idx + 1
        try:
            bm25_where = where_sql
            if bm25_where:
                bm25_where += f" AND tsv @@ plainto_tsquery('english', ${ts_idx})"
            else:
                bm25_where = f"WHERE tsv @@ plainto_tsquery('english', ${ts_idx})"

            bm25_sql = f"""
                SELECT id, source_type, source_id, title,
                       LEFT(content, 800) AS snippet,
                       metadata,
                       ts_rank_cd(tsv, plainto_tsquery('english', ${ts_idx})) AS score
                FROM rag_documents
                {bm25_where}
                ORDER BY score DESC
                LIMIT ${ts_limit_idx}
            """
            bm25_rows = await conn.fetch(bm25_sql, *scope_params, req.query, limit_count)
        except Exception as e:
            # BM25 is best-effort — if tsv column doesn't exist yet, skip
            print(f"[rag] BM25 search failed (non-fatal): {e}")

    # ---- Parse results ----
    def _parse_rows(rows: list) -> list[dict[str, Any]]:
        return [
            {
                "id": str(r["id"]),
                "source_type": r["source_type"],
                "source_id": r["source_id"],
                "title": r["title"],
                "snippet": r["snippet"],
                "score": float(r["score"]),
                "metadata": r["metadata"] or {},
            }
            for r in rows
        ]

    vector_results = [
        c for c in _parse_rows(vector_rows) if c["score"] >= SCORE_THRESHOLD
    ]
    bm25_results = _parse_rows(bm25_rows)

    # ---- Reciprocal Rank Fusion ----
    # Combine vector + BM25 results into a single ranked list.
    if bm25_results:
        fused = reciprocal_rank_fusion(vector_results, bm25_results)
    else:
        fused = vector_results

    # Keyword reranking on the fused results
    reranked = rerank_by_keywords(req.query, fused)

    # Deduplicate by source_id — if multiple chunks from the same
    # document score highly, keep only the best one to give the LLM diverse
    # context. (A user asking about "submission X" shouldn't get 5 chunks
    # from the same submission crowding out other relevant results.)
    seen_sources: set[str] = set()
    deduplicated: list[dict[str, Any]] = []
    for chunk in reranked:
        key = f"{chunk['source_type']}:{chunk['source_id']}"
        if key not in seen_sources:
            seen_sources.add(key)
            deduplicated.append(chunk)
        if len(deduplicated) >= req.top_k:
            break

    final_results = [
        {
            "id": c["id"],
            "source_type": c["source_type"],
            "source_id": c["source_id"],
            "title": c["title"],
            "snippet": c["snippet"],
            "score": c["score"],
            "metadata": c["metadata"],
        }
        for c in deduplicated
    ]

    # --- Cache the results for future similar queries ---
    _semantic_cache.put(
        query_vector=vector,
        results=final_results,
        user_id=req.scope.user_id,
        role=req.scope.role,
        team_id=req.scope.team_id,
        source_type=req.source_type,
        document_id=req.document_id,
    )

    return [
        RetrievedChunk(**c) for c in final_results
    ]


@app.post("/v1/log/query", dependencies=[Depends(require_bearer)])
async def log_query(req: LogQueryRequest) -> dict[str, Any]:
    if app.state.pool is None:
        return {"ok": True, "stored": False}
    async with app.state.pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO rag_query_log
                (user_id, role, team_id, question, sources, latency_ms, tokens_in, tokens_out)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            """,
            req.scope.user_id,
            req.scope.role,
            req.scope.team_id,
            req.question,
            req.sources,
            req.latency_ms,
            req.tokens_in,
            req.tokens_out,
        )
    return {"ok": True, "stored": True}


@app.get("/v1/analytics", dependencies=[Depends(require_bearer)])
async def analytics(
    role: UserRole, user_id: str, team_id: str | None = None
) -> dict[str, Any]:
    if app.state.pool is None:
        raise HTTPException(503, "Database not configured")

    scope_clause = ""
    scope_params: list[Any] = []
    if role == "member":
        scope_clause = "WHERE user_id = $1"
        scope_params.append(user_id)
    elif role == "manager" and team_id:
        scope_clause = "WHERE team_id = $1"
        scope_params.append(team_id)

    async with app.state.pool.acquire() as conn:
        # Index summary scoped the same way as retrieval.
        doc_scope = ""
        doc_params: list[Any] = []
        if role == "member":
            doc_scope = "WHERE owner_id = $1"
            doc_params.append(user_id)
        elif role == "manager" and team_id:
            doc_scope = "WHERE team_id = $1"
            doc_params.append(team_id)

        documents = await conn.fetchval(
            f"SELECT COUNT(DISTINCT source_id) FROM rag_documents {doc_scope}",
            *doc_params,
        ) or 0
        chunks = await conn.fetchval(
            f"SELECT COUNT(*) FROM rag_documents {doc_scope}",
            *doc_params,
        ) or 0
        last_indexed = await conn.fetchval(
            f"SELECT MAX(created_at) FROM rag_documents {doc_scope}",
            *doc_params,
        )

        last_24h = await conn.fetchval(
            f"SELECT COUNT(*) FROM rag_query_log {scope_clause}"
            + (" AND" if scope_clause else "WHERE")
            + " created_at > NOW() - INTERVAL '24 hours'",
            *scope_params,
        ) or 0
        last_7d = await conn.fetchval(
            f"SELECT COUNT(*) FROM rag_query_log {scope_clause}"
            + (" AND" if scope_clause else "WHERE")
            + " created_at > NOW() - INTERVAL '7 days'",
            *scope_params,
        ) or 0
        avg_latency = await conn.fetchval(
            f"SELECT COALESCE(AVG(latency_ms), 0)::int FROM rag_query_log {scope_clause}"
            + (" AND" if scope_clause else "WHERE")
            + " created_at > NOW() - INTERVAL '7 days'",
            *scope_params,
        ) or 0

        # 24-hour bucket for chart.
        timeseries_rows = await conn.fetch(
            f"""
            SELECT date_trunc('hour', created_at) AS ts,
                   COUNT(*)::int AS queries,
                   COALESCE(SUM(tokens_in + tokens_out), 0)::int AS tokens
            FROM rag_query_log
            {scope_clause}
            {"AND" if scope_clause else "WHERE"} created_at > NOW() - INTERVAL '24 hours'
            GROUP BY 1
            ORDER BY 1
            """,
            *scope_params,
        )

        recent_rows = await conn.fetch(
            f"""
            SELECT id, question, role, sources, latency_ms, created_at
            FROM rag_query_log
            {scope_clause}
            ORDER BY created_at DESC
            LIMIT 20
            """,
            *scope_params,
        )

    timeseries = [
        {
            "ts": r["ts"].astimezone(timezone.utc).isoformat(),
            "queries": r["queries"],
            "tokens": r["tokens"],
        }
        for r in timeseries_rows
    ]

    recent_queries = [
        {
            "id": str(r["id"]),
            "question": r["question"],
            "role": r["role"],
            "sources": r["sources"],
            "latency_ms": r["latency_ms"],
            "created_at": r["created_at"].astimezone(timezone.utc).isoformat(),
        }
        for r in recent_rows
    ]

    return {
        "index": {
            "documents": int(documents),
            "chunks": int(chunks),
            "last_indexed_at": last_indexed.astimezone(timezone.utc).isoformat()
            if last_indexed
            else None,
            "embedding_model": EMBEDDING_MODEL,
        },
        "queries": {
            "last_24h": int(last_24h),
            "last_7d": int(last_7d),
            "avg_latency_ms": int(avg_latency),
            "avg_top_k": 6,
        },
        "timeseries": timeseries,
        "top_topics": [],  # populated by a periodic job; left empty here
        "recent_queries": recent_queries,
    }
