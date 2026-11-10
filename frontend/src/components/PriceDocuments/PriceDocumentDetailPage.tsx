import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { ArrowLeft, Search } from "lucide-react";
import { DataTable } from "@/components/DataTable/DataTable";
import { useLanguage } from "@/contexts/LanguageContext";
import { formatCurrency, formatDateTime } from "@/lib/format";
import {
  fetchPriceDocument,
  fetchPriceDocumentOperations,
  type PriceDocument,
  type PriceDocumentOperation,
} from "@/lib/price-documents-api";
import { formatAuthError, useAuth } from "@/store/auth";
import styles from "@/components/StockDocs/StockDocs.module.css";

type Props = {
  documentId: number;
};

export function PriceDocumentDetailPage({ documentId }: Props) {
  const { t } = useLanguage();
  const token = useAuth((state) => state.accessToken);
  const [document, setDocument] = useState<PriceDocument | null>(null);
  const [operations, setOperations] = useState<PriceDocumentOperation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [lineQuery, setLineQuery] = useState("");

  useEffect(() => {
    if (!token || !Number.isInteger(documentId) || documentId <= 0) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    void Promise.all([
      fetchPriceDocument(token, documentId),
      fetchPriceDocumentOperations(token, documentId),
    ])
      .then(([header, lines]) => {
        if (cancelled) return;
        setDocument(header);
        setOperations(lines.operations);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setDocument(null);
        setOperations([]);
        setError(formatAuthError(err, t("stock.errors.loadDetails", "Failed to load details")));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [documentId, t, token]);

  const lineQueryNorm = lineQuery.trim().toLowerCase();
  const filteredOperations = lineQueryNorm
    ? operations.filter((operation) => {
        const name = operation.item_name.toLowerCase();
        const code = operation.item_code.toLowerCase();
        return (
          name.includes(lineQueryNorm) ||
          code.includes(lineQueryNorm) ||
          String(operation.item_id).includes(lineQueryNorm)
        );
      })
    : operations;

  const columns = useMemo<ColumnDef<PriceDocumentOperation, any>[]>(
    () => [
      {
        id: "code",
        accessorFn: (operation) => operation.item_code,
        header: t("stock.detail.table.code", "Code"),
        cell: ({ row }) => row.original.item_code || "—",
        meta: { cellClassName: styles.id },
      },
      {
        id: "product",
        accessorFn: (operation) => operation.item_name,
        header: t("stock.detail.table.product", "Product"),
        size: 240,
        cell: ({ row }) => row.original.item_name || `#${row.original.item_id}`,
      },
      {
        id: "base",
        accessorFn: (operation) => operation.base_value,
        header: t("prices.basePrice", "Base price"),
        meta: { align: "right", cellClassName: styles.right, headerClassName: styles.right },
        cell: ({ row }) => formatCurrency(row.original.base_value),
      },
      {
        id: "next",
        accessorFn: (operation) => operation.new_value,
        header: t("prices.newPrice", "New price"),
        meta: { align: "right", cellClassName: styles.right, headerClassName: styles.right },
        cell: ({ row }) => formatCurrency(row.original.new_value),
      },
    ],
    [t],
  );

  const title = t("stock.detail.title", "Document #{{code}}", {
    code: document?.code || documentId,
  });

  return (
    <div className={styles.page}>
      <div className={`${styles.header} ${styles.detailHeader}`}>
        <div className={styles.detailHeaderMain}>
          <Link
            to="/price-documents"
            className={styles.backLink}
            aria-label={t("common.back", "Back")}
            title={t("common.back", "Back")}
          >
            <ArrowLeft size={18} />
          </Link>
          <h1 className={styles.title}>{title}</h1>
        </div>
      </div>

      {error ? <div className={styles.error}>{error}</div> : null}

      {loading && !document ? (
        <div className={styles.empty}>{t("common.loading")}</div>
      ) : document ? (
        <>
          <div className={styles.detailMeta}>
            <div>
              <span className={styles.detailLabel}>{t("common.date")}</span>
              <span>
                {document.date > 0
                  ? formatDateTime(new Date(document.date * 1000).toISOString())
                  : "—"}
              </span>
            </div>
            <div>
              <span className={styles.detailLabel}>{t("prices.priceType", "Price type")}</span>
              <span>{document.price_type_name || "—"}</span>
            </div>
            <div>
              <span className={styles.detailLabel}>{t("common.description")}</span>
              <span>{document.description.trim() ? document.description : "—"}</span>
            </div>
            <div>
              <span className={styles.detailLabel}>{t("stock.table.status", "Status")}</span>
              <span>
                {document.performed
                  ? t("stock.status.performed", "Performed")
                  : t("stock.status.draft", "Draft")}
              </span>
            </div>
          </div>

          <div className={styles.detailActions}>
            <div className={styles.detailActionsSearch}>
              <Search size={16} className={styles.searchIcon} aria-hidden />
              <input
                className={styles.searchInput}
                value={lineQuery}
                onChange={(event) => setLineQuery(event.target.value)}
                placeholder={t("stock.detail.searchLines", "Search lines…")}
                aria-label={t("stock.detail.searchLines", "Search lines…")}
              />
            </div>
          </div>

          <div className={styles.detailSection}>
            <div className={styles.detailSectionTitle}>{t("stock.detail.lines", "Lines")}</div>
            {operations.length === 0 ? (
              <div className={styles.detailEmpty}>{t("stock.detail.noLines", "No lines")}</div>
            ) : filteredOperations.length === 0 ? (
              <div className={styles.detailEmpty}>
                {t("stock.detail.noMatchingLines", "No matching lines")}
              </div>
            ) : (
              <>
                <div className={styles.detailTableWrap}>
                  <DataTable
                    tableKey="priceDocument.lines"
                    data={filteredOperations}
                    columns={columns}
                    className={styles.detailTable}
                    getRowId={(operation) => String(operation.id)}
                  />
                </div>
                <div className={styles.lineCards}>
                  {filteredOperations.map((operation) => (
                    <div key={operation.id} className={styles.lineCard}>
                      <div className={styles.lineCardTop}>
                        <div className={styles.lineCardName}>
                          {operation.item_name || `#${operation.item_id}`}
                        </div>
                        <div className={styles.lineCardAmount}>
                          {formatCurrency(operation.new_value)}
                        </div>
                      </div>
                      <div className={styles.lineCardMeta}>
                        {[
                          operation.item_code || null,
                          `${t("prices.basePrice", "Base price")}: ${formatCurrency(operation.base_value)}`,
                          `${t("prices.newPrice", "New price")}: ${formatCurrency(operation.new_value)}`,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}
