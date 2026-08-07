import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, Check, Lock, Pencil, Plus, RotateCcw, Search, Trash2, Unlock } from "lucide-react";
import { Button } from "@/components/posui/Button";
import { Modal } from "@/components/posui/Modal";
import { useLanguage } from "@/contexts/LanguageContext";
import { usePermissions } from "@/hooks/use-permissions";
import { formatCurrency, formatDateTime } from "@/lib/format";
import {
  deleteStockOperations,
  fetchStockDocument,
  fetchStockOperations,
  lockStockDocument,
  performCancelStockDocument,
  performStockDocument,
  unlockStockDocument,
  type StockDocKind,
  type StockDocument,
  type StockItemSearchHit,
  type StockOperationLine,
} from "@/lib/stock-docs-api";
import {
  formatInoutTypeLabel,
  getStockDocDefinition,
  stockDocListPath,
} from "@/lib/stock-doc-definitions";
import { formatAuthError, useAuth } from "@/store/auth";
import { StockDocAddLineModal } from "./StockDocAddLineModal";
import { StockDocEditLineModal } from "./StockDocEditLineModal";
import { StockDocUpdateLineModal } from "./StockDocUpdateLineModal";
import styles from "./StockDocs.module.css";

type Props = {
  kind: Exclude<StockDocKind, "wholesale">;
  documentId: number;
};

