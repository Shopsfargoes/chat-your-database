import { createClient } from "@supabase/supabase-js";

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

function extractTableNames(schemaDdl) {
  const matches = [...String(schemaDdl || "").matchAll(/CREATE\s+TABLE\s+([`"\[\]a-zA-Z0-9_.-]+)/gi)];
  const names = matches.map((m) => m[1].replace(/[`"\[\]]/g, "").split(".").pop());
  return Array.from(new Set(names.filter(Boolean)));
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const workspaceId = req.query?.workspaceId;
    if (!workspaceId) {
      return res.status(400).json({ error: "workspaceId is required." });
    }

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("workspaces")
      .select("id, schema_ddl")
      .eq("id", workspaceId)
      .single();

    if (error || !data) {
      return res.status(404).json({ error: "Workspace not found." });
    }

    return res.status(200).json({
      workspaceId: data.id,
      tables: extractTableNames(data.schema_ddl),
    });
  } catch (err) {
    return res.status(400).json({
      error: err?.message || "Failed to load workspace tables.",
    });
  }
}