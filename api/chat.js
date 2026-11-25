import { createClient } from "@supabase/supabase-js";
import { decryptSecrets } from "./_lib/crypto.js";
import { createLLMClient } from "./_lib/llm.js";
import { executeReadOnlyQuery } from "./_lib/query.js";

function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  }
  return createClient(url, serviceKey, {
    auth: { persistSession: false },
  });
}

const SQL_SYSTEM_PROMPT = `You convert natural-language questions into a single read-only SQL query.
Rules:
- Output ONLY raw SQL. Do not use markdown code fences or commentary.
- Only use tables and columns present in the provided schema.
- Only generate SELECT or WITH (CTE) statements. Never modify data or schema.
- Match the SQL dialect of the requested database type (postgres or mysql).`;

const SUMMARY_SYSTEM_PROMPT = `You are a helpful data analyst.
Given a user question, the executed SQL query, and JSON query results, answer the user's question clearly and concisely.
If no rows were returned, state that clearly. Do not invent numbers that are not in the results.`;

async function requestSql(client, model, baseMessages, extraUserPrompt) {
  const completion = await client.chat.completions.create({
    model,
    temperature: 0,
    messages: [
      ...baseMessages,
      { role: "user", content: extraUserPrompt },
    ],
  });

  return completion.choices?.[0]?.message?.content || "";
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { workspaceId, question, history = [] } = req.body || {};

    if (!workspaceId || !question?.trim()) {
      return res.status(400).json({ error: "workspaceId and question are required." });
    }

    const supabase = getSupabaseAdmin();
    const { data: workspace, error: dbError } = await supabase
      .from("workspaces")
      .select("id, db_type, ai_provider, ai_model, schema_ddl, encrypted_secrets")
      .eq("id", workspaceId)
      .single();

    if (dbError || !workspace) {
      return res.status(404).json({ error: "Workspace not found." });
    }

    const secrets = decryptSecrets(workspace.encrypted_secrets);
    const { client, model } = createLLMClient(
      workspace.ai_provider,
      secrets.apiKey,
      workspace.ai_model
    );

    const recentHistory = Array.isArray(history)
      ? history
          .slice(-4)
          .filter(
            (m) =>
              m &&
              (m.role === "user" || m.role === "assistant") &&
              typeof m.content === "string"
          )
          .map((m) => ({ role: m.role, content: m.content.slice(0, 1000) }))
      : [];

    const baseMessages = [
      { role: "system", content: SQL_SYSTEM_PROMPT },
      {
        role: "user",
        content: `Database Type: ${workspace.db_type}\n\nSchema:\n${workspace.schema_ddl}`,
      },
      ...recentHistory,
    ];

    const cleanQuestion = question.trim();

    // 1. Initial SQL generation
    let candidateSql = await requestSql(
      client,
      model,
      baseMessages,
      `Question: ${cleanQuestion}`
    );

    let queryResult;
    let retried = false;

    // 2. Execute query, retrying once if the database rejects the SQL
    try {
      queryResult = await executeReadOnlyQuery(
        workspace.db_type,
        secrets,
        candidateSql,
        100
      );
    } catch (firstErr) {
      retried = true;
      const dbErrorMessage = firstErr?.message || "Unknown database error";

      candidateSql = await requestSql(
        client,
        model,
        baseMessages,
        [
          `Question: ${cleanQuestion}`,
          `Your previous SQL query failed when executed against ${workspace.db_type}.`,
          `Failed SQL:\n${candidateSql}`,
          `Database Error:\n${dbErrorMessage}`,
          "Fix the SQL query using only valid tables and columns from the schema. Output ONLY the corrected read-only SQL query.",
        ].join("\n\n")
      );

      try {
        queryResult = await executeReadOnlyQuery(
          workspace.db_type,
          secrets,
          candidateSql,
          100
        );
      } catch (retryErr) {
        return res.status(400).json({
          error: `Query failed after retry: ${retryErr?.message || dbErrorMessage}`,
          failedSql: candidateSql,
        });
      }
    }

    // 3. Summarize results
    const summaryCompletion = await client.chat.completions.create({
      model,
      temperature: 0.2,
      messages: [
        { role: "system", content: SUMMARY_SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            `Question: ${cleanQuestion}`,
            `SQL: ${queryResult.executedSql}`,
            `Rows (${queryResult.rowCount}): ${JSON.stringify(queryResult.rows.slice(0, 50))}`,
          ].join("\n\n"),
        },
      ],
    });

    const answer =
      summaryCompletion.choices?.[0]?.message?.content?.trim() ||
      "Query executed successfully.";

    return res.status(200).json({
      answer,
      sql: queryResult.executedSql,
      rowCount: queryResult.rowCount,
      rows: queryResult.rows,
      retried,
    });
  } catch (err) {
    return res.status(400).json({
      error: err?.message || "Failed to process chat query.",
    });
  }
}