# Daily Shell — Research Search POC (Part 1)

AI-powered research search with spell correction, relevance scoring, and paper insights.

---

## What this does

1. **AI Spell Correction** — User types a messy query like `llm algortohum`. OpenAI corrects it to `llm algorithms` before searching. A banner shows the correction.
2. **Paper Search** — Pulls real papers from arXiv or Semantic Scholar (free, no key needed).
3. **Relevance Score** — Each result gets a 0–100% relevance score calculated by AI.
4. **AI Insight** — A one-sentence explanation of *why* that paper is relevant to the query.
5. **Top-K Control** — User picks how many results to show (3 / 5 / 8 / 10).

---

## Requirements

- Node.js v18+ ([download](https://nodejs.org))
- An OpenAI API Key ([get one here](https://platform.openai.com/api-keys))

---

## Setup — 3 steps

### 1. Install dependencies
```bash
cd daily-shell-search-poc
npm install
```

### 2. Add your OpenAI key
Open the `.env` file and replace `sk-proj-YOUR_OPENAI_KEY_HERE` with your actual key:

```
OPENAI_API_KEY=sk-proj-xxxxxxxxxxxxxxxxxxxxxxxx
```

### 3. Start the server
```bash
npm start
```

Then open your browser at: **http://localhost:3000**

---

## Try these test queries (intentionally misspelled)

| Typed by user | AI corrects to |
|---|---|
| `llm algortohum` | `llm algorithm` |
| `trnasformer attension` | `transformer attention` |
| `retrevial augmented genration` | `retrieval augmented generation` |
| `nueral netwrok traning` | `neural network training` |
| `vektor embedings semantc serch` | `vector embeddings semantic search` |

---

## Project structure

```
daily-shell-search-poc/
├── server/
│   └── index.js       ← Express backend (API routes + key handling)
├── public/
│   └── index.html     ← Frontend UI (search bar, results, insights)
├── .env               ← Your API keys go here (never commit this)
├── package.json
└── README.md
```

---

## APIs used

| API | Key needed? | Cost |
|---|---|---|
| OpenAI (GPT-4o-mini) | ✅ Yes — client provides | ~$0.001 per search |
| arXiv | ❌ None | Free |
| Semantic Scholar | ❌ None | Free |

---

## For development (auto-reload on save)
```bash
npm run dev
```
Requires `nodemon` (already in devDependencies).
