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
                                       │                            └─ LangGraph retrieval workflow
                                       │
                                       └─ AI Gateway / model providers (LLM completions)

The RAG service never returns LLM completions itself — orchestration of
the chat turn happens in the MCP service, which uses LangGraph to compose:

    1. POST /v1/retrieve   → top-k pgvector chunks for the user's question
    2. (optional) POST /v1/rerank
    3. LLM completion in MCP land
    4. POST /v1/log/query  → audit trail + analytics counters

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

import os
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


# ---------------------------------------------------------------------------
# Lifespan: open a single asyncpg pool reused across requests
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    if DATABASE_URL:
        app.state.pool = await asyncpg.create_pool(
            DATABASE_URL,
            min_size=1,
            max_size=10,
            command_timeout=15,
        )
        # Best-effort schema bootstrap. In production this should be done via
        # versioned migrations (e.g. dbmate, sqitch, or your existing scripts/).
        async with app.state.pool.acquire() as conn:
            await conn.execute("CREATE EXTENSION IF NOT EXISTS vector")
            await conn.execute(
                f"""
                CREATE TABLE IF NOT EXISTS rag_documents (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    source_type TEXT NOT NULL,
                    source_id TEXT NOT NULL,
                    team_id TEXT,
                    owner_id TEXT,
                    title TEXT,
                    content TEXT NOT NULL,
                    embedding vector({EMBEDDING_DIM}),
                    metadata JSONB DEFAULT '{{}}'::jsonb,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
                """
            )
            # The upsert in /v1/index relies on this unique pair; without it
            # ON CONFLICT silently inserts duplicates. CREATE UNIQUE INDEX IF
            # NOT EXISTS is idempotent so this is safe to run on every boot
            # AND on tables that pre-date this column add.
            await conn.execute(
                "CREATE UNIQUE INDEX IF NOT EXISTS rag_documents_source_uniq "
                "ON rag_documents (source_type, source_id)"
            )
            await conn.execute(
                "CREATE INDEX IF NOT EXISTS rag_documents_team_idx ON rag_documents (team_id)"
            )
            await conn.execute(
                "CREATE INDEX IF NOT EXISTS rag_documents_owner_idx ON rag_documents (owner_id)"
            )
            await conn.execute(
                "CREATE INDEX IF NOT EXISTS rag_documents_embedding_idx "
                "ON rag_documents USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100)"
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
        yield
        await app.state.pool.close()
    else:
        # Allow boot without DB so /health remains responsive in CI.
        app.state.pool = None
        yield


app = FastAPI(
    title="Hierarchia RAG Service",
    version="0.1.0",
    lifespan=lifespan,
)


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
# Embedding helper
#
# We import lazily so the service can boot in environments without OpenAI
# credentials (e.g. health checks during the first deploy).
# ---------------------------------------------------------------------------

async def embed(text: str) -> list[float]:
    from langchain_openai import OpenAIEmbeddings  # type: ignore[import-not-found]

    kwargs: dict[str, Any] = {"model": EMBEDDING_MODEL}
    if EMBEDDING_API_KEY:
        kwargs["api_key"] = EMBEDDING_API_KEY
    if EMBEDDING_BASE_URL:
        kwargs["base_url"] = EMBEDDING_BASE_URL

    embedder = OpenAIEmbeddings(**kwargs)
    # langchain's embed_query is sync; offload to a thread to avoid blocking
    import anyio

    return await anyio.to_thread.run_sync(embedder.embed_query, text)


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
        "db": app.state.pool is not None,
    }


@app.post("/v1/index", dependencies=[Depends(require_bearer)])
async def index_document(req: IndexRequest) -> dict[str, Any]:
    if app.state.pool is None:
        raise HTTPException(503, "Database not configured")
    vector = await embed(req.content)
    async with app.state.pool.acquire() as conn:
        # Upsert by (source_type, source_id) so re-indexing replaces stale rows.
        row = await conn.fetchrow(
            """
            INSERT INTO rag_documents
                (source_type, source_id, team_id, owner_id, title, content, embedding, metadata)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
            ON CONFLICT (source_type, source_id) DO UPDATE
                SET team_id = EXCLUDED.team_id,
                    owner_id = EXCLUDED.owner_id,
                    title = EXCLUDED.title,
                    content = EXCLUDED.content,
                    embedding = EXCLUDED.embedding,
                    metadata = EXCLUDED.metadata,
                    updated_at = NOW()
            RETURNING id
            """,
            req.source_type,
            req.source_id,
            req.team_id,
            req.owner_id,
            req.title,
            req.content,
            vector,
            req.metadata,
        )
    return {"ok": True, "id": str(row["id"])}


@app.delete("/v1/index", dependencies=[Depends(require_bearer)])
async def delete_indexed(source_type: str, source_id: str) -> dict[str, Any]:
    """Remove a single document from the index. Idempotent: 404 only when
    the row genuinely doesn't exist, so the portal doesn't have to track
    whether something was previously indexed."""
    if app.state.pool is None:
        raise HTTPException(503, "Database not configured")
    async with app.state.pool.acquire() as conn:
        result = await conn.execute(
            "DELETE FROM rag_documents WHERE source_type = $1 AND source_id = $2",
            source_type,
            source_id,
        )
    # asyncpg returns "DELETE <n>"; treat 0 rows as a soft 404 so callers
    # can distinguish "wasn't there" from "deleted".
    deleted = int(result.split(" ")[-1]) if result.startswith("DELETE") else 0
    if deleted == 0:
        raise HTTPException(404, f"No row for {source_type}:{source_id}")
    return {"ok": True, "deleted": deleted}


@app.post("/v1/retrieve", dependencies=[Depends(require_bearer)])
async def retrieve(req: RetrieveRequest) -> list[RetrievedChunk]:
    if app.state.pool is None:
        raise HTTPException(503, "Database not configured")
    vector = await embed(req.query)

    # Role-scoped row filtering — mirrors the Supabase RLS philosophy used in
    # the Next.js app: members see only their own docs, managers their team's,
    # admins everything.
    where_clauses = []
    params: list[Any] = [vector, req.top_k]
    idx = 3
    if req.scope.role == "member":
        where_clauses.append(f"owner_id = ${idx}")
        params.append(req.scope.user_id)
        idx += 1
    elif req.scope.role == "manager" and req.scope.team_id:
        where_clauses.append(f"team_id = ${idx}")
        params.append(req.scope.team_id)
        idx += 1
        
    if req.document_id:
        where_clauses.append(f"source_id = ${idx}")
        params.append(req.document_id)
        idx += 1

    where = f"WHERE {' AND '.join(where_clauses)}" if where_clauses else ""

    sql = f"""
        SELECT id, source_type, source_id, title,
               LEFT(content, 600) AS snippet,
               metadata,
               1 - (embedding <=> $1) AS score
        FROM rag_documents
        {where}
        ORDER BY embedding <=> $1
        LIMIT $2
    """
    async with app.state.pool.acquire() as conn:
        rows = await conn.fetch(sql, *params)

    return [
        RetrievedChunk(
            id=str(r["id"]),
            source_type=r["source_type"],
            source_id=r["source_id"],
            title=r["title"],
            snippet=r["snippet"],
            score=float(r["score"]),
            metadata=r["metadata"] or {},
        )
        for r in rows
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
