import type { RegosCurrencyOption } from "@/types/settings";

export type PaymentDirection = "income" | "outcome";

export type PaymentDocument = {
  id: number;
  code: string;
  date: number;
  amount: number | null;
  category_id: number | null;
  category_name: string | null;
  payment_type_id: number | null;
  payment_type_name: string | null;
  partner_id: number | null;
  partner_name: string | null;
  firm_id: number | null;
  firm_name: string | null;
  attached_user_id: number | null;
  attached_user_name: string | null;
  exchange_rate: number | null;
  description: string | null;
  performed: boolean;
  deleted_mark: boolean;
  payment_direction: PaymentDirection | null;
  currency: RegosCurrencyOption | null;
};

export type PaymentsListResponse = {
  documents: PaymentDocument[];
  next_offset: number;
  total: number;
};

export type PaymentCreateRequest = {
  firm_id: number;
  partner_id: number;
  direction: PaymentDirection;
  payment_type_id: number;
  amount: number;
  exchange_rate?: number | null;
  category_id?: number | null;
  description?: string | null;
  date?: number | null;
};

export type PaymentEditRequest = {
  firm_id?: number | null;
  partner_id?: number | null;
  payment_type_id?: number | null;
  amount?: number | null;
  exchange_rate?: number | null;
  category_id?: number | null;
  description?: string | null;
  date?: number | null;
};

export type PaymentMutationResponse = {
  row_affected: number;
};
