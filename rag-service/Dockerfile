# syntax=docker/dockerfile:1.6
#
# Hierarchia RAG service — production image for Railway.
# Slim Python base, pip cache mounted as a build cache for fast rebuilds.
#
FROM python:3.12-slim AS base

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# System deps required by some langchain dependencies (e.g. PIL, tiktoken).
RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential libpq-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY . .

EXPOSE 8000

# Railway sets $PORT — fall back to 8000 in local Docker runs.
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]