export function StockDocDetailPage({ kind, documentId }: Props) {
  const def = getStockDocDefinition(kind);
  const { t } = useLanguage();
  const token = useAuth((s) => s.accessToken);
  const { can } = usePermissions();
  const canWrite = can(def.writePermission);
  const canPerform = can(def.performPermission);
  const canPerformCancel = can(def.performCancelPermission);
  const canLock = can(def.lockPermission);
  const canUnlock = can(def.unlockPermission);
  const listPath = stockDocListPath(kind);

  const [document, setDocument] = useState<StockDocument | null>(null);
  const [operations, setOperations] = useState<StockOperationLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [editHit, setEditHit] = useState<StockItemSearchHit | null>(null);
  const [updateLine, setUpdateLine] = useState<StockOperationLine | null>(null);
  const [deleteLine, setDeleteLine] = useState<StockOperationLine | null>(null);
  const [lineQuery, setLineQuery] = useState("");

  const reload = async () => {
    if (!token) return;
    setLoading(true);
    setError("");
    try {
      const [doc, ops] = await Promise.all([
        fetchStockDocument(token, kind, documentId),
        fetchStockOperations(token, kind, documentId),
      ]);
      setDocument(doc);
      setOperations(ops.operations);
    } catch (err: unknown) {
      setError(formatAuthError(err, t("stock.errors.loadDetails", "Failed to load details")));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void reload();
  }, [documentId, kind, token]);

  const done = document
    ? kind === "inventory"
      ? Boolean(document.closed || document.performed)
      : document.performed
    : false;

  const title = t("stock.detail.title", "Document #{{code}}", {
    code: document?.code || documentId,
  });

  const performLabel =
    kind === "inventory"
      ? t("stock.actions.close", "Close")
      : t("stock.actions.perform", "Perform");
  const cancelPerformLabel =
    kind === "inventory"
      ? t("stock.actions.open", "Reopen")
      : t("stock.actions.cancelPerform", "Cancel perform");

  const run = async (fn: () => Promise<unknown>) => {
    if (!token || busy) return;
    setBusy(true);
    setError("");
    try {
      await fn();
      await reload();
    } catch (err: unknown) {
      setError(formatAuthError(err, t("stock.errors.action", "Action failed")));
    } finally {
      setBusy(false);
    }
  };

  const confirmDeleteLine = (op: StockOperationLine) => {
    setDeleteLine(op);
  };

  const executeDeleteLine = () => {
    if (!deleteLine || !token) return;
    const id = deleteLine.id;
    setDeleteLine(null);
    void run(() => deleteStockOperations(token, kind, [id]));
  };

  const lineQueryNorm = lineQuery.trim().toLowerCase();
  const filteredOperations = lineQueryNorm
    ? operations.filter((op) => {
        const name = (op.item_name ?? "").toLowerCase();
        const code = (op.item_code ?? "").toLowerCase();
        const id = String(op.item_id);
        return (
          name.includes(lineQueryNorm) ||
          code.includes(lineQueryNorm) ||
          id.includes(lineQueryNorm)
        );
      })
    : operations;

  const lineActions = (op: StockOperationLine) => (
    <div className={styles.lineActions}>
      <Button
        type="button"
        size="icon"
        variant="secondary"
        disabled={busy}
        aria-label={t("common.edit", "Edit")}
        title={t("common.edit", "Edit")}
        onClick={() => setUpdateLine(op)}
      >
        <Pencil size={16} />
      </Button>
      <Button
        type="button"
        size="icon"
        variant="danger"
        disabled={busy}
        aria-label={t("common.delete", "Delete")}
        title={t("common.delete", "Delete")}
        onClick={() => confirmDeleteLine(op)}
      >
        <Trash2 size={16} />
      </Button>
    </div>
  );

  return (
    <div className={styles.page}>
      <div className={`${styles.header} ${styles.detailHeader}`}>
        <div className={styles.detailHeaderMain}>
          <Link
            to={listPath}
            className={styles.backLink}
            aria-label={t("common.back", "Back")}
            title={t("common.back", "Back")}
          >
            <ArrowLeft size={18} />
          </Link>
          <h1 className={styles.title}>{title}</h1>
        </div>
      </div>

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
            {def.showSenderReceiver ? (
              <>
                <div>
                  <span className={styles.detailLabel}>{t("stock.table.sender", "From")}</span>
                  <span>{document.stock_sender_name ?? "—"}</span>
                </div>
                <div>
                  <span className={styles.detailLabel}>{t("stock.table.receiver", "To")}</span>
                  <span>{document.stock_receiver_name ?? "—"}</span>
                </div>
              </>
            ) : (
              <div>
                <span className={styles.detailLabel}>{t("stock.table.warehouse", "Warehouse")}</span>
                <span>{document.stock_name ?? "—"}</span>
              </div>
            )}
            {kind === "inout" && (
              <div>
                <span className={styles.detailLabel}>{t("stock.table.inoutType", "Type")}</span>
                <span>{formatInoutTypeLabel(document.inout_type, t)}</span>
              </div>
            )}
            {def.supportsPartnerFilter && (
              <div>
                <span className={styles.detailLabel}>{t("stock.table.partner", "Partner")}</span>
                <span>{document.partner_name ?? "—"}</span>
              </div>
            )}
            <div>
              <span className={styles.detailLabel}>{t("stock.table.status", "Status")}</span>
              <span>
                {done
                  ? t(def.performedLabelKey, def.performedLabelFallback)
                  : t(def.draftLabelKey, def.draftLabelFallback)}
              </span>
            </div>
            <div>
              <span className={styles.detailLabel}>{t("common.total")}</span>
              <span>{document.amount != null ? formatCurrency(document.amount) : "—"}</span>
            </div>
          </div>

          <div className={styles.detailActions}>
            {!done && canPerform ? (
              <Button
                type="button"
                size="icon"
                disabled={busy}
                aria-label={performLabel}
                title={performLabel}
                onClick={() => void run(() => performStockDocument(token!, kind, document.id))}
              >
                <Check size={18} />
              </Button>
            ) : null}
            {done && canPerformCancel ? (
              <Button
                type="button"
                size="icon"
                variant="secondary"
                disabled={busy}
                aria-label={cancelPerformLabel}
                title={cancelPerformLabel}
                onClick={() =>
                  void run(() => performCancelStockDocument(token!, kind, document.id))
                }
              >
                <RotateCcw size={18} />
              </Button>
            ) : null}
            {document.blocked && canUnlock ? (
              <Button
                type="button"
                size="icon"
                variant="secondary"
                disabled={busy}
                aria-label={t("stock.actions.unlock", "Unlock")}
                title={t("stock.actions.unlock", "Unlock")}
                onClick={() => void run(() => unlockStockDocument(token!, kind, document.id))}
              >
                <Unlock size={18} />
              </Button>
            ) : null}
            {!document.blocked && canLock ? (
              <Button
                type="button"
                size="icon"
                variant="secondary"
                disabled={busy}
                aria-label={t("stock.actions.lock", "Lock")}
                title={t("stock.actions.lock", "Lock")}
                onClick={() => void run(() => lockStockDocument(token!, kind, document.id))}
              >
                <Lock size={18} />
              </Button>
            ) : null}
            {canWrite && !done ? (
              <Button
                type="button"
                className={styles.addLineToolbar}
                disabled={busy}
                aria-label={t("stock.actions.addLine", "Add line")}
                title={t("stock.actions.addLine", "Add line")}
                onClick={() => setAddOpen(true)}
              >
                <Plus size={16} />
                {t("stock.actions.addLine", "Add line")}
              </Button>
            ) : null}
            <div className={styles.detailActionsSearch}>
              <Search size={16} className={styles.searchIcon} aria-hidden />
              <input
                className={styles.searchInput}
                value={lineQuery}
                onChange={(e) => setLineQuery(e.target.value)}
                placeholder={t("stock.detail.searchLines", "Search lines…")}
                aria-label={t("stock.detail.searchLines", "Search lines…")}
              />
            </div>
          </div>

          <div className={styles.detailSection}>
            <div className={styles.detailSectionTitle}>{t("stock.detail.lines", "Lines")}</div>
            {loading ? (
              <div className={styles.detailEmpty}>{t("common.loading")}</div>
            ) : operations.length === 0 ? (
              <div className={styles.detailEmpty}>{t("stock.detail.noLines", "No lines")}</div>
            ) : filteredOperations.length === 0 ? (
              <div className={styles.detailEmpty}>
                {t("stock.detail.noMatchingLines", "No matching lines")}
              </div>
            ) : (
              <>
                <div className={styles.detailTableWrap}>
                  <table className={styles.detailTable}>
                    <thead>
                      <tr>
                        <th>{t("stock.detail.table.code", "Code")}</th>
                        <th>{t("stock.detail.table.product", "Product")}</th>
                        <th className={styles.right}>{t("stock.detail.table.qty", "Qty")}</th>
                        {def.showCost && (
                          <th className={styles.right}>{t("stock.detail.table.cost", "Cost")}</th>
                        )}
                        {def.showPrice && (
                          <th className={styles.right}>{t("stock.detail.table.price", "Price")}</th>
                        )}
                        <th className={styles.right}>{t("common.amount")}</th>
                        {canWrite && !done && <th />}
                      </tr>
                    </thead>
                    <tbody>
                      {filteredOperations.map((op) => (
                        <tr key={op.id}>
                          <td className={styles.id}>{op.item_code || "—"}</td>
                          <td>{op.item_name ?? `#${op.item_id}`}</td>
                          <td className={styles.right}>{op.quantity}</td>
                          {def.showCost && (
                            <td className={styles.right}>
                              {op.cost != null ? formatCurrency(op.cost) : "—"}
                            </td>
                          )}
                          {def.showPrice && (
                            <td className={styles.right}>
                              {op.price != null ? formatCurrency(op.price) : "—"}
                            </td>
                          )}
                          <td className={styles.right}>
                            {def.showCost && op.cost != null
                              ? formatCurrency(op.cost * op.quantity)
                              : op.amount != null
                                ? formatCurrency(op.amount)
                                : op.price != null
                                  ? formatCurrency(op.price * op.quantity)
                                  : "—"}
                          </td>
                          {canWrite && !done && <td>{lineActions(op)}</td>}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className={styles.lineCards}>
                  {filteredOperations.map((op) => {
                    const amount =
                      def.showCost && op.cost != null
                        ? formatCurrency(op.cost * op.quantity)
                        : op.amount != null
                          ? formatCurrency(op.amount)
                          : op.price != null
                            ? formatCurrency(op.price * op.quantity)
                            : "—";
                    const metaParts = [
                      op.item_code || null,
                      `${t("stock.detail.table.qty", "Qty")}: ${op.quantity}`,
                      def.showCost
                        ? `${t("stock.detail.table.cost", "Cost")}: ${
                            op.cost != null ? formatCurrency(op.cost) : "—"
                          }`
                        : null,
                      def.showPrice
                        ? `${t("stock.detail.table.price", "Price")}: ${
                            op.price != null ? formatCurrency(op.price) : "—"
                          }`
                        : null,
                    ].filter(Boolean);
                    return (
                      <div key={op.id} className={styles.lineCard}>
                        <div className={styles.lineCardTop}>
                          <div className={styles.lineCardName}>
                            {op.item_name ?? `#${op.item_id}`}
                          </div>
                          <div className={styles.lineCardAmount}>{amount}</div>
                        </div>
                        <div className={styles.lineCardMeta}>
                          {metaParts.join(" · ")}
                        </div>
                        {canWrite && !done && lineActions(op)}
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>

          {canWrite && !done && (
            <>
              <button
                type="button"
                className={styles.addLineFab}
                aria-label={t("stock.actions.addLine", "Add line")}
                title={t("stock.actions.addLine", "Add line")}
                onClick={() => setAddOpen(true)}
              >
                <Plus size={24} />
              </button>
              <StockDocAddLineModal
                open={addOpen}
                onClose={() => setAddOpen(false)}
                onPick={(hit) => {
                  setAddOpen(false);
                  setEditHit(hit);
                }}
              />
              <StockDocEditLineModal
                open={Boolean(editHit)}
                kind={kind}
                documentId={document.id}
                hit={editHit}
                onBack={() => {
                  setEditHit(null);
                  setAddOpen(true);
                }}
                onClose={() => {
                  setEditHit(null);
                  setAddOpen(false);
                }}
                onAdded={() => {
                  setEditHit(null);
                  setAddOpen(true);
                  void reload();
                }}
              />
              <StockDocUpdateLineModal
                open={Boolean(updateLine)}
                kind={kind}
                line={updateLine}
                onClose={() => setUpdateLine(null)}
                onSaved={() => {
                  setUpdateLine(null);
                  void reload();
                }}
              />
              <Modal
                open={Boolean(deleteLine)}
                onClose={() => setDeleteLine(null)}
                title={t("common.delete", "Delete")}
              >
                <p className={styles.confirmDeleteText}>
                  {t("stock.confirmDeleteLine", 'Delete line "{{name}}"?', {
                    name: deleteLine?.item_name ?? `#${deleteLine?.item_id ?? ""}`,
                  })}
                </p>
                <div className={styles.formActions}>
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => setDeleteLine(null)}
                  >
                    {t("common.cancel", "Cancel")}
                  </Button>
                  <Button
                    type="button"
                    variant="danger"
                    disabled={busy}
                    onClick={executeDeleteLine}
                  >
                    {t("common.delete", "Delete")}
                  </Button>
                </div>
              </Modal>
            </>
          )}
        </>
      ) : null}

      {error ? <div className={styles.error}>{error}</div> : null}
    </div>
  );
}
