import type { Sale } from "@/data/seed";
import {
  EMPTY_RECEIPT_OPERATION_ITEM,
  normalizeReceiptOperationItem,
} from "@/lib/receipt-operation-item";
import {
  buildOperationGroups,
  buildOperationTotals,
} from "@/lib/receipt-operation-groups";
import type { ReceiptOperationGroup, ReceiptOperationTotals } from "@/lib/receipt-operation-groups";
import type {
  WholesaleDocument,
  WholesaleOperationLine,
  WholesalePaymentLine,
  WholesaleReturnDocument,
} from "@/lib/sales-api";

export type DocumentPrintKind = "sale" | "return";

export type DocumentPrintContext = {
  kind: DocumentPrintKind;
  document: WholesaleDocument | WholesaleReturnDocument;
  operations: WholesaleOperationLine[];
  operation_groups: ReceiptOperationGroup[];
  totals: ReceiptOperationTotals;
  payments: WholesalePaymentLine[];
  sale: Sale;
  partner_name?: string | null;
  stock_name?: string | null;
  document_code?: string | null;
};

/** @deprecated Use DocumentPrintContext */
export type ReceiptPrintContext = DocumentPrintContext;

export function saleToPrintContext(
  sale: Sale,
  extras?: Partial<Pick<DocumentPrintContext, "partner_name" | "stock_name" | "document_code">>,
): DocumentPrintContext {
  const documentCode = extras?.document_code ?? sale.id;
  const documentDate = Math.floor(new Date(sale.createdAt).getTime() / 1000);
  const document: WholesaleDocument = {
    id: 0,
    code: documentCode,
    date: documentDate,
    partner_id: null,
    partner_name: extras?.partner_name ?? null,
    stock_id: null,
    stock_name: extras?.stock_name ?? null,
    attached_user_id: sale.cashierId ? Number(sale.cashierId) || null : null,
    attached_user_name: sale.cashierName,
    amount: sale.total,
    performed: true,
    currency: sale.saleCurrency ?? null,
  };
  const operations: WholesaleOperationLine[] = sale.items.map((item, index) => ({
    id: index + 1,
    document_id: 0,
    item_id: Number(item.productId) || index + 1,
    item_code: null,
    item_name: item.name,
    quantity: item.qty,
    price: item.price,
    price2: item.price,
    amount: +(item.qty * item.price).toFixed(2),
    item: normalizeReceiptOperationItem({
      ...EMPTY_RECEIPT_OPERATION_ITEM,
      fullname: item.name,
    }),
  }));
  const payments: WholesalePaymentLine[] = (sale.payments ?? []).map((payment, index) => ({
    id: payment.paymentTypeId || index + 1,
    code: "",
    date: documentDate,
    amount: payment.amountPaid,
    category_id: null,
    category_name: null,
    payment_type_name: payment.paymentTypeName,
    partner_id: null,
    partner_name: extras?.partner_name ?? null,
    attached_user_id: null,
    attached_user_name: null,
    exchange_rate: null,
    currency: payment.paymentCurrency ?? null,
  }));

  return {
    kind: sale.type === "refund" ? "return" : "sale",
    document,
    operations,
    operation_groups: buildOperationGroups(operations),
    totals: buildOperationTotals(operations),
    payments,
    sale,
    partner_name: extras?.partner_name ?? null,
    stock_name: extras?.stock_name ?? null,
    document_code: documentCode,
  };
}

export function wholesaleDocumentToPrintContext(
  doc: Pick<WholesaleDocument, "code" | "id" | "partner_name" | "stock_name">,
  sale: Sale,
): DocumentPrintContext {
  return saleToPrintContext(sale, {
    partner_name: doc.partner_name,
    stock_name: doc.stock_name,
    document_code: doc.code || String(doc.id),
  });
}

const sampleDocument: WholesaleDocument = {
  id: 13705,
  code: "13 705",
  date: Math.floor(new Date("2026-06-22T12:00:00Z").getTime() / 1000),
  partner_id: 1,
  partner_name: "Ибодулло Ургут",
  partner_phone: "+998 99 599 29 26",
  stock_id: 1,
  stock_name: "Main Warehouse",
  attached_user_id: 1,
  attached_user_name: "Jane Cashier",
  amount: 1296.38,
  performed: true,
  currency: { id: 1, name: "Сум", code_chr: "сум", exchange_rate: 1 },
};

