import { createClient } from "@supabase/supabase-js";
import { encryptSecrets } from "./_lib/crypto.js";
import { introspectDatabase } from "./_lib/db.js";

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

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const body = req.body || {};
    const {
      workspace_name,
      db_type,
      host,
      port,
      database,
      username,
      password,
      ssl = true,
      ai_provider,
      api_key,
      ai_model,
    } = body;

    if (!db_type || !host || !database || !username || !password) {
      return res.status(400).json({ error: "Missing required database fields." });
    }
    if (!ai_provider || !api_key) {
      return res.status(400).json({ error: "AI provider and API key are required." });
    }

    // 1. Test DB connection & introspect schema
    const schemaInfo = await introspectDatabase({
      db_type,
      host,
      port,
      database,
      username,
      password,
      ssl: Boolean(ssl),
    });

    // 2. Encrypt sensitive DB password & AI API key
    const encryptedSecrets = encryptSecrets({
      host,
      port: Number(port) || (db_type === "mysql" ? 3306 : 5432),
      database,
      username,
      password,
      ssl: Boolean(ssl),
      apiKey: api_key,
    });

    // 3. Save workspace in Supabase
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("workspaces")
      .insert({
        name: workspace_name?.trim() || `${database} (${db_type})`,
        db_type,
        encrypted_secrets: encryptedSecrets,
        ai_provider,
        ai_model: ai_model?.trim() || null,
        schema_ddl: schemaInfo.schemaDdl,
      })
      .select("id, name, db_type, ai_provider, ai_model, created_at")
      .single();

    if (error) {
      throw new Error(`Supabase insert failed: ${error.message}`);
    }

    return res.status(200).json({
      workspaceId: data.id,
      name: data.name,
      dbType: data.db_type,
      aiProvider: data.ai_provider,
      tableCount: schemaInfo.tableCount,
      tables: schemaInfo.tables.map((t) => ({
        name: t.name,
        columnCount: t.columnCount,
      })),
    });
  } catch (err) {
    return res.status(400).json({
      error: err?.message || "Failed to connect database.",
    });
  }
}