import { useCallback, useEffect, useMemo, useState, type MouseEvent } from "react";
import { useNavigate } from "@tanstack/react-router";
import clsx from "clsx";
import { CalendarRange, Pencil, Plus, Search, Warehouse } from "lucide-react";
import { Button } from "@/components/posui/Button";
import { DashboardPeriodModal } from "@/components/Dashboard/DashboardPeriodModal";
import {
  DashboardPartnersModal,
  formatPartnerFilterLabel,
} from "@/components/Dashboard/DashboardPartnersModal";
import {
  DashboardWarehousesModal,
  formatWarehouseFilterLabel,
} from "@/components/Dashboard/DashboardWarehousesModal";
import { StockDocCreateModal } from "@/components/StockDocs/StockDocCreateModal";
import { StockDocEditModal } from "@/components/StockDocs/StockDocEditModal";
import { useLanguage } from "@/contexts/LanguageContext";
import { usePermissions } from "@/hooks/use-permissions";
import { useWarehouseScope } from "@/hooks/use-warehouse-scope";
import { filterPartnersByAllowedGroups } from "@/lib/category-scope";
import {
  formatDashboardPeriodLabel,
  presetToCustomRange,
  resolveDashboardPeriodParams,
  resolveDashboardQueryParams,
  serializeDashboardQueryParams,
  type DashboardCustomRange,
  type DashboardPeriodPreset,
} from "@/lib/dashboard-api";
import { formatCurrency, formatDateTime } from "@/lib/format";
import { subscribeReferenceOptionsEvents } from "@/lib/catalog-events";
import { fetchRegosDefaults, fetchRegosReferenceOptions } from "@/lib/settings-api";
import {
  fetchStockDocuments,
  type StockDocKind,
  type StockDocument,
} from "@/lib/stock-docs-api";
import {
  formatInoutTypeLabel,
  getStockDocDefinition,
  stockDocDetailTo,
} from "@/lib/stock-doc-definitions";
import { formatAuthError, useAuth } from "@/store/auth";
import { usePosConfig } from "@/store/pos-config";
import type {
  RegosDefaultOption,
  RegosPriceTypeOption,
  VatCalculationType,
} from "@/types/settings";
import dashboardStyles from "@/components/Dashboard/Dashboard.module.css";
import styles from "./StockDocs.module.css";

type Props = {
  kind: Exclude<StockDocKind, "wholesale">;
};

type InoutTypeFilter = "all" | "income" | "outcome";

