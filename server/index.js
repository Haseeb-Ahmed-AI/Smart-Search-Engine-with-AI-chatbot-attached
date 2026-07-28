require("dotenv").config();
const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");
const xml2js = require("xml2js");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "../public")));

const OPENAI_KEY = process.env.OPENAI_API_KEY;
const PORT = process.env.PORT || 3000;

// ── Debug: log key status on startup ─────────────────────────────────────────
console.log("\n🔑  OpenAI key loaded:", OPENAI_KEY ? `sk-...${OPENAI_KEY.slice(-6)}` : "❌ NOT FOUND — check .env");

// ── Helper: call OpenAI ───────────────────────────────────────────────────────
async function openai(messages, temperature = 0) {
  if (!OPENAI_KEY) throw new Error("No OpenAI API key set in .env");

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_KEY}`,
    },
    body: JSON.stringify({ model: process.env.LLM_MODEL || "gpt-4o-mini", temperature, max_tokens: 800, messages }),
  });

  const data = await res.json();
  if (data.error) throw new Error(`OpenAI error: ${data.error.message}`);
  return data.choices?.[0]?.message?.content?.trim() || "";
}

// ── 1. Key check endpoint ─────────────────────────────────────────────────────
app.get("/api/status", (req, res) => {
  res.json({
    keyLoaded: !!OPENAI_KEY,
    keyPreview: OPENAI_KEY ? `sk-...${OPENAI_KEY.slice(-6)}` : null,
  });
});

// ── 2. Spell Correction ───────────────────────────────────────────────────────
app.post("/api/correct", async (req, res) => {
  const { query } = req.body;
  if (!query) return res.json({ corrected: query, changed: false });

  try {
    const corrected = await openai([
      {
        role: "system",
        content:
          "You are a spelling corrector for academic and technical search queries. " +
          "Fix ALL typos and misspellings, especially in AI/ML terms: " +
          "transformers, algorithms, attention, retrieval, augmented generation, " +
          "neural, language model, embeddings, inference, fine-tuning, tokenization, etc. " +
          "Return ONLY the corrected query — no quotes, no explanation, nothing else.",
      },
      { role: "user", content: `Correct: "${query}"` },
    ]);

    const changed = corrected.toLowerCase() !== query.toLowerCase();
    console.log(`✏️  Correction: "${query}" → "${corrected}" (changed: ${changed})`);
    res.json({ corrected, changed, original: query });
  } catch (err) {
    console.error("❌ Correction error:", err.message);
    res.json({ corrected: query, changed: false, error: err.message });
  }
});

// ── 3. arXiv Search ──────────────────────────────────────────────────────────
app.get("/api/search/arxiv", async (req, res) => {
  const { q, k = 5 } = req.query;
  if (!q) return res.json({ papers: [] });

  try {
    const url =
      `https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(q)}` +
      `&start=0&max_results=${k}&sortBy=relevance`;

    console.log("📚 arXiv fetch:", url);
    const response = await fetch(url, { headers: { "User-Agent": "DailyShellPOC/1.0" } });
    const xmlText = await response.text();

    xml2js.parseString(xmlText, { explicitArray: false }, (err, result) => {
      if (err) { console.error("XML parse error:", err); return res.json({ papers: [] }); }

      const feed = result?.feed;
      let entries = feed?.entry || [];
      if (!Array.isArray(entries)) entries = entries ? [entries] : [];

      console.log(`📄 arXiv returned ${entries.length} entries`);

      const papers = entries.slice(0, parseInt(k)).map((e) => ({
        title: (e.title || "").replace(/\s+/g, " ").trim(),
        authors: Array.isArray(e.author)
          ? e.author.slice(0, 3).map((a) => a.name).join(", ")
          : e.author?.name || "Unknown",
        url: Array.isArray(e.id) ? e.id[0] : e.id || "#",
        abstract: (e.summary || "").replace(/\s+/g, " ").trim().slice(0, 500),
        year: (e.published || "").slice(0, 4),
        source: "arXiv",
      }));

      res.json({ papers });
    });
  } catch (err) {
    console.error("❌ arXiv error:", err.message);
    res.json({ papers: [], error: err.message });
  }
});

// ── 4. Semantic Scholar Search ────────────────────────────────────────────────
app.get("/api/search/scholar", async (req, res) => {
  const { q, k = 5 } = req.query;
  if (!q) return res.json({ papers: [] });

  try {
    const url =
      `https://api.semanticscholar.org/graph/v1/paper/search` +
      `?query=${encodeURIComponent(q)}&limit=${k}` +
      `&fields=title,authors,year,abstract,externalIds,openAccessPdf`;

    console.log("🎓 Scholar fetch:", url);
    const response = await fetch(url, {
      headers: {
        "User-Agent": "DailyShellPOC/1.0",
        "Accept": "application/json",
      },
    });

    const text = await response.text();
    console.log("Scholar raw response (first 300):", text.slice(0, 300));
    const data = JSON.parse(text);

    const papers = (data.data || []).slice(0, parseInt(k)).map((p) => {
      const paperId = p.paperId || "";
      const pdfUrl = p.openAccessPdf?.url || null;
      const url = pdfUrl || `https://www.semanticscholar.org/paper/${paperId}`;
      return {
        title: p.title || "Untitled",
        authors: (p.authors || []).slice(0, 3).map((a) => a.name).join(", "),
        url,
        abstract: (p.abstract || "No abstract available.").slice(0, 500),
        year: p.year || "",
        source: "Scholar",
      };
    });

    console.log(`📄 Scholar returned ${papers.length} papers`);
    res.json({ papers });
  } catch (err) {
    console.error("❌ Scholar error:", err.message);
    res.json({ papers: [], error: err.message });
  }
});

