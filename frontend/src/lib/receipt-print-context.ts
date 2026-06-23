import type { Sale } from "@/data/seed";
import type { WholesaleDocument } from "@/lib/sales-api";

export type ReceiptPrintContext = {
  sale: Sale;
  partner_name?: string | null;
  stock_name?: string | null;
  document_code?: string | null;
};

export function saleToPrintContext(
  sale: Sale,
  extras?: Partial<Omit<ReceiptPrintContext, "sale">>,
): ReceiptPrintContext {
  return {
    sale,
    partner_name: extras?.partner_name ?? null,
    stock_name: extras?.stock_name ?? null,
    document_code: extras?.document_code ?? sale.id,
  };
}

export function wholesaleDocumentToPrintContext(
  doc: Pick<WholesaleDocument, "code" | "id" | "partner_name" | "stock_name">,
  sale: Sale,
): ReceiptPrintContext {
  return saleToPrintContext(sale, {
    partner_name: doc.partner_name,
    stock_name: doc.stock_name,
    document_code: doc.code || String(doc.id),
  });
}

export const SAMPLE_RECEIPT_CONTEXT: ReceiptPrintContext = {
  sale: {
    id: "WS-00123",
    createdAt: new Date().toISOString(),
    cashierId: "1",
    cashierName: "Jane Cashier",
    items: [
      { productId: "1", name: "Product A", price: 15000, qty: 2 },
      { productId: "2", name: "Product B", price: 8500, qty: 1 },
    ],
    subtotal: 38500,
    discount: 500,
    tax: 0,
    total: 38000,
    paymentTypeId: 1,
    paymentTypeName: "Cash",
    isCash: true,
    tendered: 40000,
    change: 2000,
    amountPaid: 38000,
    balanceDue: 0,
  },
  partner_name: "Sample Partner LLC",
  stock_name: "Main Warehouse",
  document_code: "WS-00123",
};
