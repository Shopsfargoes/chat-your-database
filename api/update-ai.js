import { createClient } from "@supabase/supabase-js";
import { decryptSecrets, encryptSecrets } from "./_lib/crypto.js";

const SUPPORTED_PROVIDERS = new Set(["gemini", "openrouter", "openai"]);

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
  if (req.method !== "POST" && req.method !== "PATCH") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { workspaceId, ai_provider, ai_model, api_key } = req.body || {};

    if (!workspaceId) {
      return res.status(400).json({ error: "workspaceId is required." });
    }

    const hasProvider = typeof ai_provider === "string" && ai_provider.trim().length > 0;
    const hasModelField = Object.prototype.hasOwnProperty.call(req.body || {}, "ai_model");
    const hasApiKey = typeof api_key === "string" && api_key.trim().length > 0;

    if (!hasProvider && !hasModelField && !hasApiKey) {
      return res.status(400).json({
        error: "Provide at least one field to update: ai_provider, ai_model, or api_key.",
      });
    }

    const normalizedProvider = hasProvider ? ai_provider.toLowerCase().trim() : null;
    if (normalizedProvider && !SUPPORTED_PROVIDERS.has(normalizedProvider)) {
      return res.status(400).json({
        error: `Unsupported AI provider '${ai_provider}'. Choose from: gemini, openrouter, openai.`,
      });
    }

    const supabase = getSupabaseAdmin();

    // 1. Fetch existing workspace row
    const { data: workspace, error: fetchError } = await supabase
      .from("workspaces")
      .select("id, name, ai_provider, ai_model, encrypted_secrets")
      .eq("id", workspaceId)
      .single();

    if (fetchError || !workspace) {
      return res.status(404).json({ error: "Workspace not found." });
    }

    // 2. Decrypt existing secrets and update apiKey only if a new one was supplied
    const secrets = decryptSecrets(workspace.encrypted_secrets);
    if (hasApiKey) {
      secrets.apiKey = api_key.trim();
    }

    const updatedEncryptedSecrets = encryptSecrets(secrets);

    const updates = {
      encrypted_secrets: updatedEncryptedSecrets,
    };

    if (normalizedProvider) {
      updates.ai_provider = normalizedProvider;
    }

    if (hasModelField) {
      updates.ai_model =
        typeof ai_model === "string" && ai_model.trim().length > 0
          ? ai_model.trim()
          : null; // null resets to provider default model
    }

    // 3. Persist changes in Supabase
    const { data: updated, error: updateError } = await supabase
      .from("workspaces")
      .update(updates)
      .eq("id", workspace.id)
      .select("id, name, ai_provider, ai_model")
      .single();

    if (updateError) {
      throw new Error(`Failed to update AI settings: ${updateError.message}`);
    }

    return res.status(200).json({
      workspaceId: updated.id,
      name: updated.name,
      aiProvider: updated.ai_provider,
      aiModel: updated.ai_model,
      apiKeyUpdated: hasApiKey,
    });
  } catch (err) {
    return res.status(400).json({
      error: err?.message || "Failed to update AI settings.",
    });
  }
}