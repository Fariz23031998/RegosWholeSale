import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/DataTable/DataTable";
import { ReconciliationTable } from "@/components/DataTable/ReconciliationTable";
import salesStyles from "@/components/Sales/Sales.module.css";
import dashStyles from "@/components/Dashboard/Dashboard.module.css";
import type { CurrencyGroup } from "@/lib/partner-balance";
import type { PartnerBalanceRow } from "@/types/partners";

export const Route = createFileRoute("/table-check")({
  head: () => ({ meta: [{ title: "Table check" }] }),
  component: TableCheckPage,
});

type Sale = { id: string; code: string; partner: string; total: number };
type Product = { id: string; name: string; soldQty: number; soldTotal: number; refundQty: number; refundTotal: number };

const sales: Sale[] = [
  { id: "1", code: "S-100", partner: "Alpha", total: 20 },
  { id: "2", code: "S-200", partner: "Beta", total: 50 },
  { id: "3", code: "S-150", partner: "Gamma", total: 10 },
];

const products: Product[] = [
  { id: "p1", name: "Nails", soldQty: 4, soldTotal: 40, refundQty: 1, refundTotal: 10 },
  { id: "p2", name: "Bolts", soldQty: 2, soldTotal: 20, refundQty: 0, refundTotal: 0 },
];

function balanceRow(partial: Partial<PartnerBalanceRow> & Pick<PartnerBalanceRow, "id" | "document_code">): PartnerBalanceRow {
  return {
    date: 1_700_000_000,
    document_id: partial.id,
    document_type: { id: 1, name: "Sale" },
    currency: { id: 1, name: "UZS", code_chr: "UZS" },
    firm: null,
    exchange_rate: 1,
    currency_amount: null,
    start_amount: 0,
    debit: 0,
    credit: 0,
    end_amount: 0,
    ...partial,
  };
}

const groups: CurrencyGroup[] = [
  {
    key: "uzs",
    currency: { id: 1, name: "UZS", code_chr: "UZS" },
    debitTotal: 30,
    creditTotal: 5,
    closingTotal: 25,
    rows: [
      balanceRow({ id: 1, document_code: "A-1", debit: 30, credit: 5, end_amount: 25 }),
      balanceRow({ id: 2, document_code: "A-2", debit: 0, credit: 0, end_amount: 25 }),
    ],
  },
  {
    key: "usd",
    currency: { id: 2, name: "USD", code_chr: "USD" },
    debitTotal: 8,
    creditTotal: 1,
    closingTotal: 7,
    rows: [balanceRow({ id: 3, document_code: "B-1", debit: 8, credit: 1, end_amount: 7, currency: { id: 2, name: "USD", code_chr: "USD" } })],
  },
];

function TableCheckPage() {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const saleColumns = useMemo<ColumnDef<Sale, any>[]>(
    () => [
      { id: "code", accessorKey: "code", header: "Code" },
      { id: "partner", accessorKey: "partner", header: "Partner" },
      { id: "total", accessorKey: "total", header: "Total", meta: { align: "right" as const } },
      { id: "actions", header: () => null, meta: { label: "Print" }, enableSorting: false, enableHiding: false, cell: () => "Print" },
    ],
    [],
  );
  const productColumns = useMemo<ColumnDef<Product, any>[]>(
    () => [
      {
        id: "product",
        header: "Product",
        columns: [{ id: "name", accessorKey: "name", header: "Name" }],
      },
      {
        id: "sell",
        header: "Sell",
        columns: [
          { id: "sellQty", accessorKey: "soldQty", header: "Qty" },
          { id: "sellTotal", accessorKey: "soldTotal", header: "Total" },
        ],
      },
      {
        id: "refund",
        header: "Refund",
        columns: [
          { id: "refundQty", accessorKey: "refundQty", header: "Qty" },
          { id: "refundTotal", accessorKey: "refundTotal", header: "Total" },
        ],
      },
    ],
    [],
  );

  return (
    <div className={salesStyles.page}>
      <h1 className={salesStyles.title}>Table check</h1>
      <div className={salesStyles.table} data-testid="sales-shell">
        <DataTable tableKey="verify.sales" data={sales} columns={saleColumns} className={salesStyles.tbl} getRowId={(row) => row.id} />
      </div>
      <div className={dashStyles.productsTableWrap} style={{ marginTop: 32 }}>
        <DataTable
          tableKey="verify.products"
          data={products}
          columns={productColumns}
          className={dashStyles.productsTable}
          getRowId={(row) => row.id}
          topRow={(table) => (
            <tr data-testid="totals-row">
              {table.getVisibleLeafColumns().map((column) => (
                <td key={column.id}>
                  {column.id === "name"
                    ? "Total"
                    : column.id === "sellQty"
                      ? "6"
                      : column.id === "sellTotal"
                        ? "60"
                        : column.id === "refundQty"
                          ? "1"
                          : "10"}
                </td>
              ))}
            </tr>
          )}
        />
      </div>
      <div style={{ marginTop: 32 }}>
        <ReconciliationTable
          tableKey="verify.reconciliation"
          groups={groups}
          collapsed={collapsed}
          onToggle={(key) =>
            setCollapsed((current) => {
              const next = new Set(current);
              if (next.has(key)) next.delete(key);
              else next.add(key);
              return next;
            })
          }
          loading={false}
          loadingMessage="Loading"
          emptyMessage="Empty"
          className={salesStyles.tbl}
          headers={{
            currency: "Currency",
            documentType: "Type",
            documentCode: "Code",
            date: "Date",
            opening: "Opening",
            debit: "Debit",
            credit: "Credit",
            closing: "Closing",
          }}
          formatAmount={(value) => String(value)}
          formatDate={() => "01.01.2024"}
          rowCurrency={(row) => row.currency?.name ?? ""}
          groupCurrency={(group) => group.currency?.name ?? group.key}
        />
      </div>
    </div>
  );
}
