export type LabelPaper = {
  width_mm: number;
  height_mm: number;
};

export type LabelTemplateLogo = {
  id: string;
  name: string;
  src: string;
  max_width: number | null;
};

export type LabelTemplate = {
  id: string;
  name: string;
  is_default: boolean;
  paper: LabelPaper;
  html: string;
  css: string;
  logos: LabelTemplateLogo[];
  version: number;
};

export type LabelPrintService = {
  id: string;
  name: string;
  printer_name: string;
  is_default: boolean;
};

export type LabelPrintSettings = {
  printer_name: string;
  token: string;
  services: LabelPrintService[];
};

export type LabelTemplatesSettings = {
  templates: LabelTemplate[];
  default_template_id: string | null;
  print: LabelPrintSettings;
};

export type LabelTemplatesResponse = {
  settings: LabelTemplatesSettings;
};

export type LabelTemplatesPatchRequest = {
  templates?: LabelTemplate[];
  default_template_id?: string | null;
};

export type LabelPrintPatchRequest = {
  printer_name?: string;
  regenerate_token?: boolean;
  services?: LabelPrintService[];
};

export type UserLabelPrintMethod = "service" | "browser";

export type UserLabelPrintSettings = {
  template_id: string | null;
  service_id: string | null;
  printer_name: string | null;
  method: UserLabelPrintMethod;
  prompt_before_print: boolean;
  use_warehouse_quantity: boolean;
};

export type UserLabelPrintSettingsResponse = {
  settings: UserLabelPrintSettings;
};

export type UserLabelPrintPatchRequest = {
  template_id: string | null;
  service_id: string | null;
  printer_name: string | null;
  method: UserLabelPrintMethod;
  prompt_before_print: boolean;
  use_warehouse_quantity: boolean;
};

export type LabelStationPrinter = {
  name: string;
  kind: string;
  enabled: boolean;
};

export type LabelStation = {
  station_id: string;
  station_name: string;
  location_id: string | null;
  online: boolean;
  matches_printer: boolean;
  printers: LabelStationPrinter[];
};

export type LabelStationsResponse = {
  printer_name: string;
  stations: LabelStation[];
};

export type LabelRenderResponse = {
  html: string;
  width_mm: number;
  height_mm: number;
  count: number;
};

export type LabelFieldRow = {
  name: string;
  price: string;
  current_price: string;
  old_price: string;
  currency: string;
  barcode: string;
  code: string;
  articul: string;
  sku: string;
  category: string;
  unit_name: string;
  barcode_src: string;
  qr_src: string;
  image_src: string;
};

export type LabelRowsResponse = {
  html: string;
  css: string;
  width_mm: number;
  height_mm: number;
  logos: LabelTemplateLogo[];
  rows: LabelFieldRow[];
  quantities: number[];
};

export type LabelSampleRowResponse = {
  row: LabelFieldRow;
};

export type LabelPrintResponse = {
  job_ids: string[];
  delivered: number;
  pending: number;
};

export const LABEL_PLACEHOLDERS = [
  "name",
  "price",
  "current_price",
  "old_price",
  "currency",
  "barcode",
  "code",
  "articul",
  "sku",
  "category",
  "unit_name",
  "barcode_src",
  "qr_src",
  "image_src",
] as const;
