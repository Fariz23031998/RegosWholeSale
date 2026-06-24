import type { RegosCurrencyOption, RegosDefaultOption } from "@/types/settings";

export type PartnerBalanceDocumentType = {
  id: number;
  name: string;
};

export type PartnerBalanceRow = {
  id: number;
  date: number;
  document_code: string | null;
  document_id: number | null;
  document_type: PartnerBalanceDocumentType | null;
  currency: RegosCurrencyOption | null;
  firm: RegosDefaultOption | null;
  exchange_rate: number | null;
  currency_amount: number | null;
  start_amount: number;
  debit: number;
  credit: number;
  end_amount: number;
};

export type PartnerBalanceResponse = {
  rows: PartnerBalanceRow[];
};

export type PartnerBalanceMode = "native" | "base_currency";

export type PartnerLegalStatus = "Legal" | "Natural";

export type Partner = {
  id: number;
  name: string;
  fullname: string | null;
  legal_status: PartnerLegalStatus;
  group_id: number;
  group_name: string | null;
  boss_name: string | null;
  address: string | null;
  phones: string | null;
  email: string | null;
  description: string | null;
  inn: string | null;
  bank_name: string | null;
  mfo: string | null;
  rs: string | null;
  oked: string | null;
  vat_index: string | null;
  deleted_mark: boolean;
};

export type PartnerGroup = {
  id: number;
  name: string;
};

export type PartnersListResponse = {
  partners: Partner[];
  next_offset: number;
  total: number;
};

export type PartnerGroupsResponse = {
  groups: PartnerGroup[];
};

export type FirmsListResponse = {
  firms: Array<{ id: number; name: string }>;
};

export type PartnerCreateRequest = {
  group_id: number;
  legal_status: PartnerLegalStatus;
  name: string;
  fullname?: string | null;
  boss_name?: string | null;
  address?: string | null;
  phones?: string | null;
  email?: string | null;
  description?: string | null;
  inn?: string | null;
  bank_name?: string | null;
  mfo?: string | null;
  rs?: string | null;
  oked?: string | null;
  vat_index?: string | null;
};

export type PartnerUpdateRequest = Partial<
  Omit<PartnerCreateRequest, "group_id" | "legal_status" | "name">
> & {
  group_id?: number;
  legal_status?: PartnerLegalStatus;
  name?: string;
};

export type PartnerFormValues = {
  group_id: string;
  legal_status: PartnerLegalStatus;
  name: string;
  fullname: string;
  boss_name: string;
  address: string;
  phones: string;
  email: string;
  description: string;
  inn: string;
  bank_name: string;
  mfo: string;
  rs: string;
  oked: string;
  vat_index: string;
};

export const EMPTY_PARTNER_FORM: PartnerFormValues = {
  group_id: "",
  legal_status: "Natural",
  name: "",
  fullname: "",
  boss_name: "",
  address: "",
  phones: "",
  email: "",
  description: "",
  inn: "",
  bank_name: "",
  mfo: "",
  rs: "",
  oked: "",
  vat_index: "",
};

export function partnerToFormValues(partner: Partner): PartnerFormValues {
  return {
    group_id: String(partner.group_id),
    legal_status: partner.legal_status,
    name: partner.name,
    fullname: partner.fullname ?? "",
    boss_name: partner.boss_name ?? "",
    address: partner.address ?? "",
    phones: partner.phones ?? "",
    email: partner.email ?? "",
    description: partner.description ?? "",
    inn: partner.inn ?? "",
    bank_name: partner.bank_name ?? "",
    mfo: partner.mfo ?? "",
    rs: partner.rs ?? "",
    oked: partner.oked ?? "",
    vat_index: partner.vat_index ?? "",
  };
}

export function formValuesToCreateRequest(values: PartnerFormValues): PartnerCreateRequest {
  const trim = (value: string) => value.trim();
  return {
    group_id: Number(values.group_id),
    legal_status: values.legal_status,
    name: trim(values.name),
    fullname: trim(values.fullname) || null,
    boss_name: trim(values.boss_name) || null,
    address: trim(values.address) || null,
    phones: trim(values.phones) || null,
    email: trim(values.email) || null,
    description: trim(values.description) || null,
    inn: trim(values.inn) || null,
    bank_name: trim(values.bank_name) || null,
    mfo: trim(values.mfo) || null,
    rs: trim(values.rs) || null,
    oked: trim(values.oked) || null,
    vat_index: trim(values.vat_index) || null,
  };
}

export function formValuesToUpdateRequest(values: PartnerFormValues): PartnerUpdateRequest {
  return formValuesToCreateRequest(values);
}
