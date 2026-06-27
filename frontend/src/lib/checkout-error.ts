import { ApiError } from "@/lib/api";

const WHOLESALE_DOC_ID_PATTERN = /\(wholesale_doc_id=(\d+)\)/;

export function extractWholesaleDocIdFromError(err: unknown): number | null {
  const message =
    err instanceof ApiError
      ? err.message
      : err instanceof Error
        ? err.message
        : typeof err === "string"
          ? err
          : "";

  const match = message.match(WHOLESALE_DOC_ID_PATTERN);
  if (!match) return null;

  const id = Number.parseInt(match[1], 10);
  return Number.isFinite(id) && id > 0 ? id : null;
}
