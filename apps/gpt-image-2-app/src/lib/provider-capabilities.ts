import type { ServerConfig } from "./types";

function isOfficialOpenAiProvider(name: string, config: ServerConfig | undefined) {
  const providerConfig = name ? config?.providers[name] : undefined;
  if (name === "openai") return true;
  return providerConfig?.type === "openai" || providerConfig?.api_base?.startsWith("https://api.openai.com/");
}

export function providerSupportsMultipleOutputs(config: ServerConfig | undefined, provider: string) {
  const providerConfig = provider ? config?.providers[provider] : undefined;
  if (provider === "codex" || providerConfig?.type === "codex") return false;
  return isOfficialOpenAiProvider(provider, config);
}

export function effectiveOutputCount(config: ServerConfig | undefined, provider: string, requested: number) {
  return providerSupportsMultipleOutputs(config, provider) ? requested : 1;
}

export function requestOutputCount(config: ServerConfig | undefined, provider: string, requested: number) {
  return providerSupportsMultipleOutputs(config, provider) ? requested : undefined;
}
