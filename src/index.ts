import { DurableObject } from "cloudflare:workers";

interface Env {
  FeedbackAgent: DurableObjectNamespace<FeedbackAnalysisAgent>;
  AI: Ai;
}

interface FeedbackItem {
  id: string;
  source: string;
  content: string;
  timestamp: string;
  sentiment?: "positive" | "neutral" | "negative";
  themes?: string[];
  score?: number;
  metadata?: Record<string, string>;
}

export class FeedbackAnalysisAgent extends DurableObject<Env> {
  private sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.initDatabase();
  }

  private initDatabase() {
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS feedback (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        content TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        sentiment TEXT,
        score REAL,
        themes TEXT,
        metadata TEXT
      )
    `);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      if (path === "/ingest" && request.method === "POST") {
        const body = (await request.json()) as { feedback: Omit<FeedbackItem, "id">[] };
        const results = await this.ingestFeedback(body.feedback);
        return Response.json({ success: true, processed: results.length }, { headers: corsHeaders });
      }

      if (path === "/dashboard" || path === "/") {
        const data = this.getDashboardData();
        return Response.json(data, { headers: corsHeaders });
      }

      if (path === "/feedback") {
        const limit = parseInt(url.searchParams.get("limit") || "50");
        const feedback = this.getRecentFeedback(limit);
        return Response.json({ feedback }, { headers: corsHeaders });
      }

      if (path === "/ask" && request.method === "POST") {
        const { question } = (await request.json()) as { question: string };
        const answer = await this.askAboutFeedback(question);
        return Response.json({ answer }, { headers: corsHeaders });
      }

      if (path === "/summary") {
        const days = parseInt(url.searchParams.get("days") || "7");
        const summary = await this.generateSummary(days);
        return Response.json({ summary }, { headers: corsHeaders });
      }

      if (path === "/trends") {
        const days = parseInt(url.searchParams.get("days") || "30");
        const trends = this.getTrends(days);
        return Response.json(trends, { headers: corsHeaders });
      }

      return Response.json({ error: "Not found" }, { status: 404, headers: corsHeaders });
    } catch (error) {
      console.error("Request error:", error);
      return Response.json(
        { error: error instanceof Error ? error.message : "Unknown error" },
        { status: 500, headers: corsHeaders }
      );
    }
  }

  async ingestFeedback(items: Omit<FeedbackItem, "id">[]): Promise<FeedbackItem[]> {
    const processed: FeedbackItem[] = [];

    for (const item of items) {
      const id = crypto.randomUUID();

      let sentiment: "positive" | "neutral" | "negative" = "neutral";
      let score = 5;
      let themes: string[] = [];

      try {
        const response = await this.env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
          messages: [
            {
              role: "system",
              content: `You analyze feedback. Return ONLY valid JSON with no other text:
{"sentiment":"positive|neutral|negative","score":0-10,"themes":["theme1","theme2"]}

Rules:
- sentiment: positive (happy/praise), negative (complaints/issues), neutral (mixed/factual)
- score: 0=very negative, 5=neutral, 10=very positive
- themes: 1-3 short keywords describing main topics`,
            },
            { role: "user", content: item.content },
          ],
        });

        const text = (response as { response?: string }).response || "";
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          sentiment = parsed.sentiment || "neutral";
          score = typeof parsed.score === "number" ? parsed.score : 5;
          themes = Array.isArray(parsed.themes) ? parsed.themes : [];
        }
      } catch (e) {
        console.error("Failed to analyze feedback:", e);
      }

      const feedback: FeedbackItem = { id, ...item, sentiment, score, themes };

      this.sql.exec(
        `INSERT INTO feedback (id, source, content, timestamp, sentiment, score, themes, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        id,
        item.source,
        item.content,
        item.timestamp,
        sentiment,
        score,
        JSON.stringify(themes),
        JSON.stringify(item.metadata || {})
      );

      processed.push(feedback);
    }

    return processed;
  }

  getRecentFeedback(limit: number): FeedbackItem[] {
    const rows = this.sql.exec(`SELECT * FROM feedback ORDER BY timestamp DESC LIMIT ?`, limit).toArray();

    return rows.map((row: any) => ({
      id: row.id,
      source: row.source,
      content: row.content,
      timestamp: row.timestamp,
      sentiment: row.sentiment as "positive" | "neutral" | "negative",
      score: row.score,
      themes: JSON.parse(row.themes || "[]"),
      metadata: JSON.parse(row.metadata || "{}"),
    }));
  }

  getDashboardData() {
    const sentimentCounts = { positive: 0, neutral: 0, negative: 0 };

    const countRows = this.sql.exec(`SELECT sentiment, COUNT(*) as count FROM feedback GROUP BY sentiment`).toArray();
    for (const row of countRows as any[]) {
      if (row.sentiment in sentimentCounts) {
        sentimentCounts[row.sentiment as keyof typeof sentimentCounts] = Number(row.count);
      }
    }

    const scoreRows = this.sql.exec(`SELECT AVG(score) as avg_score FROM feedback`).toArray();
    const avgScore = (scoreRows[0] as any)?.avg_score || 0;

    const feedback = this.getRecentFeedback(100);
    const themeCounts: Record<string, number> = {};
    for (const item of feedback) {
      for (const theme of item.themes || []) {
        themeCounts[theme] = (themeCounts[theme] || 0) + 1;
      }
    }
    const topThemes = Object.entries(themeCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([theme, count]) => ({ theme, count }));

    // Get sentiment over time for the trend line
    const sentimentTrendRows = this.sql
      .exec(
        `SELECT DATE(timestamp) as date, 
          AVG(score) as avg_score,
          COUNT(*) as total
         FROM feedback WHERE timestamp > DATE('now', '-30 days')
         GROUP BY DATE(timestamp) ORDER BY date`
      )
      .toArray();

    const sentimentTrend = (sentimentTrendRows as any[]).map((row) => ({
      date: row.date,
      avgScore: Math.round(Number(row.avg_score) * 10) / 10,
      total: Number(row.total),
    }));

    // Get theme trends - which themes are improving or getting worse
    const themeTrends: Record<string, { positive: number; negative: number; total: number; trend: string }> = {};
    for (const item of feedback) {
      for (const theme of item.themes || []) {
        if (!themeTrends[theme]) {
          themeTrends[theme] = { positive: 0, negative: 0, total: 0, trend: 'stable' };
        }
        themeTrends[theme].total++;
        if (item.sentiment === 'positive') themeTrends[theme].positive++;
        if (item.sentiment === 'negative') themeTrends[theme].negative++;
      }
    }

    // Calculate sentiment ratio for each theme
    const themeHealth = Object.entries(themeTrends)
      .map(([theme, data]) => ({
        theme,
        total: data.total,
        positive: data.positive,
        negative: data.negative,
        score: data.total > 0 ? Math.round(((data.positive - data.negative) / data.total) * 100) : 0,
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 10);

    const sourceRows = this.sql.exec(`SELECT source, COUNT(*) as count FROM feedback GROUP BY source`).toArray();
    const sourceBreakdown = (sourceRows as any[]).map((row) => ({
      source: row.source,
      count: Number(row.count),
    }));

    return {
      totalFeedback: sentimentCounts.positive + sentimentCounts.neutral + sentimentCounts.negative,
      sentimentCounts,
      averageScore: Math.round(avgScore * 10) / 10,
      topThemes,
      sentimentTrend,
      themeHealth,
      sourceBreakdown,
      recentFeedback: feedback.slice(0, 10),
    };
  }

  async askAboutFeedback(question: string): Promise<string> {
    const feedback = this.getRecentFeedback(30);

    const context = feedback.map((f) => `[${f.sentiment}, score:${f.score}] (${f.source}): ${f.content}`).join("\n");

    const response = await this.env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
      messages: [
        {
          role: "system",
          content: `You are a feedback analysis assistant. Answer questions based on the feedback data. Be specific, cite examples, and provide actionable insights.`,
        },
        {
          role: "user",
          content: `Feedback data:\n${context}\n\nQuestion: ${question}`,
        },
      ],
    });

    return (response as { response?: string }).response || "Unable to generate response";
  }

  async generateSummary(days: number): Promise<string> {
    const feedback = this.getRecentFeedback(100);
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const filtered = feedback.filter((f) => f.timestamp >= cutoff);

    if (filtered.length === 0) {
      return `No feedback received in the last ${days} days.`;
    }

    const context = filtered.map((f) => `[${f.sentiment}, score:${f.score}] (${f.source}): ${f.content}`).join("\n");

    const response = await this.env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
      messages: [
        {
          role: "system",
          content: `Generate an executive summary of user feedback. Include:
1. Overall sentiment (what % positive/negative)
2. Key themes and patterns
3. Notable praise (what users love)
4. Areas for improvement (common complaints)
5. Top 3 recommended action items

Be concise but specific.`,
        },
        {
          role: "user",
          content: `Summarize ${filtered.length} feedback items from the last ${days} days:\n\n${context}`,
        },
      ],
    });

    return (response as { response?: string }).response || "Unable to generate summary";
  }

  getTrends(days: number) {
    const rows = this.sql
      .exec(
        `SELECT DATE(timestamp) as date, COUNT(*) as total,
          SUM(CASE WHEN sentiment = 'positive' THEN 1 ELSE 0 END) as positive,
          SUM(CASE WHEN sentiment = 'negative' THEN 1 ELSE 0 END) as negative,
          AVG(score) as avg_score
         FROM feedback WHERE timestamp > DATE('now', '-' || ? || ' days')
         GROUP BY DATE(timestamp) ORDER BY date`,
        days
      )
      .toArray();

    return {
      trends: (rows as any[]).map((row) => ({
        date: row.date,
        total: Number(row.total),
        positive: Number(row.positive),
        negative: Number(row.negative),
        avgScore: Math.round(Number(row.avg_score) * 10) / 10,
      })),
    };
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/" || url.pathname === "/dashboard") {
      return new Response(getDashboardHTML(), { headers: { "Content-Type": "text/html" } });
    }

    if (url.pathname.startsWith("/api")) {
      const id = env.FeedbackAgent.idFromName("main");
      const agent = env.FeedbackAgent.get(id);
      const newUrl = new URL(request.url);
      newUrl.pathname = url.pathname.replace("/api", "");
      return agent.fetch(new Request(newUrl, request));
    }

    return Response.json({ error: "Not found" }, { status: 404 });
  },
} satisfies ExportedHandler<Env>;

