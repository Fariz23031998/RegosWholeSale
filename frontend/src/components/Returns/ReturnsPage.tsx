import { useCallback, useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { CalendarRange, Printer, Scale, Search, Users, Warehouse } from "lucide-react";
import { PartnerBalanceModal } from "@/components/POS/PartnerBalanceModal";
import { Button } from "@/components/posui/Button";
import { ReceiptModal } from "@/components/Receipt/ReceiptModal";
import { buildPrintContextFromReturn } from "@/lib/receipt-context-builder";
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
import { ReturnsDetailModal } from "@/components/Returns/ReturnsDetailModal";
import { useLanguage } from "@/contexts/LanguageContext";
import { useInfiniteScrollSentinel } from "@/hooks/use-infinite-scroll-sentinel";
import { DOCUMENT_LIST_PAGE_SIZE, usePagedList } from "@/hooks/use-paged-list";
import { usePermissions } from "@/hooks/use-permissions";
import { useWarehouseScope } from "@/hooks/use-warehouse-scope";
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
import { subscribeReferenceOptionsEvents } from "@/lib/catalog-events";
import { fetchRegosReferenceOptions } from "@/lib/settings-api";
import {
  fetchWholesaleReturnDocumentPayments,
  fetchWholesaleReturnDocuments,
  fetchWholesaleReturnOperations,
  type WholesaleOperationLine,
  type WholesalePaymentLine,
  type WholesaleReturnDocument,
} from "@/lib/sales-api";
import { filterWholesaleDocuments } from "@/lib/wholesale-document-search";
import { formatAuthError, useAuth } from "@/store/auth";
import type { RegosDefaultOption } from "@/types/settings";
import dashboardStyles from "@/components/Dashboard/Dashboard.module.css";
import styles from "./Returns.module.css";

type PresetPeriod = Exclude<DashboardPeriodPreset, "custom">;

type ReturnDetail = {
  document: WholesaleReturnDocument;
  operations: WholesaleOperationLine[];
  payments: WholesalePaymentLine[];
};

export function ReturnsPage() {
  const { t } = useLanguage();
  const token = useAuth((s) => s.accessToken);
  const user = useAuth((s) => s.user);
  const { canPrintDocuments } = usePermissions();
  const {
    canChangeWarehouse,
    defaultWarehouse,
    ready: warehouseScopeReady,
    scopedStockFilters,
    warehousesForLabel,
  } = useWarehouseScope();
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
  const [detailError, setDetailError] = useState("");
  const [open, setOpen] = useState<ReturnDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [printContext, setPrintContext] = useState<DocumentPrintContext | null>(null);
  const [printingId, setPrintingId] = useState<number | null>(null);
  const [balancePartner, setBalancePartner] = useState<{ id: number; name: string } | null>(null);
  const [search, setSearch] = useState("");

  const periodParams = useMemo(
    () => resolveDashboardPeriodParams(periodPreset, customRange),
    [customRange, periodPreset],
  );

  const effectiveStockFilters = useMemo(
    () => scopedStockFilters({ allStocks, stockIds: selectedStockIds }),
    [allStocks, scopedStockFilters, selectedStockIds],
  );

  const warehouseLabelWarehouses = canChangeWarehouse ? warehouses : warehousesForLabel;
  const warehouseLabelFilters = canChangeWarehouse
    ? { allStocks, stockIds: selectedStockIds }
    : effectiveStockFilters;

  const queryParams = useMemo(
    () =>
      resolveDashboardQueryParams(periodParams, {
        ...effectiveStockFilters,
        allPartners,
        partnerIds: selectedPartnerIds,
      }),
    [
      allPartners,
      effectiveStockFilters,
      periodParams,
      allPartners ? undefined : selectedPartnerIds,
    ],
  );

  const returnDocumentsQueryKey = useMemo(
    () => serializeDashboardQueryParams({ ...queryParams, limit: DOCUMENT_LIST_PAGE_SIZE }),
    [
      allPartners,
      effectiveStockFilters.allStocks,
      periodParams.start_date,
      periodParams.end_date,
      allPartners ? "" : selectedPartnerIds.join(","),
      effectiveStockFilters.allStocks ? "" : effectiveStockFilters.stockIds.join(","),
      warehouseScopeReady,
    ],
  );

  const periodModalRange = useMemo(() => {
    if (periodPreset === "custom" && customRange) return customRange;
    if (periodPreset !== "custom") return presetToCustomRange(periodPreset);
    return presetToCustomRange("week");
  }, [customRange, periodPreset]);

  const fetchPage = useCallback(
    async ({ offset, limit }: { offset: number; limit: number }) => {
      if (!token) return { items: [], next_offset: 0, total: 0 };
      const res = await fetchWholesaleReturnDocuments(token, { ...queryParams, offset, limit });
      return {
        items: res.documents,
        next_offset: res.next_offset,
        total: res.total,
      };
    },
    [queryParams, token],
  );

  const {
    items: returnDocuments,
    total: listTotal,
    loading,
    loadingMore,
    error: listError,
    hasMore,
    loadMore,
  } = usePagedList<WholesaleReturnDocument>({
    enabled: Boolean(token) && warehouseScopeReady,
    depsKey: returnDocumentsQueryKey,
    pageSize: DOCUMENT_LIST_PAGE_SIZE,
    fetchPage,
    mapError: (err) => formatAuthError(err, t("returns.errors.load")),
  });

  const loadError = detailError || listError;

  const sentinelRef = useInfiniteScrollSentinel(() => void loadMore(), {
    enabled: Boolean(token) && warehouseScopeReady && hasMore && !loading,
    itemsLength: returnDocuments.length,
  });

  useEffect(() => {
    if (!token) {
      setWarehouses([]);
      setPartners([]);
      return;
    }

    let cancelled = false;
    const cacheScope = user?.company_id != null ? { companyId: user.company_id } : undefined;

    const loadReferenceOptions = () => {
      void fetchRegosReferenceOptions(token, { cacheScope })
        .then((options) => {
          if (cancelled) return;
          setPartners(options.partners);
          if (canChangeWarehouse) {
            setWarehouses(options.warehouses);
            setSelectedStockIds((current) =>
              current.length > 0 ? current : options.warehouses.map((warehouse) => warehouse.id),
            );
          }
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
    };

    loadReferenceOptions();

    const unsubscribe = subscribeReferenceOptionsEvents(() => {
      void fetchRegosReferenceOptions(token, { force: true, cacheScope })
        .then((options) => {
          if (cancelled) return;
          setPartners(options.partners);
          if (canChangeWarehouse) {
            setWarehouses(options.warehouses);
          }
        })
        .catch(() => undefined);
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [canChangeWarehouse, token, user?.company_id]);

  useEffect(() => {
    if (!warehouseScopeReady || canChangeWarehouse) return;
    if (defaultWarehouse?.id) {
      setAllStocks(false);
      setSelectedStockIds([defaultWarehouse.id]);
    }
  }, [canChangeWarehouse, defaultWarehouse, warehouseScopeReady]);

  const filteredDocuments = useMemo(
    () =>
      filterWholesaleDocuments(returnDocuments, search, (doc) => [
        doc.wholesale_doc_id,
        doc.reason,
        doc.description,
      ]),
    [returnDocuments, search],
  );
  const total = filteredDocuments.reduce((s, x) => s + (x.amount ?? 0), 0);

  const loadReturnDetail = async (doc: WholesaleReturnDocument): Promise<ReturnDetail> => {
    if (!token) {
      throw new Error(t("common.notAuthenticated"));
    }
    const [operationsRes, paymentsRes] = await Promise.all([
      fetchWholesaleReturnOperations(token, doc.id),
      fetchWholesaleReturnDocumentPayments(token, doc.id),
    ]);
    return {
      document: doc,
      operations: operationsRes.operations,
      payments: paymentsRes.payments,
    };
  };

  const openDocument = async (doc: WholesaleReturnDocument) => {
    if (!token) return;
    setDetailLoading(true);
    setOpen({ document: doc, operations: [], payments: [] });
    try {
      const detail = await loadReturnDetail(doc);
      setOpen(detail);
    } catch (err: unknown) {
      setOpen(null);
      setDetailError(formatAuthError(err, t("returns.errors.loadDetails")));
    } finally {
      setDetailLoading(false);
    }
  };

  const printDocument = async (doc: WholesaleReturnDocument) => {
    if (!token || printingId !== null) return;
    setPrintingId(doc.id);
    setDetailError("");
    try {
      const detail = await loadReturnDetail(doc);
      setPrintContext(
        buildPrintContextFromReturn(detail.document, detail.operations, detail.payments, t),
      );
    } catch (err: unknown) {
      setDetailError(formatAuthError(err, t("returns.errors.loadPrint")));
    } finally {
      setPrintingId(null);
    }
  };

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>{t("returns.title")}</h1>
          <div className={styles.subtitle}>
            {loading
              ? t("common.loadingFromRegos")
              : `${filteredDocuments.length} ${t("returns.title").toLowerCase()} · ${formatCurrency(total)} · ${formatDashboardPeriodLabel(periodPreset, customRange, t)} · ${formatPartnerFilterLabel(allPartners, selectedPartnerIds, partners, t)} · ${formatWarehouseFilterLabel(warehouseLabelFilters.allStocks, warehouseLabelFilters.stockIds, warehouseLabelWarehouses, t)}`}
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
          {canChangeWarehouse ? (
            <button
              type="button"
              className={clsx(dashboardStyles.filter, dashboardStyles.filterMenu)}
              onClick={() => setWarehouseModalOpen(true)}
            >
              <Warehouse size={14} />
              {formatWarehouseFilterLabel(allStocks, selectedStockIds, warehouses, t)}
            </button>
          ) : (
            <span className={clsx(dashboardStyles.filter, dashboardStyles.filterMenu)}>
              <Warehouse size={14} />
              {formatWarehouseFilterLabel(
                warehouseLabelFilters.allStocks,
                warehouseLabelFilters.stockIds,
                warehouseLabelWarehouses,
                t,
              )}
            </span>
          )}
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
      {canChangeWarehouse ? (
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
      ) : null}

      {loadError && <div className={styles.empty}>{loadError}</div>}

      {!loading && returnDocuments.length > 0 ? (
        <div className={dashboardStyles.productsToolbar}>
          <div className={dashboardStyles.productsSearch}>
            <Search size={16} className={dashboardStyles.productsSearchIcon} />
            <input
              className={dashboardStyles.productsSearchInput}
              type="search"
              placeholder={t("returns.searchPlaceholder")}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              aria-label={t("returns.searchAria")}
            />
          </div>
        </div>
      ) : null}

      <div className={styles.table}>
        {loading ? (
          <div className={styles.empty}>{t("returns.loading")}</div>
        ) : returnDocuments.length === 0 ? (
          <div className={styles.empty}>{t("returns.empty")}</div>
        ) : filteredDocuments.length === 0 ? (
          <div className={styles.empty}>{t("returns.emptySearch")}</div>
        ) : (
          <table className={styles.tbl}>
            <thead>
              <tr>
                <th>{t("returns.table.return")}</th>
                <th>{t("returns.table.original")}</th>
                <th>{t("common.time")}</th>
                <th>{t("sales.table.partner")}</th>
                <th>{t("sales.table.attachedUser")}</th>
                <th>{t("sales.table.warehouse")}</th>
                <th>{t("returns.table.reason")}</th>
                <th className={styles.right}>{t("common.total")}</th>
                <th className={styles.printCol} aria-label={t("sales.print")} />
              </tr>
            </thead>
            <tbody>
              {filteredDocuments.map((doc) => (
                <tr
                  key={doc.id}
                  onClick={() => void openDocument(doc)}
                  style={{ cursor: detailLoading ? "wait" : "pointer" }}
                >
                  <td className={styles.id} data-label={t("returns.table.return")}>
                    #{doc.code || doc.id}
                  </td>
                  <td className={styles.id} data-label={t("returns.table.original")}>
                    {doc.wholesale_doc_id ? `#${doc.wholesale_doc_id}` : "—"}
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
                  <td data-label={t("returns.table.reason")} style={{ color: "var(--color-text-muted)" }}>
                    {doc.reason || "—"}
                  </td>
                  <td
                    className={styles.right}
                    data-label={t("common.total")}
                    style={{ fontWeight: 600, color: "var(--color-danger, #dc2626)" }}
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
                        aria-label={`${t("returns.printModalTitle")} #${doc.code || doc.id}`}
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

      {!loading && returnDocuments.length > 0 ? (
        <div className={styles.listFooter}>
          {listTotal > returnDocuments.length || hasMore ? (
            <div className={styles.listFooterMuted}>
              {t("common.showing", "Showing {{shown}} of {{total}}", {
                shown: returnDocuments.length,
                total: listTotal,
              })}
            </div>
          ) : null}
          {loadingMore ? (
            <div className={styles.listFooterMuted}>
              {t("common.loadingMore", "Loading more…")}
            </div>
          ) : null}
          <div ref={sentinelRef} className={styles.scrollSentinel} aria-hidden />
        </div>
      ) : null}

      {open && (
        <ReturnsDetailModal
          document={open.document}
          operations={open.operations}
          payments={open.payments}
          loading={detailLoading}
          onClose={() => setOpen(null)}
        />
      )}

      <ReceiptModal
        context={printContext}
        title={t("returns.printModalTitle")}
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