const sampleOperations: WholesaleOperationLine[] = [
  {
    id: 1,
    document_id: 13705,
    item_id: 1101,
    item_code: "1 101",
    item_name: "Балон болт 9594681 UZ",
    item_group_id: 1,
    item_group_name: "Автожон",
    item_unit_name: "шт",
    item_brand: "Нексия",
    quantity: 4,
    price: 0.7,
    price2: 0.7,
    amount: 2.8,
    item: {
      fullname: "Балон болт 9594681 UZ",
      description: "Крепёжный болон",
      articul: "11A",
      color: { name: "Серый" },
      size: { name: "M12" },
      producer: { name: "Нексия" },
      country: { name: "Узбекистан" },
      icps: "1234567890123",
      package_code: "PKG-1101",
      department: { name: "Автожон" },
      vat: { name: "НДС 12%", value: 12 },
      base_barcode: "4601234567890",
    },
  },
  {
    id: 2,
    document_id: 13705,
    item_id: 853,
    item_code: "853",
    item_name: "Колодка передни HAGEN керамик",
    item_group_id: 2,
    item_group_name: "CTR/Valeo Фирма",
    item_unit_name: "компл",
    item_brand: "Матиз",
    quantity: 10,
    price: 10.7,
    price2: 10.7,
    amount: 107,
    item: { ...EMPTY_RECEIPT_OPERATION_ITEM },
  },
  {
    id: 3,
    document_id: 13705,
    item_id: 14104,
    item_code: "14 104",
    item_name: "Корзина збор valeo 18",
    item_group_id: 2,
    item_group_name: "CTR/Valeo Фирма",
    item_unit_name: "компл",
    item_brand: "Донс 1.6",
    quantity: 2,
    price: 70.97,
    price2: 70.97,
    amount: 141.94,
    item: { ...EMPTY_RECEIPT_OPERATION_ITEM },
  },
  {
    id: 4,
    document_id: 13705,
    item_id: 2001,
    item_code: "2 001",
    item_name: "Фильтр масляный",
    item_group_id: 3,
    item_group_name: "УзДВ",
    item_unit_name: "шт",
    item_brand: "Spark",
    quantity: 6,
    price: 12.5,
    price2: 12.5,
    amount: 75,
    item: { ...EMPTY_RECEIPT_OPERATION_ITEM },
  },
];

const samplePayments: WholesalePaymentLine[] = [
  {
    id: 501,
    code: "PAY-501",
    date: Math.floor(new Date("2026-06-22T12:00:00Z").getTime() / 1000),
    amount: 1296.38,
    category_id: 1,
    category_name: "Sales",
    payment_type_name: "Cash",
    partner_id: 1,
    partner_name: "Ибодулло Ургут",
    attached_user_id: 1,
    attached_user_name: "Jane Cashier",
    exchange_rate: 1,
    currency: { id: 1, name: "Сум", code_chr: "сум", exchange_rate: 1 },
  },
];

const sampleTotals = buildOperationTotals(sampleOperations);

export const SAMPLE_RECEIPT_CONTEXT: DocumentPrintContext = {
  kind: "sale",
  document: sampleDocument,
  operations: sampleOperations,
  operation_groups: buildOperationGroups(sampleOperations),
  totals: sampleTotals,
  payments: samplePayments,
  sale: {
    id: "13 705",
    createdAt: new Date("2026-06-22T12:00:00Z").toISOString(),
    cashierId: "1",
    cashierName: "Jane Cashier",
    items: sampleOperations.map((op) => ({
      productId: String(op.item_id),
      name: op.item_name ?? "",
      price: op.price,
      qty: op.quantity,
    })),
    subtotal: sampleTotals.amount,
    discount: 0,
    tax: 0,
    total: sampleTotals.amount,
    paymentTypeId: 1,
    paymentTypeName: "Cash",
    isCash: true,
    amountPaid: sampleTotals.amount,
    balanceDue: 0,
    saleCurrency: sampleDocument.currency,
    payments: [
      {
        paymentTypeId: 1,
        paymentTypeName: "Cash",
        isCash: true,
        amountPaid: sampleTotals.amount,
        paymentCurrency: sampleDocument.currency,
      },
    ],
  },
  partner_name: "Ибодулло Ургут",
  stock_name: "Main Warehouse",
  document_code: "13 705",
};

export const SAMPLE_RETURN_RECEIPT_CONTEXT: DocumentPrintContext = {
  ...SAMPLE_RECEIPT_CONTEXT,
  kind: "return",
  document: {
    ...sampleDocument,
    id: 456,
    code: "WR-00456",
    description: "pulse:ws:123|Damaged goods",
    wholesale_doc_id: 123,
    reason: "Damaged goods",
  } satisfies WholesaleReturnDocument,
  sale: {
    ...SAMPLE_RECEIPT_CONTEXT.sale,
    id: "WR-00456",
    type: "refund",
    refundOf: "123",
    reason: "Damaged goods",
  },
  document_code: "WR-00456",
};
