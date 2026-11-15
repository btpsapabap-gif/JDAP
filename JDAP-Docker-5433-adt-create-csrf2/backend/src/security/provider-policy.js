export function resolveAiProvider(requestedProvider, configuredModel) {
  if (requestedProvider && !["mock", "openai"].includes(requestedProvider)) {
    throw new Error("aiProvider must be 'mock' or 'openai'.");
  }
  if (requestedProvider === "openai" && !configuredModel) {
    throw new Error("OpenAI AI mode is not configured on this JDAP server.");
  }
  const model = requestedProvider === "mock" ? null : configuredModel;
  return { model, provider: model ? "openai" : "mock" };
}