// ── 5. AI Insight + Real Relevance Score ──────────────────────────────────────
app.post("/api/insight", async (req, res) => {
  const { query, title, abstract } = req.body;
  if (!query || !title) return res.json({ score: 50, insight: "Could not analyze relevance." });

  try {
    const raw = await openai(
      [
        {
          role: "system",
          content:
            "You are an academic relevance analyst. Given a search query and a paper, " +
            "return ONLY a raw JSON object (no markdown, no fences) with exactly two fields:\n" +
            '  "score": integer from 0 to 100 — how relevant this paper is to the query ' +
            "(0 = completely unrelated, 100 = perfectly on topic, be accurate and vary the scores)\n" +
            '  "insight": one sentence (max 30 words) explaining specifically WHY this paper ' +
            "is or isn't relevant to the query. Be specific, mention concepts from both.",
        },
        {
          role: "user",
          content:
            `Search query: "${query}"\n` +
            `Paper title: "${title}"\n` +
            `Abstract: "${(abstract || "").slice(0, 400)}"`,
        },
      ],
      0.2
    );

    console.log(`🧠 Insight raw for "${title.slice(0, 40)}":`, raw);

    const parsed = JSON.parse(raw.replace(/```json|```/g, "").trim());
    const score = Math.min(100, Math.max(0, parseInt(parsed.score) || 50));

    res.json({ score, insight: parsed.insight || "Relevance could not be determined." });
  } catch (err) {
    console.error("❌ Insight error:", err.message);
    res.json({ score: 50, insight: "AI analysis unavailable — check OpenAI key.", error: err.message });
  }
});

// ── 6. Search Suggestions ────────────────────────────────────────────────────
app.post("/api/suggest", async (req, res) => {
  const { query } = req.body;
  if (!query || query.length < 2) return res.json({ suggestions: [] });

  try {
    const raw = await openai([
      {
        role: "system",
        content:
          "You generate academic search query suggestions like Google autocomplete. " +
          "Given a partial query, return ONLY a raw JSON array of 6 strings — suggested completions. " +
          "Focus on AI, ML, computer science, and research topics. No markdown, no explanation.",
      },
      { role: "user", content: `Partial query: "${query}"` },
    ], 0.7);

    const suggestions = JSON.parse(raw.replace(/```json|```/g, "").trim());
    res.json({ suggestions: Array.isArray(suggestions) ? suggestions.slice(0, 6) : [] });
  } catch (err) {
    console.error("❌ Suggest error:", err.message);
    res.json({ suggestions: [] });
  }
});

// ── 7. Topic Overview (conversational intro before results) ──────────────────
app.post("/api/overview", async (req, res) => {
  const { query } = req.body;
  if (!query) return res.json({ overview: "" });

  try {
    const raw = await openai([
      {
        role: "system",
        content:
          "You are a research assistant inside a newsletter search engine called Daily Shell. " +
          "When a user searches for a topic, you give a friendly, expert overview. " +
          "Return ONLY a raw JSON object (no markdown) with these fields:\n" +
          '  "greeting": one warm sentence like "Sure, I can help you with that! Here are insights on <topic>"\n' +
          '  "explanation": 2-3 sentences explaining what this topic is\n' +
          '  "areas": array of 3 key research areas (strings)\n' +
          '  "gap": one sentence on the current gap or open challenge in this field\n' +
          '  "usefulness": one sentence on why this matters / real-world impact\n' +
          '  "suggestions": array of 4 related refined query strings the user might also search',
      },
      { role: "user", content: `User searched for: "${query}"` },
    ], 0.5);

    const parsed = JSON.parse(raw.replace(/```json|```/g, "").trim());
    res.json(parsed);
  } catch (err) {
    console.error("❌ Overview error:", err.message);
    res.json({ error: err.message });
  }
});

// ── 8. Research Planner Chat ─────────────────────────────────────────────────
app.post("/api/chat", async (req, res) => {
  const { messages, context } = req.body;
  // context = { query, overview, papers } passed from search page

  const systemPrompt =
    "You are a smart research planning assistant inside Daily Shell newsletter. " +
    "You help users plan, structure, and deepen their research on academic topics. " +
    "You can suggest outlines, identify gaps, recommend next steps, explain concepts, " +
    "and help users think through their research strategy. Be concise, insightful, and friendly. " +
    (context?.query
      ? `\n\nThe user came from searching: "${context.query}". ` +
        `They have already seen ${context.papers?.length || 0} papers on this topic. ` +
        `Use this context to give relevant, personalized research planning advice.`
      : "");

  try {
    const raw = await openai(
      [{ role: "system", content: systemPrompt }, ...(messages || [])],
      0.6
    );
    res.json({ reply: raw });
  } catch (err) {
    console.error("❌ Chat error:", err.message);
    res.json({ reply: "Sorry, I ran into an error. Please try again.", error: err.message });
  }
});

// ── Serve frontend ─────────────────────────────────────────────────────────────
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "../public/index.html")));
app.get("/search", (req, res) => res.sendFile(path.join(__dirname, "../public/search.html")));
app.get("/planner", (req, res) => res.sendFile(path.join(__dirname, "../public/planner.html")));
app.get("*", (req, res) => res.sendFile(path.join(__dirname, "../public/index.html")));

app.listen(PORT, () => {
  console.log(`\n✅  Daily Shell Search POC → http://localhost:${PORT}`);
  console.log(`    OpenAI key: ${OPENAI_KEY ? "✅ loaded" : "❌ missing — add to .env"}\n`);
});
// This line intentionally left for appending new routes above the wildcard
