# Chat with Database (Open-Source Text-to-SQL)

A self-hosted open-source web app built with **HTML, CSS, Vanilla JavaScript**, **Vercel Serverless Functions**, and **Supabase** that lets users ask plain-English questions about **PostgreSQL** or **MySQL** databases and switch between **Google Gemini**, **OpenRouter**, and **OpenAI**.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/YOUR_USERNAME/YOUR_REPO&env=SUPABASE_URL,SUPABASE_SERVICE_ROLE_KEY,MASTER_ENCRYPTION_KEY&project-name=chat-with-db&repository-name=chat-with-db)

## Features

* **Self-Hosted Connection Setup:** Enter database credentials (`PostgreSQL` or `MySQL`), AI provider + API key, test connectivity, and introspect table schemas from the UI.
* **Pluggable AI Providers:** Switch between **Google Gemini**, **OpenRouter**, and **OpenAI** per workspace or update provider/model/API key live from the chat screen.
* **Read-Only Query Guardrails & Retry:** Blocks write/DDL statements, enforces row limits, runs read-only transactions, and retries once with database error context if SQL fails.
* **Interactive Chat, Chips & CSV Export:** Click schema-generated example question chips, inspect executed SQL, view tabular results, refresh schemas, switch/delete workspaces, and export query results as CSV.
* **Encrypted Credential Storage:** Encrypts database passwords and AI API keys with **AES-256-GCM** before storing workspace records in Supabase.

## Project Structure

```text
├── public/
│   ├── index.html          # Database & AI connection setup form
│   ├── chat.html           # Chat UI, workspace switcher, schema refresh & AI modal
│   ├── app.js              # Connection form logic
│   ├── chat.js             # Chat loop, chips, workspace manager, modal & CSV export
│   └── style.css           # Styles for setup, chat, tables, chips & modal
├── api/
│   ├── _lib/
│   │   ├── crypto.js       # AES-256-GCM encrypt/decrypt helpers
│   │   ├── db.js           # PostgreSQL & MySQL connection + schema introspection
│   │   ├── llm.js          # OpenAI-compatible client factory (Gemini/OpenRouter/OpenAI)
│   │   └── query.js        # Read-only SQL validation & execution
│   ├── connect.js          # POST: test DB, encrypt secrets, save workspace
│   ├── chat.js             # POST: generate SQL, run query (1 retry), summarize rows
│   ├── refresh-schema.js   # POST: re-introspect live DB schema & update Supabase
│   ├── update-ai.js        # POST/PATCH: update AI provider, model, or API key
│   ├── workspaces.js       # GET: list saved workspaces (no secrets)
│   ├── workspace.js        # DELETE: remove a workspace by ID
│   └── workspace-schema.js # GET: extract table names for example question chips
└── package.json
```

## 1. Supabase SQL Setup

1. Create a new project in [Supabase](https://supabase.com).
2. Open the **SQL Editor** in your Supabase dashboard and run:

```sql
create table if not exists workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Default Workspace',
  db_type text not null,              -- 'postgres' | 'mysql'
  encrypted_secrets text not null,    -- AES-256-GCM encrypted JSON (db creds + ai api key)
  ai_provider text not null,          -- 'gemini' | 'openrouter' | 'openai'
  ai_model text,
  schema_ddl text not null,           -- Extracted CREATE TABLE statements
  created_at timestamptz default now()
);
```

3. Copy your **Project URL** and **Service Role Key** from **Project Settings -> API**. Keep `SUPABASE_SERVICE_ROLE_KEY` strictly on the server (Vercel environment variables).

## 2. Vercel Environment Variables

Configure these three environment variables in your Vercel project (**Settings -> Environment Variables**):

| Variable | Required | Description |
| :--- | :--- | :--- |
| `SUPABASE_URL` | Yes | Your Supabase project URL (e.g., `https://xxxx.supabase.co`). |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Server-side Supabase service role key used by `/api/*` routes. |
| `MASTER_ENCRYPTION_KEY` | Yes | 64-character hex string (32-byte key) for AES-256-GCM encryption. |

Generate a `MASTER_ENCRYPTION_KEY` locally with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

> Remember to replace `YOUR_USERNAME/YOUR_REPO` in the **Deploy with Vercel** button URL at the top of this README with your actual GitHub repository path.

## 3. Security Best Practices for Self-Hosters

* **Use a read-only database user:** Create a restricted database role with `SELECT` permissions only before connecting a target database.
* **Protect your master key:** Never commit `.env` or `MASTER_ENCRYPTION_KEY` to GitHub. Rotating `MASTER_ENCRYPTION_KEY` will make existing `encrypted_secrets` rows unreadable.
* **Send schemas, not sensitive rows:** Only table/column definitions (`schema_ddl`) and query result sets needed to answer questions are sent to the selected AI provider.

## License

MIT# chat-your-database
