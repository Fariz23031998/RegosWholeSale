export type ShiftStatus = "open" | "closed";

export type ShiftOperationType =
  | "cash_out"
  | "cash_in"
  | "change_out"
  | "change_in"
  | "other_out"
  | "other_in"
  | "debt_settlement";

export type ShiftCurrencyAmount = {
  currency_id: number;
  currency_code: string | null;
  start_amount: string | number;
  expected_amount: string | number | null;
  actual_amount: string | number | null;
  difference_amount: string | number | null;
  debt_settled_amount: string | number;
  outstanding_debt: string | number;
};

export type ShiftCurrencyAmountInput = {
  currency_id: number;
  amount: number;
};

export type ShiftOperation = {
  id: number;
  shift_id: number;
  created_by_user_id: number | null;
  created_by_display_name: string | null;
  operation_type: ShiftOperationType;
  amount: string | number;
  currency_id: number | null;
  currency_code: string | null;
  note: string | null;
  created_at: string;
};

export type ShiftExpectedCurrencyBreakdown = {
  currency_id: number;
  currency_code: string | null;
  start_amount: string | number;
  cash_from_docs: string | number;
  ops_net: string | number;
  expected_amount: string | number;
};

export type ShiftExpectedBreakdown = {
  docs_count: number;
  by_currency: ShiftExpectedCurrencyBreakdown[];
};

export type Shift = {
  id: number;
  company_id: number;
  user_id: number;
  user_display_name: string | null;
  opened_by_user_id: number | null;
  closed_by_user_id: number | null;
  opened_at: string;
  closed_at: string | null;
  status: ShiftStatus;
  firm_id: number | null;
  attached_user_id: number | null;
  notes: string | null;
  currency_amounts: ShiftCurrencyAmount[];
  operations: ShiftOperation[];
  expected_preview: ShiftExpectedBreakdown | null;
};

export type ShiftListResponse = {
  shifts: Shift[];
  total: number;
};

export type ShiftOpenRequest = {
  amounts: ShiftCurrencyAmountInput[];
  notes?: string | null;
  user_id?: number | null;
};

export type ShiftCloseRequest = {
  amounts: ShiftCurrencyAmountInput[];
  notes?: string | null;
};

export type ShiftOperationCreateRequest = {
  operation_type: ShiftOperationType;
  amount: number;
  currency_id: number;
  note?: string | null;
};

export type EmployeeDebtCurrencyAmount = {
  currency_id: number;
  currency_code: string | null;
  amount: string | number;
};

export type EmployeeDebtResponse = {
  user_id: number;
  user_display_name: string | null;
  outstanding_debt_by_currency: EmployeeDebtCurrencyAmount[];
};

export const SHIFT_OPERATION_TYPES: ShiftOperationType[] = [
  "cash_out",
  "cash_in",
  "change_out",
  "change_in",
  "other_out",
  "other_in",
];
