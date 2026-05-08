import type { ServerConfig } from "./types";

export function providerNames(
  config?: ServerConfig,
  options: { includeDisabled?: boolean } = {},
) {
  return Object.entries(config?.providers ?? {})
    .filter(([, provider]) => options.includeDisabled || !provider.disabled)
    .map(([name]) => name);
}

export function effectiveDefaultProvider(config?: ServerConfig) {
  if (!config) return "";
  if (
    config.default_provider &&
    config.providers[config.default_provider] &&
    !config.providers[config.default_provider].disabled
  ) {
    return config.default_provider;
  }
  return providerNames(config)[0] ?? "";
}

export function defaultProviderLabel(config?: ServerConfig) {
  return effectiveDefaultProvider(config) || "—";
}

export function isProviderAvailable(config: ServerConfig | undefined, name: string) {
  const provider = name ? config?.providers[name] : undefined;
  return Boolean(provider && !provider.disabled);
}

export function reconcileProviderSelection(
  config: ServerConfig | undefined,
  selectedProvider: string,
  options: { userSelected?: boolean } = {},
) {
  const fallback = effectiveDefaultProvider(config);
  if (!fallback) return "";
  if (!isProviderAvailable(config, selectedProvider)) return fallback;
  return options.userSelected ? selectedProvider : fallback;
}
