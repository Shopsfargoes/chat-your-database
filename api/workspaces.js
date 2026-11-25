// api/workspaces.js
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

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("workspaces")
      .select("id, name, db_type, ai_provider, ai_model, created_at")
      .order("created_at", { ascending: false });

    if (error) {
      throw new Error(`Failed to load workspaces: ${error.message}`);
    }

    return res.status(200).json({ workspaces: data || [] });
  } catch (err) {
    return res.status(400).json({
      error: err?.message || "Could not load workspaces.",
    });
  }
}