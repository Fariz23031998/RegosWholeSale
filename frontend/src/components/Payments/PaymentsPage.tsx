import { useCallback, useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { CalendarRange, Plus, Search, Users } from "lucide-react";
import { DashboardPeriodModal } from "@/components/Dashboard/DashboardPeriodModal";
import {
  DashboardPartnersModal,
  formatPartnerFilterLabel,
} from "@/components/Dashboard/DashboardPartnersModal";
import { PaymentCreateModal } from "@/components/Payments/PaymentCreateModal";
import { PaymentDetailModal } from "@/components/Payments/PaymentDetailModal";
import { Button } from "@/components/posui/Button";
import { useLanguage } from "@/contexts/LanguageContext";
import { useInfiniteScrollSentinel } from "@/hooks/use-infinite-scroll-sentinel";
import { DOCUMENT_LIST_PAGE_SIZE, usePagedList } from "@/hooks/use-paged-list";
import { usePermissions } from "@/hooks/use-permissions";
import {
  formatDashboardPeriodLabel,
  getPeriodLabel,
  presetToCustomRange,
  resolveDashboardPeriodParams,
  type DashboardCustomRange,
  type DashboardPeriodPreset,
} from "@/lib/dashboard-api";
import { formatCurrency, formatDateTime } from "@/lib/format";
import { fetchPayments } from "@/lib/payments-api";
import { subscribeReferenceOptionsEvents } from "@/lib/catalog-events";
import { fetchRegosReferenceOptions } from "@/lib/settings-api";
import { formatAuthError, useAuth } from "@/store/auth";
import type { PaymentDirection, PaymentDocument } from "@/types/payments";
import type { RegosDefaultOption } from "@/types/settings";
import dashboardStyles from "@/components/Dashboard/Dashboard.module.css";
import styles from "./Payments.module.css";

type PresetPeriod = Exclude<DashboardPeriodPreset, "custom">;

export function PaymentsPage() {
  const { t } = useLanguage();
  const token = useAuth((s) => s.accessToken);
  const { can } = usePermissions();
  const canView = can("payments.read");
  const canCreate = can("payments.create");
  const canEdit = can("payments.edit");
  const canDelete = can("payments.delete");

  const [periodPreset, setPeriodPreset] = useState<DashboardPeriodPreset>("week");
  const [customRange, setCustomRange] = useState<DashboardCustomRange | null>(null);
  const [periodModalOpen, setPeriodModalOpen] = useState(false);
  const [partnerModalOpen, setPartnerModalOpen] = useState(false);
  const [partners, setPartners] = useState<RegosDefaultOption[]>([]);
  const [allPartners, setAllPartners] = useState(true);
  const [selectedPartnerIds, setSelectedPartnerIds] = useState<number[]>([]);
  const [direction, setDirection] = useState<PaymentDirection>("income");
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [selected, setSelected] = useState<PaymentDocument | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const periodModalRange = useMemo(() => {
    if (periodPreset === "custom" && customRange) return customRange;
    if (periodPreset !== "custom") return presetToCustomRange(periodPreset);
    return presetToCustomRange("week");
  }, [customRange, periodPreset]);

  const listDepsKey = useMemo(
    () =>
      [
        periodPreset,
        customRange?.startDate ?? "",
        customRange?.endDate ?? "",
        allPartners ? "all" : selectedPartnerIds.join(","),
        direction,
        search.trim(),
        reloadKey,
      ].join("|"),
    [
      allPartners,
      customRange?.endDate,
      customRange?.startDate,
      direction,
      periodPreset,
      reloadKey,
      search,
      selectedPartnerIds,
    ],
  );

  const fetchPage = useCallback(
    async ({ offset, limit }: { offset: number; limit: number }) => {
      if (!token || !canView) return { items: [], next_offset: 0, total: 0 };
      const period = resolveDashboardPeriodParams(periodPreset, customRange);
      const response = await fetchPayments(token, {
        start_date: period.start_date,
        end_date: period.end_date,
        all_partners: allPartners,
        partner_ids: allPartners ? undefined : selectedPartnerIds,
        direction,
        search: search.trim() || undefined,
        offset,
        limit,
      });
      return {
        items: response.documents,
        next_offset: response.next_offset,
        total: response.total,
      };
    },
    [
      allPartners,
      canView,
      customRange,
      direction,
      periodPreset,
      search,
      selectedPartnerIds,
      token,
    ],
  );

  const {
    items: documents,
    setItems: setDocuments,
    total,
    setTotal,
    loading,
    loadingMore,
    error,
    hasMore,
    loadMore,
  } = usePagedList<PaymentDocument>({
    enabled: Boolean(token) && canView,
    depsKey: listDepsKey,
    pageSize: DOCUMENT_LIST_PAGE_SIZE,
    fetchPage,
    mapError: (err) =>
      formatAuthError(err, t("payments.errors.load", "Failed to load payments.")),
  });

  const sentinelRef = useInfiniteScrollSentinel(() => void loadMore(), {
    enabled: Boolean(token) && canView && hasMore && !loading,
    itemsLength: documents.length,
  });

  useEffect(() => {
    if (!token || !canView) return;
    let cancelled = false;
    const loadPartners = async () => {
      try {
        const options = await fetchRegosReferenceOptions(token);
        if (!cancelled) setPartners(options.partners ?? []);
      } catch {
        if (!cancelled) setPartners([]);
      }
    };
    void loadPartners();
    const unsubscribe = subscribeReferenceOptionsEvents(() => {
      void loadPartners();
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [canView, token]);

  const handlePaymentCreated = (payment: PaymentDocument) => {
    const paymentDirection = payment.payment_direction;
    if (paymentDirection && paymentDirection !== direction) {
      setDirection(paymentDirection);
    }
    setDocuments((prev) => [payment, ...prev.filter((doc) => doc.id !== payment.id)]);
    setTotal((prev) => prev + 1);
    setReloadKey((value) => value + 1);
  };

  const amountTotal = useMemo(
    () => documents.reduce((sum, doc) => sum + (doc.amount ?? 0), 0),
    [documents],
  );

  if (!canView) {
    return (
      <div className={styles.page}>
        <div className={styles.header}>
          <div>
            <h1 className={styles.title}>{t("payments.title", "Payments")}</h1>
            <div className={styles.subtitle}>
              {t("payments.noPermission", "You do not have permission to view payments.")}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>{t("payments.title", "Payments")}</h1>
          <div className={styles.subtitle}>
            {loading
              ? t("common.loadingFromRegos", "Loading from Regos…")
              : t("payments.subtitle", "{{count}} payments · {{total}} · {{period}} · {{partners}}", {
                  count: documents.length,
                  total: formatCurrency(amountTotal),
                  period: formatDashboardPeriodLabel(periodPreset, customRange, t),
                  partners: formatPartnerFilterLabel(allPartners, selectedPartnerIds, partners, t),
                })}
          </div>
        </div>
        <div className={styles.headerActions}>
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
              {t("dashboard.period", "Period")}
            </button>
            <button
              type="button"
              className={clsx(dashboardStyles.filter, dashboardStyles.filterMenu)}
              onClick={() => setPartnerModalOpen(true)}
            >
              <Users size={14} />
              {formatPartnerFilterLabel(allPartners, selectedPartnerIds, partners, t)}
            </button>
          </div>
          {canCreate ? (
            <Button type="button" size="sm" onClick={() => setCreateOpen(true)}>
              <Plus size={14} />
              {t("payments.create.button", "New payment")}
            </Button>
          ) : null}
        </div>
      </div>

      <div className={styles.tabs}>
        <button
          type="button"
          className={clsx(styles.tab, direction === "income" && styles.tabActive)}
          onClick={() => setDirection("income")}
        >
          {t("payments.income", "Income")}
        </button>
        <button
          type="button"
          className={clsx(styles.tab, direction === "outcome" && styles.tabActive)}
          onClick={() => setDirection("outcome")}
        >
          {t("payments.outcome", "Outcome")}
        </button>
      </div>

      <div className={dashboardStyles.productsToolbar}>
        <div className={dashboardStyles.productsSearch}>
          <Search size={16} className={dashboardStyles.productsSearchIcon} />
          <input
            className={dashboardStyles.productsSearchInput}
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t("payments.searchPlaceholder", "Search by code or partner…")}
            aria-label={t("payments.searchAria", "Search payments")}
          />
        </div>
      </div>

      {error ? <div className={styles.empty}>{error}</div> : null}

      <div className={styles.table}>
        <table className={styles.tbl}>
          <thead>
            <tr>
              <th>{t("payments.table.code", "Code")}</th>
              <th>{t("payments.table.date", "Date")}</th>
              <th>{t("payments.partner", "Partner")}</th>
              <th>{t("payments.paymentType", "Payment type")}</th>
              <th>{t("payments.category", "Category")}</th>
              <th>{t("sales.table.attachedUser", "Attached user")}</th>
              <th>{t("payments.status", "Status")}</th>
              <th className={styles.right}>{t("payments.amount", "Amount")}</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={8} className={styles.empty}>
                  {t("payments.loading", "Loading payments…")}
                </td>
              </tr>
            ) : documents.length === 0 ? (
              <tr>
                <td colSpan={8} className={styles.empty}>
                  {t("payments.empty", "No payments match these filters.")}
                </td>
              </tr>
            ) : (
              documents.map((doc) => (
                <tr key={doc.id} onClick={() => setSelected(doc)}>
                  <td className={styles.code}>{doc.code}</td>
                  <td>{formatDateTime(new Date(doc.date * 1000).toISOString())}</td>
                  <td>{doc.partner_name ?? "—"}</td>
                  <td>{doc.payment_type_name ?? "—"}</td>
                  <td>{doc.category_name ?? "—"}</td>
                  <td>{doc.attached_user_name ?? "—"}</td>
                  <td>
                    <span
                      className={clsx(
                        styles.badge,
                        doc.deleted_mark || !doc.performed
                          ? styles.draft
                          : direction === "income"
                            ? styles.income
                            : styles.outcome,
                      )}
                    >
                      {doc.deleted_mark
                        ? t("payments.status.deletedMark", "Marked for deletion")
                        : doc.performed
                          ? t("payments.status.performed", "Performed")
                          : t("payments.status.draft", "Draft")}
                    </span>
                  </td>
                  <td className={styles.right}>
                    {formatCurrency(doc.amount ?? 0)}
                    {doc.currency?.code_chr ? (
                      <span className={styles.muted}> {doc.currency.code_chr}</span>
                    ) : null}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        <div className={styles.cardList}>
          {loading ? (
            <div className={styles.empty}>{t("payments.loading", "Loading payments…")}</div>
          ) : documents.length === 0 ? (
            <div className={styles.empty}>
              {t("payments.empty", "No payments match these filters.")}
            </div>
          ) : (
            documents.map((doc) => (
              <button
                key={doc.id}
                type="button"
                className={styles.paymentCard}
                onClick={() => setSelected(doc)}
              >
                <div className={styles.paymentCardTop}>
                  <span className={styles.code}>{doc.code}</span>
                  <span
                    className={clsx(
                      styles.badge,
                      doc.deleted_mark || !doc.performed
                        ? styles.draft
                        : direction === "income"
                          ? styles.income
                          : styles.outcome,
                    )}
                  >
                    {doc.deleted_mark
                      ? t("payments.status.deletedMark", "Marked for deletion")
                      : doc.performed
                        ? t("payments.status.performed", "Performed")
                        : t("payments.status.draft", "Draft")}
                  </span>
                </div>
                <div className={styles.paymentCardDate}>
                  {formatDateTime(new Date(doc.date * 1000).toISOString())}
                </div>
                <div className={styles.paymentCardPartner}>{doc.partner_name ?? "—"}</div>
                <div className={styles.paymentCardMeta}>
                  {[doc.payment_type_name, doc.category_name, doc.attached_user_name]
                    .filter(Boolean)
                    .join(" · ") || "—"}
                </div>
                <div className={styles.paymentCardAmount}>
                  {formatCurrency(doc.amount ?? 0)}
                  {doc.currency?.code_chr ? ` ${doc.currency.code_chr}` : ""}
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {!loading && documents.length > 0 ? (
        <div className={styles.listFooter}>
          {total > documents.length || hasMore ? (
            <div className={styles.muted}>
              {t("payments.showing", "Showing {{shown}} of {{total}}", {
                shown: documents.length,
                total,
              })}
            </div>
          ) : null}
          {loadingMore ? (
            <div className={styles.muted}>
              {t("common.loadingMore", "Loading more…")}
            </div>
          ) : null}
          <div ref={sentinelRef} className={styles.scrollSentinel} aria-hidden />
        </div>
      ) : null}

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
      {canCreate ? (
        <PaymentCreateModal
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          initialDirection={direction}
          onCreated={handlePaymentCreated}
        />
      ) : null}
      <PaymentDetailModal
        open={selected != null}
        payment={selected}
        canEdit={canEdit}
        canDelete={canDelete}
        onClose={() => setSelected(null)}
        onChanged={(updated) => {
          if (updated) {
            setSelected(updated);
            setDocuments((prev) =>
              prev.map((doc) => (doc.id === updated.id ? updated : doc)),
            );
          }
          setReloadKey((value) => value + 1);
        }}
      />
    </div>
  );
}

