# RAG with LangChain, LangGraph & ChromaDB

A production-style **Retrieval-Augmented Generation (RAG)** application that lets you upload documents from a web UI, embed them into **ChromaDB**, and ask questions grounded in your knowledge base.

Built with **LangChain**, **LangGraph** (Corrective RAG workflow), **ChromaDB**, **OpenAI embeddings**, hybrid retrieval (vector + BM25), and reranking.

---

## Features

- **Persistent ChromaDB storage** — embeddings are saved to a Docker volume and visible in any ChromaDB client/GUI connected to `http://localhost:8000`
- **Frontend file upload** — drag & drop or browse to upload PDF, DOCX, TXT, MD, CSV, JSON, code files, and more
- **Auto-sync to ChromaDB** — uploads and deletions automatically re-index embeddings (no manual step required)
- **Corrective RAG** — LangGraph workflow with document grading, query rewriting, and answer generation
- **Hybrid search** — dense vector search (Chroma) + sparse BM25 keyword search, fused and reranked
- **Access control demo** — tenant/role-based metadata filtering on retrieved chunks

---

## Architecture

```
Browser UI  →  Express API  →  LangGraph (Corrective RAG)
                    ↓                    ↓
              knowledge-base/      ChromaDB (vectors)
                    ↓                    ↓
              index/chunks.json    OpenAI Embeddings
                 (BM25 index)
```

---

## Prerequisites

| Requirement | Version |
|-------------|---------|
| [Node.js](https://nodejs.org/) | 18+ |
| [Docker Desktop](https://www.docker.com/products/docker-desktop/) | Latest (for ChromaDB) |
| [OpenAI API key](https://platform.openai.com/api-keys) | Required |

---

## Quick Start

### 1. Clone the repository

```bash
git clone https://github.com/<your-username>/RAG-with-LangChain-LangGraph-Chroma.git
cd RAG-with-LangChain-LangGraph-Chroma
```

### 2. Start ChromaDB and the Admin GUI

From the **repository root**:

```bash
docker compose up -d
```

This starts:
- **ChromaDB Server** on `http://localhost:8000` (persisting data locally in `./chroma-data/`).
- **ChromaDB Admin GUI** on `http://localhost:3001` (providing a web-based client to inspect collections, documents, metadata, and embeddings).

Verify ChromaDB is running:

```bash
curl http://localhost:8000/api/v1/heartbeat
```

You can open the admin GUI in your browser at `http://localhost:3001` to view your data collections visually.

### 3. Configure environment variables

```bash
cd rag-app
cp .env.example .env
```

Edit `.env` and set your **OpenAI API key**:

```env
OPENAI_API_KEY=sk-your-key-here
CHROMA_URL=http://localhost:8000
CHROMA_COLLECTION=kb_collection
PORT=3000
```

> [!IMPORTANT]
> If you have `CHROMA_API_KEY`, `CHROMA_TENANT`, and `CHROMA_DATABASE` set and active in your `.env` file, the application will connect to **Chroma Cloud** instead of your local dockerized ChromaDB instance. Comment them out if you want to use the local container and inspect data in the local GUI.

### 4. Install dependencies

```bash
npm install
```

### 5. Start the application

```bash
npm run server
```

Open **http://localhost:3000** in your browser.

On first launch, the server auto-indexes any files in `rag-app/knowledge-base/` into ChromaDB.

---

## Using the App

1. **Upload documents** — use the sidebar uploader (drag & drop or browse). **Any** text-based, code, or data file can be uploaded. Files are saved to `knowledge-base/` and embedded into ChromaDB automatically.
2. **Ask questions** — type a question in the main panel. Answers are generated from your uploaded content with source citations.
3. **Sync DB** — manually re-index all files if needed (usually not required after upload/delete).
4. **Delete documents** — remove files from the list; ChromaDB is updated automatically.

### Supported file types

| Type | Extensions |
|------|------------|
| Documents | `.pdf`, `.docx`, `.txt`, `.md`, `.markdown`, `.rtf` |
| Data / Config | `.csv`, `.json`, `.toml`, `.yaml`, `.yml`, `.xml`, `.ini`, `.config` |
| Web / markup | `.html`, `.htm`, `.xml` |
| Code / scripts | `.js`, `.ts`, `.jsx`, `.tsx`, `.py`, `.java`, `.css`, `.sh`, `.bat`, `.sql`, `.log`, etc. |

Binary files (images, archives, executables) are automatically skipped during indexing.

---

## Viewing data in ChromaDB

After indexing, open the local ChromaDB Admin GUI:

- **GUI URL:** `http://localhost:3001` (Auto-connected to Chroma DB container)
- **ChromaDB Server:** `http://localhost:8000`
- **Collection name:** `kb_collection` (or value of `CHROMA_COLLECTION` in `.env`)
- **Check chunk count from the app:** `GET http://localhost:3000/api/chroma/status`

You can also use other third-party tools or curl:

```bash
curl http://localhost:8000/api/v1/collections
```

---

## CLI usage

From `rag-app/`:

```bash
# Index all files in knowledge-base/ into ChromaDB
npm run index

# Ask a question from the terminal
npm run dev "What is the refund window?"
```

---

## Project structure

```
RAG-with-LangChain-LangGraph-Chroma/
├── docker-compose.yml          # ChromaDB persistent server
├── chroma-data/                # ChromaDB volume (gitignored)
├── README.md
└── rag-app/
    ├── knowledge-base/         # Uploaded / sample documents
    ├── public/                 # Frontend (HTML, CSS, JS)
    ├── src/
    │   ├── embeddings/         # OpenAI embedding config
    │   ├── graph/              # LangGraph Corrective RAG
    │   ├── indexing/           # BM25 keyword index
    │   ├── loaders/            # Document loaders (PDF, DOCX, etc.)
    │   ├── retrievers/         # Hybrid + secure retrievers
    │   ├── splitters/          # Text chunking
    │   ├── vectorstore/        # ChromaDB integration
    │   ├── index.ts            # Core index + ask logic
    │   └── server.ts           # Express API + static frontend
    ├── .env.example
    └── package.json
```

---

## API endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/chroma/status` | ChromaDB health and collection stats |
| `GET` | `/api/documents` | List uploaded files |
| `POST` | `/api/documents` | Upload a file (auto-indexes) |
| `DELETE` | `/api/documents/:filename` | Delete a file (auto re-indexes) |
| `POST` | `/api/index` | Manually re-index all files |
| `POST` | `/api/query` | Ask a question |

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| `ChromaDB is not running` | Run `docker compose up -d` from repo root |
| `OPENAI_API_KEY is not configured` | Copy `.env.example` to `.env` and add your key |
| Empty answers / no sources | Upload documents first; check `/api/chroma/status` for chunk count |
| Port 8000 in use | Change Chroma port in `docker-compose.yml` and set `CHROMA_URL` accordingly |

---

## License

MIT
