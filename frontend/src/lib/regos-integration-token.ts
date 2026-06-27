const GATEWAY_OUT_TOKEN = /\/gateway\/out\/([^/?#\s]+)/i;

export function extractRegosIntegrationToken(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "";
  const match = GATEWAY_OUT_TOKEN.exec(trimmed);
  return match ? match[1].trim() : trimmed;
}
