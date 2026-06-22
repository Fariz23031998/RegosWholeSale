import { useEffect, useState } from "react";
import clsx from "clsx";
import { formatAuthError, useAuth } from "@/store/auth";
import { formatCurrency, formatDateTime } from "@/lib/format";
import {
  fetchWholesaleReturnDocuments,
  type WholesaleReturnDocument,
} from "@/lib/sales-api";
import styles from "./Returns.module.css";

type Range = "today" | "week" | "all";

function rangeToTimestamps(range: Range): { start_date?: number; end_date?: number } {
  if (range === "all") return {};
  const now = Math.floor(Date.now() / 1000);
  const day = 24 * 60 * 60;
  if (range === "today") {
    return { start_date: now - day, end_date: now };
  }
  return { start_date: now - 7 * day, end_date: now };
}

export function ReturnsPage() {
  const token = useAuth((s) => s.accessToken);
  const [range, setRange] = useState<Range>("week");
  const [returnDocuments, setReturnDocuments] = useState<WholesaleReturnDocument[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const reload = () => {
    if (!token) {
      setReturnDocuments([]);
      return;
    }

    setLoading(true);
    setError("");
    const params = rangeToTimestamps(range);

    fetchWholesaleReturnDocuments(token, { ...params, limit: 100 })
      .then((returnsRes) => {
        setReturnDocuments(returnsRes.documents);
      })
      .catch((err: unknown) => {
        setReturnDocuments([]);
        setError(formatAuthError(err, "Failed to load returns"));
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    reload();
  }, [token, range]);

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Returns</h1>
          <div className={styles.subtitle}>
            View wholesale return documents from Regos.
          </div>
        </div>
        <div className={styles.filters}>
          {(["today", "week", "all"] as Range[]).map((r) => (
            <button
              key={r}
              type="button"
              className={clsx(styles.filter, range === r && styles.filterActive)}
              onClick={() => setRange(r)}
            >
              {r === "today" ? "Today" : r === "week" ? "Last 7 days" : "All time"}
            </button>
          ))}
        </div>
      </div>

      {error && <div className={styles.empty}>{error}</div>}

      <div className={styles.table}>
        {loading ? (
          <div className={styles.empty}>Loading returns from Regos…</div>
        ) : returnDocuments.length === 0 ? (
          <div className={styles.empty}>No return documents found.</div>
        ) : (
          <table className={styles.tbl}>
            <thead>
              <tr>
                <th>Return</th>
                <th>Original</th>
                <th>Time</th>
                <th>Partner</th>
                <th>Warehouse</th>
                <th>Reason</th>
                <th className={styles.right}>Total</th>
              </tr>
            </thead>
            <tbody>
              {returnDocuments.map((doc) => (
                <tr key={doc.id}>
                  <td className={styles.id}>#{doc.code || doc.id}</td>
                  <td className={styles.id}>
                    {doc.wholesale_doc_id ? `#${doc.wholesale_doc_id}` : "—"}
                  </td>
                  <td>
                    {doc.date > 0
                      ? formatDateTime(new Date(doc.date * 1000).toISOString())
                      : "—"}
                  </td>
                  <td>{doc.partner_name ?? "—"}</td>
                  <td>{doc.stock_name ?? "—"}</td>
                  <td style={{ color: "var(--color-text-muted)" }}>
                    {doc.reason || "—"}
                  </td>
                  <td
                    className={styles.right}
                    style={{ fontWeight: 600, color: "var(--color-danger, #dc2626)" }}
                  >
                    {formatCurrency(doc.amount ?? 0)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
