import { useEffect, useState } from "react";
import { Button } from "@/components/posui/Button";
import { useLanguage } from "@/contexts/LanguageContext";
import { groupRowsByCurrency } from "@/lib/partner-balance";
import {
  fetchPartnerDocument,
  fetchPartnerDocuments,
  fetchPartnerOrder,
  fetchPartnerOrders,
  fetchPartnerPayments,
  fetchPartnerReconciliation,
  type PartnerDocumentLine,
  type PartnerDocumentSummary,
  type PartnerPayment,
} from "@/lib/partner-telegram-api";
import type { PartnerBalanceRow } from "@/types/partners";
import { formatAuthError } from "@/store/auth";
import { usePartnerSession } from "./PartnerSession";
import { formatAmount, formatDate, monthStart, today } from "./partner-format";
import styles from "./PartnerPortal.module.css";

export function PartnerDocumentPage({
  kind,
  titleKey,
  titleFallback,
  documentId,
  onOpen,
  onBack,
}: {
  kind: string;
  titleKey: string;
  titleFallback: string;
  documentId?: number;
  onOpen: (id: number) => void;
  onBack: () => void;
}) {
  const { t } = useLanguage();
  const { token } = usePartnerSession();
  const [startDate, setStartDate] = useState(monthStart);
  const [endDate, setEndDate] = useState(today);
  const [documents, setDocuments] = useState<PartnerDocumentSummary[]>([]);
  const [selected, setSelected] = useState<PartnerDocumentSummary | null>(null);
  const [lines, setLines] = useState<PartnerDocumentLine[]>([]);
  const [error, setError] = useState("");

  const load = async () => {
    setError("");
    try {
      const response = await fetchPartnerDocuments(token, kind, startDate, endDate);
      setDocuments(response.documents);
    } catch (loadError) {
      setError(formatAuthError(loadError));
    }
  };

  useEffect(() => {
    void load();
    // Dates are applied with the Show button so a refresh keeps the current range.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, token]);

  useEffect(() => {
    if (!documentId) {
      setSelected(null);
      setLines([]);
      return;
    }
    const known = documents.find((item) => item.id === documentId) ?? null;
    setSelected(known ?? { id: documentId, code: null, date: null, amount: null, description: "", status_id: null, performed: null });
    void fetchPartnerDocument(token, kind, documentId)
      .then((detail) => {
        setSelected(detail.document);
        setLines(detail.operations);
      })
      .catch((loadError) => setError(formatAuthError(loadError)));
  }, [documentId, documents, kind, token]);

  if (documentId && selected) {
    return (
      <DocumentView
        title={t(titleKey, titleFallback)}
        document={selected}
        lines={lines}
        onBack={onBack}
      />
    );
  }

  return (
    <section className={styles.page}>
      <h1>{t(titleKey, titleFallback)}</h1>
      <DateRange
        startDate={startDate}
        endDate={endDate}
        onStart={setStartDate}
        onEnd={setEndDate}
        onShow={() => void load()}
      />
      {error ? <p className={styles.error}>{error}</p> : null}
      {documents.length === 0 ? <p>{t("partnerApp.emptyHistory", "No stock operations in this period.")}</p> : null}
      <div className={styles.docList}>
        {documents.map((document) => (
          <button key={document.id} type="button" className={styles.doc} onClick={() => onOpen(document.id)}>
            <strong>{document.code || document.id}</strong>
            <span>{formatDate(document.date)}</span>
            <span>{document.amount != null ? formatAmount(document.amount) : ""}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

export function PartnerPaymentsPage() {
  const { t } = useLanguage();
  const { token } = usePartnerSession();
  const [startDate, setStartDate] = useState(monthStart);
  const [endDate, setEndDate] = useState(today);
  const [payments, setPayments] = useState<PartnerPayment[]>([]);
  const [error, setError] = useState("");

  const load = async () => {
    setError("");
    try {
      const response = await fetchPartnerPayments(token, startDate, endDate);
      setPayments(response.payments);
    } catch (loadError) {
      setError(formatAuthError(loadError));
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  return (
    <section className={styles.page}>
      <h1>{t("partnerApp.payments", "Payments")}</h1>
      <DateRange startDate={startDate} endDate={endDate} onStart={setStartDate} onEnd={setEndDate} onShow={() => void load()} />
      {error ? <p className={styles.error}>{error}</p> : null}
      {payments.length === 0 ? <p>{t("partnerApp.emptyPayments", "No payments in this period.")}</p> : null}
      {payments.length > 0 ? (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>{t("partners.balance.colDocumentCode", "Document code")}</th>
                <th>{t("partners.balance.colDate", "Date")}</th>
                <th>{t("partnerApp.direction", "Direction")}</th>
                <th>{t("partnerApp.total", "Total")}</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((payment) => (
                <tr key={payment.id}>
                  <td>{payment.code || payment.id}</td>
                  <td>{formatDate(payment.date)}</td>
                  <td>
                    {payment.payment_direction === "income"
                      ? t("partnerApp.income", "Incoming")
                      : payment.payment_direction === "outcome"
                        ? t("partnerApp.outcome", "Outgoing")
                        : payment.payment_type_name || "—"}
                  </td>
                  <td>{payment.amount != null ? formatAmount(payment.amount) : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

export function PartnerReconciliationPage() {
  const { t } = useLanguage();
  const { token } = usePartnerSession();
  const [startDate, setStartDate] = useState(monthStart);
  const [endDate, setEndDate] = useState(today);
  const [rows, setRows] = useState<PartnerBalanceRow[]>([]);
  const [error, setError] = useState("");
  const grouped = groupRowsByCurrency(rows);

  const load = async () => {
    setError("");
    try {
      const response = await fetchPartnerReconciliation(token, startDate, endDate);
      setRows(response.rows);
    } catch (loadError) {
      setError(formatAuthError(loadError));
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  return (
    <section className={styles.page}>
      <h1>{t("partnerApp.reconciliation", "Reconciliation")}</h1>
      <DateRange startDate={startDate} endDate={endDate} onStart={setStartDate} onEnd={setEndDate} onShow={() => void load()} />
      {error ? <p className={styles.error}>{error}</p> : null}
      {rows.length === 0 ? <p>{t("partners.balance.empty", "No transactions for this period.")}</p> : null}
      {grouped.map((group) => (
        <div key={group.key} className={styles.tableWrap}>
          <h2>{group.currency?.name ?? t("common.unknown", "Unknown")}</h2>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>{t("partners.balance.colDocumentType", "Document type")}</th>
                <th>{t("partners.balance.colDocumentCode", "Document code")}</th>
                <th>{t("partners.balance.colDate", "Date")}</th>
                <th>{t("partners.balance.colOpening", "Opening balance")}</th>
                <th>{t("partners.balance.colDebit", "Debit")}</th>
                <th>{t("partners.balance.colCredit", "Credit")}</th>
                <th>{t("partners.balance.colClosing", "Closing balance")}</th>
              </tr>
            </thead>
            <tbody>
              {group.rows.map((row) => (
                <tr key={row.id || `${group.key}-${row.document_code}-${row.date}`}>
                  <td>{row.document_type?.name ?? "—"}</td>
                  <td>{row.document_code ?? "—"}</td>
                  <td>{formatDate(row.date)}</td>
                  <td>{formatAmount(row.start_amount)}</td>
                  <td>{formatAmount(row.debit)}</td>
                  <td>{formatAmount(row.credit)}</td>
                  <td>{formatAmount(row.end_amount)}</td>
                </tr>
              ))}
              <tr>
                <td colSpan={4} />
                <td>{formatAmount(group.debitTotal)}</td>
                <td>{formatAmount(group.creditTotal)}</td>
                <td>{formatAmount(group.closingTotal)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      ))}
    </section>
  );
}

export function PartnerOrdersPage({ placed }: { placed?: string }) {
  const { t } = useLanguage();
  const { token } = usePartnerSession();
  const [orders, setOrders] = useState<PartnerDocumentSummary[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [selected, setSelected] = useState<PartnerDocumentSummary | null>(null);
  const [lines, setLines] = useState<PartnerDocumentLine[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    void fetchPartnerOrders(token)
      .then((response) => setOrders(response.orders))
      .catch((loadError) => setError(formatAuthError(loadError)));
  }, [token]);

  const open = async (order: PartnerDocumentSummary) => {
    setSelectedId(order.id);
    setSelected(order);
    try {
      const detail = await fetchPartnerOrder(token, order.id);
      setLines(detail.operations);
    } catch (loadError) {
      setError(formatAuthError(loadError));
    }
  };

  if (selectedId && selected) {
    return (
      <DocumentView
        title={t("partnerApp.orderDetail", "Order")}
        document={selected}
        lines={lines}
        onBack={() => {
          setSelectedId(null);
          setSelected(null);
        }}
      />
    );
  }

  return (
    <section className={styles.page}>
      <h1>{t("partnerApp.orders", "My orders")}</h1>
      {placed ? <p>{t("partnerApp.orderPlaced", "Order {{code}} was sent.", { code: placed })}</p> : null}
      {error ? <p className={styles.error}>{error}</p> : null}
      {orders.length === 0 ? <p>{t("partnerApp.emptyOrders", "No open orders.")}</p> : null}
      <div className={styles.docList}>
        {orders.map((order) => (
          <button key={order.id} type="button" className={styles.doc} onClick={() => void open(order)}>
            <strong>{order.code || order.id}</strong>
            <span>{formatDate(order.date)}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function DateRange({
  startDate,
  endDate,
  onStart,
  onEnd,
  onShow,
}: {
  startDate: string;
  endDate: string;
  onStart: (value: string) => void;
  onEnd: (value: string) => void;
  onShow: () => void;
}) {
  const { t } = useLanguage();
  return (
    <div className={styles.dates}>
      <label className={styles.field}>
        {t("partnerApp.from", "From")}
        <input className={styles.input} type="date" value={startDate} onChange={(event) => onStart(event.target.value)} />
      </label>
      <label className={styles.field}>
        {t("partnerApp.to", "To")}
        <input className={styles.input} type="date" value={endDate} onChange={(event) => onEnd(event.target.value)} />
      </label>
      <Button type="button" variant="secondary" onClick={onShow}>
        {t("partnerApp.load", "Show")}
      </Button>
    </div>
  );
}

function DocumentView({
  title,
  document,
  lines,
  onBack,
}: {
  title: string;
  document: PartnerDocumentSummary;
  lines: PartnerDocumentLine[];
  onBack: () => void;
}) {
  const { t } = useLanguage();
  const total = lines.reduce((sum, line) => sum + line.total, 0);
  return (
    <section className={styles.page}>
      <button type="button" className={styles.textButton} onClick={onBack}>
        {t("partnerApp.back", "Back")}
      </button>
      <h1>
        {title} {document.code || document.id}
      </h1>
      <p className={styles.muted}>{formatDate(document.date)}</p>
      {document.description ? <p>{document.description}</p> : null}
      {lines.map((line, index) => (
        <div key={`${line.item_name}-${index}`} className={styles.line}>
          <div>
            <strong>{line.item_name}</strong>
            <div className={styles.muted}>
              {formatAmount(line.quantity)} × {formatAmount(line.price)}
            </div>
          </div>
          <div>{formatAmount(line.total)}</div>
        </div>
      ))}
      <p>
        {t("partnerApp.total", "Total")}: {formatAmount(total)}
      </p>
    </section>
  );
}
