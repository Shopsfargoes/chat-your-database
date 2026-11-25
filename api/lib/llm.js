import OpenAI from "openai";

const PROVIDERS = {
  gemini: {
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
    defaultModel: "gemini-3.8-flash",
  },
  openrouter: {
    baseURL: "https://openrouter.ai/api/v1",
    defaultModel: "openrouter/free",
  },
  openai: {
    baseURL: undefined,
    defaultModel: "gpt-6-luna",
  },
};

export function createLLMClient(provider, apiKey, customModel) {
  const cfg = PROVIDERS[provider];
  if (!cfg) throw new Error(`Unsupported AI provider: ${provider}`);

  const client = new OpenAI({
    apiKey,
    ...(cfg.baseURL ? { baseURL: cfg.baseURL } : {}),
  });

  return {
    client,
    model: customModel?.trim() || cfg.defaultModel,
  };
}