export function StockDocsPage({ kind }: Props) {
  const def = getStockDocDefinition(kind);
  const { t } = useLanguage();
  const navigate = useNavigate();
  const token = useAuth((s) => s.accessToken);
  const user = useAuth((s) => s.user);
  const { can } = usePermissions();
  const canWrite = can(def.writePermission);
  const allowedPartnerGroupIds = usePosConfig((s) => s.allowedPartnerGroupIds);
  const {
    canChangeWarehouse,
    ready: warehouseScopeReady,
    scopedStockFilters,
    warehousesForLabel,
  } = useWarehouseScope();

  const [periodPreset, setPeriodPreset] = useState<DashboardPeriodPreset>("week");
  const [customRange, setCustomRange] = useState<DashboardCustomRange | null>(null);
  const [periodModalOpen, setPeriodModalOpen] = useState(false);
  const [warehouseModalOpen, setWarehouseModalOpen] = useState(false);
  const [partnerModalOpen, setPartnerModalOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [editDoc, setEditDoc] = useState<StockDocument | null>(null);
  const [warehouses, setWarehouses] = useState<RegosDefaultOption[]>([]);
  const [partners, setPartners] = useState<RegosDefaultOption[]>([]);
  const [priceTypes, setPriceTypes] = useState<RegosPriceTypeOption[]>([]);
  const [defaultVatCalculationType, setDefaultVatCalculationType] =
    useState<VatCalculationType>("No");
  const [allStocks, setAllStocks] = useState(true);
  const [selectedStockIds, setSelectedStockIds] = useState<number[]>([]);
  const [allPartners, setAllPartners] = useState(true);
  const [selectedPartnerIds, setSelectedPartnerIds] = useState<number[]>([]);
  const [inoutTypeFilter, setInoutTypeFilter] = useState<InoutTypeFilter>("all");
  const [documents, setDocuments] = useState<StockDocument[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  const refreshReferenceOptions = useCallback(async () => {
    if (!token) {
      setWarehouses([]);
      setPartners([]);
      setPriceTypes([]);
      return;
    }
    const cacheScope = user?.company_id != null ? { companyId: user.company_id } : undefined;
    try {
      const res = await fetchRegosReferenceOptions(token, { cacheScope });
      setWarehouses(res.warehouses ?? []);
      setPartners(res.partners ?? []);
      setPriceTypes(res.price_types ?? []);
    } catch {
      setWarehouses([]);
      setPartners([]);
      setPriceTypes([]);
    }
  }, [token, user?.company_id]);

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

  const scopedPartners = useMemo(
    () => filterPartnersByAllowedGroups(partners, allowedPartnerGroupIds),
    [allowedPartnerGroupIds, partners],
  );

  const queryParams = useMemo(
    () =>
      resolveDashboardQueryParams(periodParams, {
        ...effectiveStockFilters,
        allPartners: def.supportsPartnerFilter ? allPartners : true,
        partnerIds: def.supportsPartnerFilter ? selectedPartnerIds : [],
      }),
    [
      allPartners,
      def.supportsPartnerFilter,
      effectiveStockFilters,
      periodParams,
      selectedPartnerIds,
    ],
  );

  const documentsQueryKey = useMemo(
    () =>
      `${serializeDashboardQueryParams({
        ...queryParams,
        limit: 100,
      })}|${search.trim()}|${reloadKey}|${kind}|${kind === "inout" ? inoutTypeFilter : ""}`,
    [inoutTypeFilter, kind, queryParams, reloadKey, search],
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
      setPriceTypes([]);
      setDefaultVatCalculationType("No");
      return;
    }
    let cancelled = false;
    const cacheScope = user?.company_id != null ? { companyId: user.company_id } : undefined;
    const load = () => {
      if (!cancelled) void refreshReferenceOptions();
      void fetchRegosDefaults(token, { cacheScope })
        .then((res) => {
          if (cancelled) return;
          setDefaultVatCalculationType(res.defaults.vat_calculation_type ?? "No");
        })
        .catch(() => {
          if (cancelled) return;
          setDefaultVatCalculationType("No");
        });
    };
    load();
    const unsub = subscribeReferenceOptionsEvents(() => load());
    return () => {
      cancelled = true;
      unsub();
    };
  }, [refreshReferenceOptions, token, user?.company_id]);

  useEffect(() => {
    if (!token || !warehouseScopeReady) {
      if (!token) setDocuments([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError("");
    void fetchStockDocuments(token, kind, {
      ...queryParams,
      limit: 100,
      search: search.trim() || undefined,
      ...(kind === "inout" && inoutTypeFilter !== "all"
        ? { inout_type: inoutTypeFilter }
        : {}),
    })
      .then((res) => {
        if (cancelled) return;
        setDocuments(res.documents);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setDocuments([]);
        setError(formatAuthError(err, t("stock.errors.load", "Failed to load documents")));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [documentsQueryKey, token, warehouseScopeReady]);

  const openDocument = (doc: StockDocument) => {
    void navigate({
      to: stockDocDetailTo(kind),
      params: { id: String(doc.id) },
    });
  };

  const isDocumentDone = (doc: StockDocument) =>
    kind === "inventory" ? Boolean(doc.closed || doc.performed) : doc.performed;

  const openEditDocument = (doc: StockDocument, e: MouseEvent) => {
    e.stopPropagation();
    if (!canWrite) return;
    if (isDocumentDone(doc)) {
      setError(
        t("stock.errors.editPerformed", "Performed or closed documents cannot be edited."),
      );
      return;
    }
    setError("");
    setEditDoc(doc);
  };

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>{t(def.titleKey, def.titleFallback)}</h1>
          <div className={styles.subtitle}>
            {loading
              ? t("common.loadingFromRegos", "Loading from Regos…")
              : t(def.subtitleKey, def.subtitleFallback, {
                  count: documents.length,
                  period: formatDashboardPeriodLabel(periodPreset, customRange, t),
                  warehouses: formatWarehouseFilterLabel(
                    warehouseLabelFilters.allStocks,
                    warehouseLabelFilters.stockIds,
                    warehouseLabelWarehouses,
                    t,
                  ),
                  partners: def.supportsPartnerFilter
                    ? formatPartnerFilterLabel(allPartners, selectedPartnerIds, partners, t)
                    : "",
                })}
          </div>
        </div>
        <div className={styles.actions}>
          {canWrite && def.supportsCreate && (
            <Button type="button" onClick={() => setCreateOpen(true)}>
              <Plus size={16} />
              {t("common.create", "Create")}
            </Button>
          )}
        </div>
      </div>

      <div className={styles.filters}>
        <div className={styles.searchWrap}>
          <Search size={16} className={styles.searchIcon} />
          <input
            className={styles.searchInput}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("stock.searchPlaceholder", "Search by number…")}
          />
        </div>
        <button
          type="button"
          className={`${dashboardStyles.filter} ${dashboardStyles.filterMenu}`}
          onClick={() => setPeriodModalOpen(true)}
        >
          <CalendarRange size={14} />
          {formatDashboardPeriodLabel(periodPreset, customRange, t)}
        </button>
        <button
          type="button"
          className={`${dashboardStyles.filter} ${dashboardStyles.filterMenu}`}
          onClick={() => canChangeWarehouse && setWarehouseModalOpen(true)}
          disabled={!canChangeWarehouse}
        >
          <Warehouse size={14} />
          {formatWarehouseFilterLabel(
            warehouseLabelFilters.allStocks,
            warehouseLabelFilters.stockIds,
            warehouseLabelWarehouses,
            t,
          )}
        </button>
        {def.supportsPartnerFilter && (
          <button
            type="button"
            className={`${dashboardStyles.filter} ${dashboardStyles.filterMenu}`}
            onClick={() => setPartnerModalOpen(true)}
          >
            {formatPartnerFilterLabel(allPartners, selectedPartnerIds, partners, t)}
          </button>
        )}
      </div>

      {kind === "inout" && (
        <div className={styles.typeTabs}>
          {(
            [
              ["all", t("stock.inout.filterAll", "All")],
              ["income", t("stock.inout.income", "Receipt")],
              ["outcome", t("stock.inout.outcome", "Write-off")],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={clsx(styles.typeTab, inoutTypeFilter === value && styles.typeTabActive)}
              onClick={() => setInoutTypeFilter(value)}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {error ? <div className={styles.error}>{error}</div> : null}

      <div className={styles.table}>
        {loading && documents.length === 0 ? (
          <div className={styles.empty}>{t("common.loading")}</div>
        ) : documents.length === 0 ? (
          <div className={styles.empty}>{t("common.nothing", "Nothing found")}</div>
        ) : (
          <>
            <table className={styles.tbl}>
              <thead>
                <tr>
                  <th>{t("stock.table.code", "Code")}</th>
                  <th>{t("common.date")}</th>
                  {def.showSenderReceiver ? (
                    <>
                      <th>{t("stock.table.sender", "From")}</th>
                      <th>{t("stock.table.receiver", "To")}</th>
                    </>
                  ) : (
                    <th>{t("stock.table.warehouse", "Warehouse")}</th>
                  )}
                  {kind === "inout" && <th>{t("stock.table.inoutType", "Type")}</th>}
                  {def.supportsPartnerFilter && <th>{t("stock.table.partner", "Partner")}</th>}
                  <th>{t("common.description")}</th>
                  <th>{t("stock.table.status", "Status")}</th>
                  <th className={styles.right}>{t("common.amount")}</th>
                  {canWrite ? <th className={styles.actionsCol} /> : null}
                </tr>
              </thead>
              <tbody>
                {documents.map((doc) => {
                  const done = isDocumentDone(doc);
                  return (
                    <tr key={doc.id} onClick={() => openDocument(doc)}>
                      <td className={styles.id}>#{doc.code || doc.id}</td>
                      <td>
                        {doc.date > 0
                          ? formatDateTime(new Date(doc.date * 1000).toISOString())
                          : "—"}
                      </td>
                      {def.showSenderReceiver ? (
                        <>
                          <td>{doc.stock_sender_name ?? "—"}</td>
                          <td>{doc.stock_receiver_name ?? "—"}</td>
                        </>
                      ) : (
                        <td>{doc.stock_name ?? "—"}</td>
                      )}
                      {kind === "inout" && (
                        <td>{formatInoutTypeLabel(doc.inout_type, t)}</td>
                      )}
                      {def.supportsPartnerFilter && <td>{doc.partner_name ?? "—"}</td>}
                      <td className={styles.descriptionCell}>
                        {doc.description?.trim() ? doc.description : "—"}
                      </td>
                      <td>
                        <span
                          className={`${styles.badge} ${done ? styles.badgeDone : styles.badgeDraft}`}
                        >
                          {done
                            ? t(def.performedLabelKey, def.performedLabelFallback)
                            : t(def.draftLabelKey, def.draftLabelFallback)}
                        </span>
                      </td>
                      <td className={styles.right}>
                        {doc.amount != null ? formatCurrency(doc.amount) : "—"}
                      </td>
                      {canWrite ? (
                        <td className={styles.actionsCol}>
                          <Button
                            type="button"
                            size="icon"
                            variant="secondary"
                            disabled={done}
                            aria-label={t("common.edit", "Edit")}
                            title={
                              done
                                ? t(
                                    "stock.errors.editPerformed",
                                    "Performed or closed documents cannot be edited.",
                                  )
                                : t("common.edit", "Edit")
                            }
                            onClick={(e) => openEditDocument(doc, e)}
                          >
                            <Pencil size={16} />
                          </Button>
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <div className={styles.cardList}>
              {documents.map((doc) => {
                const done = isDocumentDone(doc);
                const place = def.showSenderReceiver
                  ? `${doc.stock_sender_name ?? "—"} → ${doc.stock_receiver_name ?? "—"}`
                  : (doc.stock_name ?? "—");
                return (
                  <div key={doc.id} className={styles.docCard}>
                    <button
                      type="button"
                      className={styles.docCardMain}
                      onClick={() => openDocument(doc)}
                    >
                      <div className={styles.docCardTop}>
                        <span className={styles.id}>#{doc.code || doc.id}</span>
                        <span
                          className={`${styles.badge} ${done ? styles.badgeDone : styles.badgeDraft}`}
                        >
                          {done
                            ? t(def.performedLabelKey, def.performedLabelFallback)
                            : t(def.draftLabelKey, def.draftLabelFallback)}
                        </span>
                      </div>
                      <div className={styles.docCardDate}>
                        {doc.date > 0
                          ? formatDateTime(new Date(doc.date * 1000).toISOString())
                          : "—"}
                      </div>
                      <div className={styles.docCardPlace}>{place}</div>
                      {kind === "inout" ? (
                        <div className={styles.docCardPlace}>
                          {formatInoutTypeLabel(doc.inout_type, t)}
                        </div>
                      ) : null}
                      {def.supportsPartnerFilter && doc.partner_name ? (
                        <div className={styles.docCardPlace}>{doc.partner_name}</div>
                      ) : null}
                      {doc.description?.trim() ? (
                        <div className={styles.docCardDescription}>{doc.description}</div>
                      ) : null}
                      <div className={styles.docCardAmount}>
                        {doc.amount != null ? formatCurrency(doc.amount) : "—"}
                      </div>
                    </button>
                    {canWrite ? (
                      <div className={styles.docCardActions}>
                        <Button
                          type="button"
                          size="icon"
                          variant="secondary"
                          disabled={done}
                          aria-label={t("common.edit", "Edit")}
                          title={
                            done
                              ? t(
                                  "stock.errors.editPerformed",
                                  "Performed or closed documents cannot be edited.",
                                )
                              : t("common.edit", "Edit")
                          }
                          onClick={(e) => openEditDocument(doc, e)}
                        >
                          <Pencil size={16} />
                        </Button>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </>
        )}
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
      <DashboardWarehousesModal
        open={warehouseModalOpen}
        onClose={() => setWarehouseModalOpen(false)}
        warehouses={warehouses}
        allStocks={allStocks}
        selectedStockIds={selectedStockIds}
        onApply={({ allStocks: nextAll, stockIds }) => {
          setAllStocks(nextAll);
          setSelectedStockIds(stockIds);
        }}
      />
      {def.supportsPartnerFilter && (
        <DashboardPartnersModal
          open={partnerModalOpen}
          onClose={() => setPartnerModalOpen(false)}
          partners={scopedPartners}
          allPartners={allPartners}
          selectedPartnerIds={selectedPartnerIds}
          onApply={({ allPartners: nextAll, partnerIds }) => {
            setAllPartners(nextAll);
            setSelectedPartnerIds(partnerIds);
          }}
        />
      )}

      {createOpen && (
        <StockDocCreateModal
          kind={kind}
          warehouses={warehouses}
          partners={scopedPartners}
          priceTypes={priceTypes}
          defaultVatCalculationType={defaultVatCalculationType}
          onPartnersChanged={refreshReferenceOptions}
          onClose={() => setCreateOpen(false)}
          onCreated={(id) => {
            setCreateOpen(false);
            setReloadKey((k) => k + 1);
            void navigate({
              to: stockDocDetailTo(kind),
              params: { id: String(id) },
            });
          }}
        />
      )}
      {editDoc ? (
        <StockDocEditModal
          kind={kind}
          document={editDoc}
          warehouses={warehouses}
          partners={partners}
          priceTypes={priceTypes}
          onPartnersChanged={refreshReferenceOptions}
          onClose={() => setEditDoc(null)}
          onSaved={() => {
            setEditDoc(null);
            setReloadKey((k) => k + 1);
          }}
        />
      ) : null}
    </div>
  );
}
