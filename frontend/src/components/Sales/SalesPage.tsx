import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { CalendarRange, Printer, Scale, Search, Users, Warehouse } from "lucide-react";
import { PartnerBalanceModal } from "@/components/POS/PartnerBalanceModal";
import { Button } from "@/components/posui/Button";
import { ReceiptModal } from "@/components/Receipt/ReceiptModal";
import { buildPrintContextFromWholesale } from "@/lib/receipt-context-builder";
import type { DocumentPrintContext } from "@/lib/receipt-print-context";
import { DashboardPeriodModal } from "@/components/Dashboard/DashboardPeriodModal";
import {
  DashboardPartnersModal,
  formatPartnerFilterLabel,
} from "@/components/Dashboard/DashboardPartnersModal";
import {
  DashboardWarehousesModal,
  formatWarehouseFilterLabel,
} from "@/components/Dashboard/DashboardWarehousesModal";
import { SalesDetailModal } from "@/components/Sales/SalesDetailModal";
import { useLanguage } from "@/contexts/LanguageContext";
import { usePermissions } from "@/hooks/use-permissions";
import {
  formatDashboardPeriodLabel,
  getPeriodLabel,
  presetToCustomRange,
  resolveDashboardPeriodParams,
  resolveDashboardQueryParams,
  serializeDashboardQueryParams,
  type DashboardCustomRange,
  type DashboardPeriodPreset,
} from "@/lib/dashboard-api";
import { formatCurrency, formatDateTime } from "@/lib/format";
import { fetchRegosReferenceOptions } from "@/lib/settings-api";
import {
  fetchWholesaleDocumentPayments,
  fetchWholesaleDocuments,
  fetchWholesaleOperations,
  type WholesaleDocument,
  type WholesaleOperationLine,
  type WholesalePaymentLine,
} from "@/lib/sales-api";
import { filterWholesaleDocuments } from "@/lib/wholesale-document-search";
import { formatAuthError, useAuth } from "@/store/auth";
import type { RegosDefaultOption } from "@/types/settings";
import dashboardStyles from "@/components/Dashboard/Dashboard.module.css";
import styles from "./Sales.module.css";

type PresetPeriod = Exclude<DashboardPeriodPreset, "custom">;

type SaleDetail = {
  document: WholesaleDocument;
  operations: WholesaleOperationLine[];
  payments: WholesalePaymentLine[];
};

