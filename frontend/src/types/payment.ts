import type { RegosCurrencyOption } from "@/types/settings";

export type PaymentCurrency = RegosCurrencyOption;

export type PaymentType = {
  id: number;
  name: string;
  is_cash: boolean;
  allows_debt: boolean;
  image_url: string;
  currency?: PaymentCurrency | null;
};

export type PaymentTypesResponse = {
  payment_types: PaymentType[];
};
