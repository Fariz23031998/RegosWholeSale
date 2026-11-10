import { Fragment, useCallback, useMemo } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { ChevronDown, ChevronRight } from "lucide-react";
import { columnHeaderLabel, DataTable } from "@/components/DataTable/DataTable";
import { useLanguage } from "@/contexts/LanguageContext";
import type { CurrencyGroup } from "@/lib/partner-balance";
import type { PartnerBalanceRow } from "@/types/partners";

const AMOUNT_IDS = new Set(["opening", "debit", "credit", "closing"]);

type Headers = {
  currency: string;
  documentType: string;
  documentCode: string;
  date: string;
  opening: string;
  debit: string;
  credit: string;
  closing: string;
};

function balanceRowKey(groupKey: string, row: PartnerBalanceRow, index: number): string {
  const documentId = row.document_id != null && row.document_id > 0 ? row.document_id : "x";
  const rowId = row.id > 0 ? row.id : "0";
  return `${groupKey}:${rowId}:${documentId}:${row.date}:${index}`;
}

export function ReconciliationTable({
  tableKey,
  groups,
  collapsed,
  onToggle,
  loading,
  loadingMessage,
  emptyMessage,
  className,
  numClassName,
  groupRowClassName,
  groupHeadingClassName,
  groupLabelClassName,
  groupToggleClassName,
  emptyClassName,
  headers,
  formatAmount,
  formatDate,
  rowCurrency,
  groupCurrency,
}: {
  tableKey: string;
  groups: CurrencyGroup[];
  collapsed: Set<string>;
  onToggle: (key: string) => void;
  loading: boolean;
  loadingMessage: string;
  emptyMessage: string;
  className?: string;
  numClassName?: string;
  groupRowClassName?: string;
  groupHeadingClassName?: string;
  groupLabelClassName?: string;
  groupToggleClassName?: string;
  emptyClassName?: string;
  headers: Headers;
  formatAmount: (value: number) => string;
  formatDate: (value: number) => string;
  rowCurrency: (row: PartnerBalanceRow) => string;
  groupCurrency: (group: CurrencyGroup) => string;
}) {
  const { t } = useLanguage();
  const data = useMemo(() => groups.flatMap((group) => group.rows), [groups]);
  const columns = useMemo<ColumnDef<PartnerBalanceRow, any>[]>(() => {
    const num = { align: "right" as const, cellClassName: numClassName, headerClassName: numClassName };
    return [
      { id: "currency", accessorFn: (row) => row.currency?.name ?? "", header: headers.currency },
      {
        id: "documentType",
        accessorFn: (row) => row.document_type?.name ?? "",
        header: headers.documentType,
      },
      {
        id: "documentCode",
        accessorFn: (row) => row.document_code ?? "",
        header: headers.documentCode,
      },
      { id: "date", accessorFn: (row) => row.date, header: headers.date },
      { id: "opening", accessorFn: (row) => row.start_amount, header: headers.opening, meta: num },
      { id: "debit", accessorFn: (row) => row.debit, header: headers.debit, meta: num },
      { id: "credit", accessorFn: (row) => row.credit, header: headers.credit, meta: num },
      { id: "closing", accessorFn: (row) => row.end_amount, header: headers.closing, meta: num },
    ];
  }, [
    headers.closing,
    headers.credit,
    headers.currency,
    headers.date,
    headers.debit,
    headers.documentCode,
    headers.documentType,
    headers.opening,
    numClassName,
  ]);

  const getRowId = useCallback((row: PartnerBalanceRow, index: number) => {
    const documentId = row.document_id != null && row.document_id > 0 ? row.document_id : "x";
    const rowId = row.id > 0 ? row.id : "0";
    return `${rowId}:${documentId}:${row.date}:${index}`;
  }, []);

  return (
    <DataTable
      tableKey={tableKey}
      data={data}
      columns={columns}
      className={className}
      enableSorting={false}
      getRowId={getRowId}
      renderBody={(table) => {
        const visible = table.getVisibleLeafColumns();
        const span = Math.max(visible.length, 1);
        if (loading) {
          return (
            <tr>
              <td colSpan={span} className={emptyClassName}>
                {loadingMessage}
              </td>
            </tr>
          );
        }
        if (groups.length === 0) {
          return (
            <tr>
              <td colSpan={span} className={emptyClassName}>
                {emptyMessage}
              </td>
            </tr>
          );
        }
        const labelColumns = visible.filter((column) => !AMOUNT_IDS.has(column.id));
        const amountColumns = visible.filter((column) => AMOUNT_IDS.has(column.id));
        return groups.map((group) => {
          const currencyName = groupCurrency(group);
          const isCollapsed = collapsed.has(group.key);
          const amountText = (id: string) => {
            if (id === "opening") return "";
            if (id === "debit") return formatAmount(group.debitTotal);
            if (id === "credit") return formatAmount(group.creditTotal);
            if (id === "closing") return formatAmount(group.closingTotal);
            return "";
          };
          return (
            <Fragment key={group.key}>
              <tr className={groupRowClassName}>
                {labelColumns.length > 0 ? (
                  <td colSpan={labelColumns.length} className={groupHeadingClassName}>
                    <div className={groupLabelClassName}>
                      <span>{currencyName}</span>
                      <button
                        type="button"
                        className={groupToggleClassName}
                        onClick={() => onToggle(group.key)}
                        aria-expanded={!isCollapsed}
                        aria-label={
                          isCollapsed
                            ? t("partners.balance.showOperations", "Show operations for {{currency}}", {
                                currency: currencyName,
                              })
                            : t("partners.balance.hideOperations", "Hide operations for {{currency}}", {
                                currency: currencyName,
                              })
                        }
                      >
                        {isCollapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
                      </button>
                    </div>
                  </td>
                ) : null}
                {amountColumns.map((column) => (
                  <td key={column.id} className={numClassName} data-label={columnHeaderLabel(column)}>
                    {amountText(column.id)}
                  </td>
                ))}
              </tr>
              {!isCollapsed
                ? group.rows.map((row, index) => (
                    <tr key={balanceRowKey(group.key, row, index)}>
                      {visible.map((column) => {
                        let text = "—";
                        if (column.id === "currency") text = rowCurrency(row);
                        else if (column.id === "documentType") text = row.document_type?.name ?? "—";
                        else if (column.id === "documentCode") text = row.document_code ?? "—";
                        else if (column.id === "date") text = formatDate(row.date);
                        else if (column.id === "opening") text = formatAmount(row.start_amount);
                        else if (column.id === "debit") text = formatAmount(row.debit);
                        else if (column.id === "credit") text = formatAmount(row.credit);
                        else if (column.id === "closing") text = formatAmount(row.end_amount);
                        return (
                          <td
                            key={column.id}
                            className={AMOUNT_IDS.has(column.id) ? numClassName : undefined}
                            data-label={columnHeaderLabel(column)}
                          >
                            {text}
                          </td>
                        );
                      })}
                    </tr>
                  ))
                : null}
            </Fragment>
          );
        });
      }}
    />
  );
}
