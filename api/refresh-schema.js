import { createClient } from "@supabase/supabase-js";
import { decryptSecrets } from "./_lib/crypto.js";
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
    const { workspaceId } = req.body || {};
    if (!workspaceId) {
      return res.status(400).json({ error: "workspaceId is required." });
    }

    const supabase = getSupabaseAdmin();

    // 1. Load workspace DB type & encrypted credentials
    const { data: workspace, error: fetchError } = await supabase
      .from("workspaces")
      .select("id, name, db_type, encrypted_secrets")
      .eq("id", workspaceId)
      .single();

    if (fetchError || !workspace) {
      return res.status(404).json({ error: "Workspace not found." });
    }

    const secrets = decryptSecrets(workspace.encrypted_secrets);

    // 2. Re-introspect the live database schema
    const schemaInfo = await introspectDatabase({
      db_type: workspace.db_type,
      host: secrets.host,
      port: secrets.port,
      database: secrets.database,
      username: secrets.username,
      password: secrets.password,
      ssl: Boolean(secrets.ssl),
    });

    // 3. Update schema_ddl in Supabase
    const { error: updateError } = await supabase
      .from("workspaces")
      .update({ schema_ddl: schemaInfo.schemaDdl })
      .eq("id", workspace.id);

    if (updateError) {
      throw new Error(`Failed to update schema: ${updateError.message}`);
    }

    return res.status(200).json({
      workspaceId: workspace.id,
      name: workspace.name,
      tableCount: schemaInfo.tableCount,
      tables: schemaInfo.tables.map((t) => ({
        name: t.name,
        columnCount: t.columnCount,
      })),
    });
  } catch (err) {
    return res.status(400).json({
      error: err?.message || "Failed to refresh database schema.",
    });
  }
}