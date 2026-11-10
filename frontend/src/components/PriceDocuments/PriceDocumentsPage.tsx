import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { CalendarRange, Search } from "lucide-react";
import { DataTable } from "@/components/DataTable/DataTable";
import { DashboardPeriodModal } from "@/components/Dashboard/DashboardPeriodModal";
import { useLanguage } from "@/contexts/LanguageContext";
import {
  formatDashboardPeriodLabel,
  presetToCustomRange,
  resolveDashboardPeriodParams,
  type DashboardCustomRange,
  type DashboardPeriodPreset,
} from "@/lib/dashboard-api";
import { formatDateTime } from "@/lib/format";
import { fetchPriceDocuments, type PriceDocument } from "@/lib/price-documents-api";
import { fetchRegosReferenceOptions } from "@/lib/settings-api";
import { formatAuthError, useAuth } from "@/store/auth";
import type { RegosPriceTypeOption } from "@/types/settings";
import dashboardStyles from "@/components/Dashboard/Dashboard.module.css";
import styles from "@/components/StockDocs/StockDocs.module.css";

export function PriceDocumentsPage() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const token = useAuth((state) => state.accessToken);
  const user = useAuth((state) => state.user);
  const [periodPreset, setPeriodPreset] = useState<DashboardPeriodPreset>("week");
  const [customRange, setCustomRange] = useState<DashboardCustomRange | null>(null);
  const [periodModalOpen, setPeriodModalOpen] = useState(false);
  const [priceTypeId, setPriceTypeId] = useState<number | null>(null);
  const [priceTypes, setPriceTypes] = useState<RegosPriceTypeOption[]>([]);
  const [documents, setDocuments] = useState<PriceDocument[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");

  const periodParams = useMemo(
    () => resolveDashboardPeriodParams(periodPreset, customRange),
    [customRange, periodPreset],
  );
  const periodModalRange = useMemo(() => {
    if (periodPreset === "custom" && customRange) return customRange;
    if (periodPreset !== "custom") return presetToCustomRange(periodPreset);
    return presetToCustomRange("week");
  }, [customRange, periodPreset]);

  useEffect(() => {
    if (!token) {
      setPriceTypes([]);
      return;
    }
    const cacheScope = user?.company_id != null ? { companyId: user.company_id } : undefined;
    void fetchRegosReferenceOptions(token, { cacheScope })
      .then((response) => setPriceTypes(response.price_types ?? []))
      .catch(() => setPriceTypes([]));
  }, [token, user?.company_id]);

  useEffect(() => {
    if (!token) {
      setDocuments([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError("");
    void fetchPriceDocuments(token, {
      startDate: periodParams.start_date,
      endDate: periodParams.end_date,
      search,
      priceTypeId: priceTypeId ?? undefined,
      limit: 100,
    })
      .then((response) => {
        if (!cancelled) setDocuments(response.documents);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setDocuments([]);
        setError(formatAuthError(err, t("prices.errors.load", "Failed to load documents")));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [periodParams.end_date, periodParams.start_date, priceTypeId, search, t, token]);

  const openDocument = (document: PriceDocument) => {
    void navigate({
      to: "/price-documents/$id",
      params: { id: String(document.id) },
    });
  };

  const columns = useMemo<ColumnDef<PriceDocument, any>[]>(
    () => [
      {
        id: "code",
        accessorFn: (document) => document.code || String(document.id),
        header: t("stock.table.code", "Code"),
        cell: ({ row }) => `#${row.original.code || row.original.id}`,
        meta: { cellClassName: styles.id },
      },
      {
        id: "date",
        accessorFn: (document) => document.date,
        header: t("common.date"),
        cell: ({ row }) =>
          row.original.date > 0
            ? formatDateTime(new Date(row.original.date * 1000).toISOString())
            : "—",
      },
      {
        id: "priceType",
        accessorFn: (document) => document.price_type_name,
        header: t("prices.priceType", "Price type"),
        cell: ({ row }) => row.original.price_type_name || "—",
      },
      {
        id: "description",
        accessorFn: (document) => document.description,
        header: t("common.description"),
        size: 240,
        cell: ({ row }) => row.original.description.trim() || "—",
        meta: { cellClassName: styles.descriptionCell },
      },
      {
        id: "status",
        accessorFn: (document) => document.performed,
        header: t("stock.table.status", "Status"),
        cell: ({ row }) => (
          <span
            className={`${styles.badge} ${row.original.performed ? styles.badgeDone : styles.badgeDraft}`}
          >
            {row.original.performed
              ? t("stock.status.performed", "Performed")
              : t("stock.status.draft", "Draft")}
          </span>
        ),
      },
    ],
    [t],
  );

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>{t("prices.title", "Price documents")}</h1>
          <div className={styles.subtitle}>
            {loading
              ? t("common.loadingFromRegos", "Loading from Regos…")
              : t("prices.subtitle", "{{count}} documents · {{period}}", {
                  count: documents.length,
                  period: formatDashboardPeriodLabel(periodPreset, customRange, t),
                })}
          </div>
        </div>
      </div>

      <div className={styles.filters}>
        <div className={styles.searchWrap}>
          <Search size={16} className={styles.searchIcon} />
          <input
            className={styles.searchInput}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
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
        <select
          className={styles.filterSelect}
          value={priceTypeId ?? ""}
          aria-label={t("prices.priceType", "Price type")}
          onChange={(event) => setPriceTypeId(event.target.value ? Number(event.target.value) : null)}
        >
          <option value="">{t("prices.allPriceTypes", "All price types")}</option>
          {priceTypes.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </div>

      {error ? <div className={styles.error}>{error}</div> : null}

      <div className={styles.table}>
        {loading && documents.length === 0 ? (
          <div className={styles.empty}>{t("common.loading")}</div>
        ) : documents.length === 0 ? (
          <div className={styles.empty}>{t("common.nothing", "Nothing found")}</div>
        ) : (
          <>
            <DataTable
              tableKey="priceDocuments"
              data={documents}
              columns={columns}
              className={styles.tbl}
              getRowId={(document) => String(document.id)}
              onRowClick={openDocument}
            />
            <div className={styles.cardList}>
              {documents.map((document) => (
                <div key={document.id} className={styles.docCard}>
                  <button
                    type="button"
                    className={styles.docCardMain}
                    onClick={() => openDocument(document)}
                  >
                    <div className={styles.docCardTop}>
                      <span className={styles.id}>#{document.code || document.id}</span>
                      <span
                        className={`${styles.badge} ${document.performed ? styles.badgeDone : styles.badgeDraft}`}
                      >
                        {document.performed
                          ? t("stock.status.performed", "Performed")
                          : t("stock.status.draft", "Draft")}
                      </span>
                    </div>
                    <div className={styles.docCardDate}>
                      {document.date > 0
                        ? formatDateTime(new Date(document.date * 1000).toISOString())
                        : "—"}
                    </div>
                    <div className={styles.docCardPlace}>{document.price_type_name || "—"}</div>
                    {document.description.trim() ? (
                      <div className={styles.docCardDescription}>{document.description}</div>
                    ) : null}
                  </button>
                </div>
              ))}
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
          setPeriodModalOpen(false);
        }}
      />
    </div>
  );
}
