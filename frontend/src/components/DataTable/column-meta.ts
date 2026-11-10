import type { RowData } from "@tanstack/react-table";

declare module "@tanstack/react-table" {
  // Module augmentation for column layout hints used by DataTable.
  interface ColumnMeta<TData extends RowData, TValue> {
    align?: "left" | "right";
    cellClassName?: string;
    headerClassName?: string;
    label?: string;
  }
}

export {};