function getDashboardHTML(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Feedback Analysis Dashboard</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
</head>
<body class="bg-gray-900 text-white min-h-screen">
  <div id="root"></div>
  <script src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
  <script src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
  <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
  <script type="text/babel">
    const { useState, useEffect, useRef } = React;

    function App() {
      const [data, setData] = useState(null);
      const [loading, setLoading] = useState(true);
      const [question, setQuestion] = useState('');
      const [answer, setAnswer] = useState('');
      const [asking, setAsking] = useState(false);
      const [summary, setSummary] = useState('');
      const [showSummary, setShowSummary] = useState(false);
      const chartRef = useRef(null);
      const chartInstance = useRef(null);

      useEffect(() => {
        fetchDashboard();
        const interval = setInterval(fetchDashboard, 30000);
        return () => clearInterval(interval);
      }, []);

      useEffect(() => {
        if (data?.sentimentTrend?.length && chartRef.current) {
          if (chartInstance.current) chartInstance.current.destroy();
          chartInstance.current = new Chart(chartRef.current.getContext('2d'), {
            type: 'line',
            data: {
              labels: data.sentimentTrend.map(d => d.date),
              datasets: [{
                label: 'Satisfaction Score',
                data: data.sentimentTrend.map(d => d.avgScore),
                borderColor: '#3b82f6',
                backgroundColor: 'rgba(59,130,246,0.1)',
                fill: true,
                tension: 0.4,
                pointBackgroundColor: data.sentimentTrend.map(d => 
                  d.avgScore >= 7 ? '#22c55e' : d.avgScore >= 4 ? '#eab308' : '#ef4444'
                ),
                pointRadius: 6,
                pointHoverRadius: 8
              }]
            },
            options: {
              responsive: true,
              maintainAspectRatio: false,
              plugins: { 
                legend: { labels: { color: '#fff' } },
                tooltip: {
                  callbacks: {
                    afterLabel: function(context) {
                      const idx = context.dataIndex;
                      return 'Feedback count: ' + data.sentimentTrend[idx].total;
                    }
                  }
                }
              },
              scales: {
                x: { ticks: { color: '#9ca3af' }, grid: { color: '#374151' } },
                y: { 
                  min: 0, 
                  max: 10, 
                  ticks: { color: '#9ca3af' }, 
                  grid: { color: '#374151' },
                  title: { display: true, text: 'Avg Score (0-10)', color: '#9ca3af' }
                }
              }
            }
          });
        }
      }, [data?.sentimentTrend]);

      async function fetchDashboard() {
        try {
          setData(await (await fetch('/api/dashboard')).json());
        } catch (e) {
          console.error('Failed to fetch:', e);
        } finally {
          setLoading(false);
        }
      }

      async function askQuestion(e) {
        e.preventDefault();
        if (!question.trim()) return;
        setAsking(true);
        try {
          setAnswer((await (await fetch('/api/ask', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ question })
          })).json()).answer);
        } catch (e) {
          setAnswer('Error: ' + e.message);
        } finally {
          setAsking(false);
        }
      }

      async function fetchSummary() {
        setShowSummary(true);
        setSummary('');
        try {
          setSummary((await (await fetch('/api/summary?days=7')).json()).summary);
        } catch (e) {
          setSummary('Error generating summary');
        }
      }

      if (loading) return <div className="flex items-center justify-center min-h-screen"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div></div>;

      const colors = { positive: 'bg-green-500', neutral: 'bg-yellow-500', negative: 'bg-red-500' };

      return (
        <div className="p-6 max-w-7xl mx-auto">
          <header className="mb-8">
            <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent">Feedback Analysis Dashboard</h1>
            <p className="text-gray-400 mt-2">AI-powered insights from your feedback</p>
          </header>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
            <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
              <p className="text-gray-400 text-sm">Total Feedback</p>
              <p className="text-3xl font-bold mt-2">{data?.totalFeedback || 0}</p>
            </div>
            <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
              <p className="text-gray-400 text-sm">Average Score</p>
              <p className="text-3xl font-bold mt-2 text-blue-400">{data?.averageScore || 0}/10</p>
            </div>
            <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
              <p className="text-gray-400 text-sm">Positive Rate</p>
              <p className="text-3xl font-bold mt-2 text-green-400">{data?.totalFeedback ? Math.round((data.sentimentCounts.positive / data.totalFeedback) * 100) : 0}%</p>
            </div>
            <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
              <p className="text-gray-400 text-sm">Negative Rate</p>
              <p className="text-3xl font-bold mt-2 text-red-400">{data?.totalFeedback ? Math.round((data.sentimentCounts.negative / data.totalFeedback) * 100) : 0}%</p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
            <div className="lg:col-span-2 bg-gray-800 rounded-xl p-6 border border-gray-700">
              <h2 className="text-lg font-semibold mb-4">Overall Satisfaction Trend</h2>
              <div className="h-64"><canvas ref={chartRef}></canvas></div>
              <div className="flex justify-center gap-4 mt-3 text-xs">
                <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-green-500"></span> Good (7-10)</span>
                <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-yellow-500"></span> Mixed (4-6)</span>
                <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-red-500"></span> Poor (0-3)</span>
              </div>
            </div>
            <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
              <h2 className="text-lg font-semibold mb-4">Theme Health</h2>
              <p className="text-gray-500 text-xs mb-3">How people feel about each topic</p>
              <div className="space-y-3">
                {data?.themeHealth?.slice(0, 8).map((t, i) => (
                  <div key={i} className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-gray-300 text-sm">{t.theme}</span>
                      <span className={"text-sm font-medium " + (t.score > 20 ? "text-green-400" : t.score < -20 ? "text-red-400" : "text-yellow-400")}>
                        {t.score > 0 ? '+' : ''}{t.score}%
                      </span>
                    </div>
                    <div className="w-full bg-gray-700 rounded-full h-2">
                      <div 
                        className={"h-2 rounded-full " + (t.score > 20 ? "bg-green-500" : t.score < -20 ? "bg-red-500" : "bg-yellow-500")}
                        style={{width: Math.min(100, Math.abs(t.score) + 50) + '%'}}
                      ></div>
                    </div>
                    <div className="flex justify-between text-xs text-gray-500">
                      <span>{t.positive} positive</span>
                      <span>{t.negative} negative</span>
                    </div>
                  </div>
                ))}
                {(!data?.themeHealth?.length) && <p className="text-gray-500">No themes yet</p>}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
            <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
              <h2 className="text-lg font-semibold mb-4">Ask AI About Feedback</h2>
              <form onSubmit={askQuestion} className="space-y-4">
                <input type="text" value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="e.g., What are the main complaints?" className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                <button type="submit" disabled={asking} className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 rounded-lg px-4 py-3 font-medium transition">{asking ? 'Analyzing...' : 'Ask'}</button>
              </form>
              {answer && <div className="mt-4 p-4 bg-gray-700/50 rounded-lg"><p className="text-gray-300 whitespace-pre-wrap">{answer}</p></div>}
            </div>
            <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold">Executive Summary</h2>
                <button onClick={fetchSummary} className="text-sm bg-purple-600 hover:bg-purple-700 px-3 py-1 rounded transition">Generate Report</button>
              </div>
              {showSummary && <div className="p-4 bg-gray-700/50 rounded-lg max-h-64 overflow-y-auto">{summary ? <p className="text-gray-300 whitespace-pre-wrap text-sm">{summary}</p> : <div className="flex items-center space-x-2"><div className="animate-spin rounded-full h-4 w-4 border-b-2 border-purple-500"></div><span className="text-gray-400">Generating...</span></div>}</div>}
            </div>
          </div>

          <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
            <h2 className="text-lg font-semibold mb-4">Recent Feedback</h2>
            <div className="space-y-3 max-h-96 overflow-y-auto">
              {data?.recentFeedback?.map((f, i) => (
                <div key={i} className="p-4 bg-gray-700/50 rounded-lg">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center space-x-2">
                      <span className={"w-2 h-2 rounded-full " + colors[f.sentiment]}></span>
                      <span className="text-gray-400 text-sm">{f.source}</span>
                    </div>
                    <span className="text-gray-500 text-sm">{new Date(f.timestamp).toLocaleDateString()}</span>
                  </div>
                  <p className="text-gray-300">{f.content}</p>
                  <div className="flex items-center space-x-2 mt-2">
                    {f.themes?.map((theme, j) => <span key={j} className="text-xs bg-gray-600 px-2 py-1 rounded">{theme}</span>)}
                    <span className="text-xs text-gray-500 ml-auto">Score: {f.score}/10</span>
                  </div>
                </div>
              ))}
              {(!data?.recentFeedback?.length) && <p className="text-gray-500 text-center py-8">No feedback yet.</p>}
            </div>
          </div>
        </div>
      );
    }

    ReactDOM.createRoot(document.getElementById('root')).render(<App />);
  </script>
</body>
</html>`;
}