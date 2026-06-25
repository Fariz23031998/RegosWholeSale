import type { WholesaleDocument } from "@/lib/sales-api";

function documentSearchHaystack(
  doc: WholesaleDocument,
  extra: string[] = [],
): string {
  return [
    doc.code,
    String(doc.id),
    doc.partner_name,
    doc.stock_name,
    doc.attached_user_name,
    ...extra,
  ]
    .filter((value): value is string => Boolean(value))
    .join(" ")
    .toLowerCase();
}

export function filterWholesaleDocuments<T extends WholesaleDocument>(
  documents: T[],
  query: string,
  extraFields?: (doc: T) => Array<string | number | null | undefined>,
): T[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return documents;
  return documents.filter((doc) => {
    const extra =
      extraFields?.(doc).map((value) => (value == null ? "" : String(value))) ?? [];
    return documentSearchHaystack(doc, extra).includes(normalized);
  });
}
