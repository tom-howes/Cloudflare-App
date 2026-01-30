\# Feedback Analysis Agent



An AI-powered feedback aggregation and analysis tool built on Cloudflare's Developer Platform. This tool helps product managers derive meaningful insights from customer feedback across multiple channels.



🔗 \*\*Live Demo\*\*: https://feedback-analysis-agent.howes-th.workers.dev



---



\## Features



\- \*\*Multi-source ingestion\*\* — Accept feedback from support tickets, social media, surveys, app stores, email, and more

\- \*\*AI-powered analysis\*\* — Automatic sentiment detection, scoring (0-10), and theme extraction

\- \*\*Real-time dashboard\*\* — Visualize satisfaction trends, theme health, and sentiment breakdown

\- \*\*Conversational AI\*\* — Ask natural language questions like "What are the main complaints about pricing?"

\- \*\*Executive summaries\*\* — Generate AI reports with actionable recommendations



---



\## Architecture



```

┌─────────────────────────────────────────────────────────────────────┐

│                         Cloudflare Network                          │

├─────────────────────────────────────────────────────────────────────┤

│                                                                     │

│   ┌─────────────┐     ┌─────────────────┐     ┌─────────────────┐  │

│   │   Feedback  │     │    Cloudflare   │     │    Workers AI   │  │

│   │   Sources   │────▶│     Worker      │────▶│   (Llama 3.1)   │  │

│   │   (API)     │     │                 │     │                 │  │

│   └─────────────┘     └────────┬────────┘     └─────────────────┘  │

│                                │                       │            │

│                                ▼                       │            │

│                       ┌─────────────────┐              │            │

│                       │ Durable Object  │◀─────────────┘            │

│                       │  + SQLite DB    │                           │

│                       └────────┬────────┘                           │

│                                │                                    │

│                                ▼                                    │

│                       ┌─────────────────┐                           │

│                       │    Dashboard    │                           │

│                       │    (React)      │                           │

│                       └─────────────────┘                           │

│                                                                     │

└─────────────────────────────────────────────────────────────────────┘

```



---



\## Cloudflare Products Used



| Product | Purpose |

|---------|---------|

| \*\*Workers\*\* | Hosts the API endpoints and serves the React dashboard. Provides serverless, globally distributed compute. |

| \*\*Durable Objects\*\* | Persistent state management with embedded SQLite database. Stores all feedback data and enables consistent queries. |

| \*\*Workers AI\*\* | Powers all AI features using Llama 3.1 8B. Performs sentiment analysis, theme extraction, Q\&A, and summary generation. |



---



\## Data Flow



1\. \*\*Ingest\*\* — Feedback is submitted via REST API from any source

2\. \*\*Analyze\*\* — Workers AI classifies sentiment, assigns scores (0-10), extracts themes

3\. \*\*Store\*\* — Durable Object persists data in embedded SQLite

4\. \*\*Query\*\* — Dashboard fetches aggregated stats, trends, and recent feedback

5\. \*\*Interact\*\* — Users can ask AI questions or generate executive summaries



---



\## API Endpoints



| Method | Endpoint | Description |

|--------|----------|-------------|

| `POST` | `/api/ingest` | Ingest new feedback items |

| `GET` | `/api/dashboard` | Get all dashboard data |

| `GET` | `/api/feedback?limit=50` | Get recent feedback |

| `POST` | `/api/ask` | Ask AI a question about feedback |

| `GET` | `/api/summary?days=7` | Generate executive summary |

| `GET` | `/api/trends?days=30` | Get sentiment trends |



---



\## Example: Ingest Feedback



```bash

curl -X POST https://feedback-analysis-agent.howes-th.workers.dev/api/ingest \\

&nbsp; -H "Content-Type: application/json" \\

&nbsp; -d '{

&nbsp;   "feedback": \[

&nbsp;     {

&nbsp;       "source": "support\_ticket",

&nbsp;       "content": "The export feature is broken. Getting error 500.",

&nbsp;       "timestamp": "2026-01-29T10:00:00Z"

&nbsp;     },

&nbsp;     {

&nbsp;       "source": "app\_store",

&nbsp;       "content": "Love this app! The interface is beautiful.",

&nbsp;       "timestamp": "2026-01-29T09:00:00Z"

&nbsp;     }

&nbsp;   ]

&nbsp; }'

```



---



\## Example: Ask AI



```bash

curl -X POST https://feedback-analysis-agent.howes-th.workers.dev/api/ask \\

&nbsp; -H "Content-Type: application/json" \\

&nbsp; -d '{"question": "What are users most frustrated about?"}'

```



---



\## Local Development



```bash

\# Install dependencies

npm install



\# Run locally

npm run dev



\# Deploy to Cloudflare

npm run deploy

```



---



\## Project Structure



```

feedback-agent/

├── src/

│   └── index.ts        # Main Worker + Durable Object + Dashboard

├── wrangler.jsonc      # Cloudflare configuration

├── package.json

└── README.md

```



---



\## Dashboard Features



\### Overview Stats

\- Total feedback count

\- Average satisfaction score

\- Positive/negative rate percentages



\### Satisfaction Trend

\- Line chart showing daily average scores

\- Color-coded data points (green=good, yellow=mixed, red=poor)



\### Theme Health

\- Shows sentiment breakdown for each topic

\- Identifies areas needing attention vs. doing well



\### AI Assistant

\- Ask natural language questions about your feedback

\- Generate executive summaries with action items



---



\## Built With



\- \[Cloudflare Workers](https://developers.cloudflare.com/workers/)

\- \[Cloudflare Durable Objects](https://developers.cloudflare.com/durable-objects/)

\- \[Cloudflare Workers AI](https://developers.cloudflare.com/workers-ai/)

\- \[React](https://react.dev/)

\- \[Chart.js](https://www.chartjs.org/)

\- \[Tailwind CSS](https://tailwindcss.com/)

