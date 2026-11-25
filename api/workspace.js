// api/workspace.js
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
  if (req.method !== "DELETE") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const workspaceId = req.query?.id || req.body?.workspaceId;
    if (!workspaceId) {
      return res.status(400).json({ error: "workspaceId is required." });
    }

    const supabase = getSupabaseAdmin();
    const { error } = await supabase
      .from("workspaces")
      .delete()
      .eq("id", workspaceId);

    if (error) {
      throw new Error(`Failed to delete workspace: ${error.message}`);
    }

    return res.status(200).json({ deleted: true, workspaceId });
  } catch (err) {
    return res.status(400).json({
      error: err?.message || "Could not delete workspace.",
    });
  }
}