export function SalesPage() {
  const { t } = useLanguage();
  const token = useAuth((s) => s.accessToken);
  const { canPrintDocuments } = usePermissions();
  const [periodPreset, setPeriodPreset] = useState<DashboardPeriodPreset>("week");
  const [customRange, setCustomRange] = useState<DashboardCustomRange | null>(null);
  const [periodModalOpen, setPeriodModalOpen] = useState(false);
  const [warehouseModalOpen, setWarehouseModalOpen] = useState(false);
  const [partnerModalOpen, setPartnerModalOpen] = useState(false);
  const [warehouses, setWarehouses] = useState<RegosDefaultOption[]>([]);
  const [partners, setPartners] = useState<RegosDefaultOption[]>([]);
  const [allStocks, setAllStocks] = useState(true);
  const [selectedStockIds, setSelectedStockIds] = useState<number[]>([]);
  const [allPartners, setAllPartners] = useState(true);
  const [selectedPartnerIds, setSelectedPartnerIds] = useState<number[]>([]);
  const [documents, setDocuments] = useState<WholesaleDocument[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<SaleDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [printContext, setPrintContext] = useState<DocumentPrintContext | null>(null);
  const [printingId, setPrintingId] = useState<number | null>(null);
  const [balancePartner, setBalancePartner] = useState<{ id: number; name: string } | null>(null);
  const [search, setSearch] = useState("");

  const periodParams = useMemo(
    () => resolveDashboardPeriodParams(periodPreset, customRange),
    [customRange, periodPreset],
  );

  const queryParams = useMemo(
    () =>
      resolveDashboardQueryParams(periodParams, {
        allStocks,
        stockIds: selectedStockIds,
        allPartners,
        partnerIds: selectedPartnerIds,
      }),
    [allPartners, allStocks, periodParams, allPartners ? undefined : selectedPartnerIds, allStocks ? undefined : selectedStockIds],
  );

  const documentsQueryKey = useMemo(
    () => serializeDashboardQueryParams({ ...queryParams, limit: 100 }),
    [
      allPartners,
      allStocks,
      periodParams.start_date,
      periodParams.end_date,
      allPartners ? "" : selectedPartnerIds.join(","),
      allStocks ? "" : selectedStockIds.join(","),
    ],
  );

  const periodModalRange = useMemo(() => {
    if (periodPreset === "custom" && customRange) return customRange;
    if (periodPreset !== "custom") return presetToCustomRange(periodPreset);
    return presetToCustomRange("week");
  }, [customRange, periodPreset]);

  useEffect(() => {
    if (!token) {
      setWarehouses([]);
      setPartners([]);
      return;
    }

    let cancelled = false;
    void fetchRegosReferenceOptions(token)
      .then((options) => {
        if (cancelled) return;
        setWarehouses(options.warehouses);
        setPartners(options.partners);
        setSelectedStockIds((current) =>
          current.length > 0 ? current : options.warehouses.map((warehouse) => warehouse.id),
        );
        setSelectedPartnerIds((current) =>
          current.length > 0 ? current : options.partners.map((partner) => partner.id),
        );
      })
      .catch(() => {
        if (!cancelled) {
          setWarehouses([]);
          setPartners([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    if (!token) {
      setDocuments([]);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError("");

    void fetchWholesaleDocuments(token, { ...queryParams, limit: 100 })
      .then((res) => {
        if (cancelled) return;
        setDocuments(res.documents);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setDocuments([]);
        setError(formatAuthError(err, t("sales.errors.load")));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [documentsQueryKey, token]);

  const filtered = useMemo(
    () => filterWholesaleDocuments(documents, search),
    [documents, search],
  );
  const total = filtered.reduce((s, x) => s + (x.amount ?? 0), 0);

  const loadSaleDetail = async (doc: WholesaleDocument): Promise<SaleDetail> => {
    if (!token) {
      throw new Error(t("common.notAuthenticated"));
    }
    const [operationsRes, paymentsRes] = await Promise.all([
      fetchWholesaleOperations(token, doc.id),
      fetchWholesaleDocumentPayments(token, doc.id),
    ]);
    return {
      document: doc,
      operations: operationsRes.operations,
      payments: paymentsRes.payments,
    };
  };

  const openDocument = async (doc: WholesaleDocument) => {
    if (!token) return;
    setDetailLoading(true);
    setOpen({ document: doc, operations: [], payments: [] });
    try {
      const detail = await loadSaleDetail(doc);
      setOpen(detail);
    } catch (err: unknown) {
      setOpen(null);
      setError(formatAuthError(err, t("sales.errors.loadDetails")));
    } finally {
      setDetailLoading(false);
    }
  };

  const printDocument = async (doc: WholesaleDocument) => {
    if (!token || printingId !== null) return;
    setPrintingId(doc.id);
    setError("");
    try {
      const detail = await loadSaleDetail(doc);
      setPrintContext(
        buildPrintContextFromWholesale(detail.document, detail.operations, detail.payments, t),
      );
    } catch (err: unknown) {
      setError(formatAuthError(err, t("sales.errors.loadPrint")));
    } finally {
      setPrintingId(null);
    }
  };

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>{t("sales.title")}</h1>
          <div className={styles.subtitle}>
            {loading
              ? t("common.loadingFromRegos")
              : t("sales.subtitle", undefined, {
                  count: filtered.length,
                  total: formatCurrency(total),
                  period: formatDashboardPeriodLabel(periodPreset, customRange, t),
                  warehouses: formatWarehouseFilterLabel(allStocks, selectedStockIds, warehouses, t),
                  partners: formatPartnerFilterLabel(allPartners, selectedPartnerIds, partners, t),
                })}
          </div>
        </div>
        <div className={dashboardStyles.filters}>
          {(["today", "week", "month", "all"] as PresetPeriod[]).map((value) => (
            <button
              key={value}
              type="button"
              className={clsx(
                dashboardStyles.filter,
                periodPreset === value && dashboardStyles.filterActive,
              )}
              onClick={() => {
                setPeriodPreset(value);
                setCustomRange(null);
              }}
            >
              {getPeriodLabel(value, t)}
            </button>
          ))}
          <button
            type="button"
            className={clsx(
              dashboardStyles.filter,
              dashboardStyles.filterMenu,
              periodPreset === "custom" && dashboardStyles.filterActive,
            )}
            onClick={() => setPeriodModalOpen(true)}
          >
            <CalendarRange size={14} />
            {t("dashboard.period")}
          </button>
          <button
            type="button"
            className={clsx(dashboardStyles.filter, dashboardStyles.filterMenu)}
            onClick={() => setPartnerModalOpen(true)}
          >
            <Users size={14} />
            {formatPartnerFilterLabel(allPartners, selectedPartnerIds, partners, t)}
          </button>
          <button
            type="button"
            className={clsx(dashboardStyles.filter, dashboardStyles.filterMenu)}
            onClick={() => setWarehouseModalOpen(true)}
          >
            <Warehouse size={14} />
            {formatWarehouseFilterLabel(allStocks, selectedStockIds, warehouses, t)}
          </button>
        </div>
      </div>

      <DashboardPeriodModal
        open={periodModalOpen}
        onClose={() => setPeriodModalOpen(false)}
        initialRange={periodModalRange}
        onApply={(range) => {
          setCustomRange(range);
          setPeriodPreset("custom");
        }}
      />
      <DashboardPartnersModal
        open={partnerModalOpen}
        onClose={() => setPartnerModalOpen(false)}
        partners={partners}
        allPartners={allPartners}
        selectedPartnerIds={selectedPartnerIds}
        onApply={({ allPartners: nextAllPartners, partnerIds }) => {
          setAllPartners(nextAllPartners);
          setSelectedPartnerIds(partnerIds);
        }}
      />
      <DashboardWarehousesModal
        open={warehouseModalOpen}
        onClose={() => setWarehouseModalOpen(false)}
        warehouses={warehouses}
        allStocks={allStocks}
        selectedStockIds={selectedStockIds}
        onApply={({ allStocks: nextAllStocks, stockIds }) => {
          setAllStocks(nextAllStocks);
          setSelectedStockIds(stockIds);
        }}
      />

      {error && <div className={styles.empty}>{error}</div>}

      {!loading && documents.length > 0 ? (
        <div className={dashboardStyles.productsToolbar}>
          <div className={dashboardStyles.productsSearch}>
            <Search size={16} className={dashboardStyles.productsSearchIcon} />
            <input
              className={dashboardStyles.productsSearchInput}
              type="search"
              placeholder={t("sales.searchPlaceholder")}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              aria-label={t("sales.searchAria")}
            />
          </div>
        </div>
      ) : null}

      <div className={styles.table}>
        {loading ? (
          <div className={styles.empty}>{t("sales.loading")}</div>
        ) : documents.length === 0 ? (
          <div className={styles.empty}>{t("sales.empty")}</div>
        ) : filtered.length === 0 ? (
          <div className={styles.empty}>{t("sales.emptySearch")}</div>
        ) : (
          <table className={styles.tbl}>
            <thead>
              <tr>
                <th>{t("sales.table.receipt")}</th>
                <th>{t("common.time")}</th>
                <th>{t("sales.table.partner")}</th>
                <th>{t("sales.table.attachedUser")}</th>
                <th>{t("sales.table.warehouse")}</th>
                <th className={styles.right}>{t("common.total")}</th>
                <th className={styles.printCol} aria-label={t("sales.print")} />
              </tr>
            </thead>
            <tbody>
              {filtered.map((doc) => (
                <tr
                  key={doc.id}
                  onClick={() => void openDocument(doc)}
                  style={{ cursor: detailLoading ? "wait" : "pointer" }}
                >
                  <td className={styles.id} data-label={t("sales.table.receipt")}>
                    #{doc.code || doc.id}
                  </td>
                  <td data-label={t("common.time")}>
                    {doc.date > 0
                      ? formatDateTime(new Date(doc.date * 1000).toISOString())
                      : "—"}
                  </td>
                  <td data-label={t("sales.table.partner")}>{doc.partner_name ?? "—"}</td>
                  <td data-label={t("sales.table.attachedUser")}>
                    {doc.attached_user_name ?? "—"}
                  </td>
                  <td data-label={t("sales.table.warehouse")}>{doc.stock_name ?? "—"}</td>
                  <td
                    className={styles.right}
                    data-label={t("common.total")}
                    style={{ fontWeight: 600 }}
                  >
                    {formatCurrency(doc.amount ?? 0)}
                  </td>
                  <td className={styles.printCol} data-label={t("common.actions")}>
                    <div className={styles.rowActions}>
                      {doc.partner_id ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label={t("partners.balance.view", "View balance for {{name}}", {
                            name: doc.partner_name ?? String(doc.partner_id),
                          })}
                          onClick={(e) => {
                            e.stopPropagation();
                            setBalancePartner({
                              id: doc.partner_id!,
                              name: doc.partner_name ?? String(doc.partner_id),
                            });
                          }}
                        >
                          <Scale size={16} />
                        </Button>
                      ) : null}
                      {canPrintDocuments() ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={t("sales.printReceipt", undefined, { id: doc.code || doc.id })}
                        disabled={printingId === doc.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          void printDocument(doc);
                        }}
                      >
                        <Printer size={16} />
                      </Button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {open && (
        <SalesDetailModal
          document={open.document}
          operations={open.operations}
          payments={open.payments}
          loading={detailLoading}
          onClose={() => setOpen(null)}
        />
      )}

      <ReceiptModal
        context={printContext}
        title={t("sales.printModalTitle")}
        closeLabel={t("common.close")}
        onClose={() => setPrintContext(null)}
      />

      {balancePartner && token ? (
        <PartnerBalanceModal
          open
          onClose={() => setBalancePartner(null)}
          token={token}
          partnerId={balancePartner.id}
          partnerName={balancePartner.name}
        />
      ) : null}
    </div>
  );
}
