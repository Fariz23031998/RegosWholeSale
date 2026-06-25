import { describe, expect, it } from "vitest";
import {
  buildCheckoutCartLines,
  buildPrintContextFromCartDraft,
  buildPrintContextFromCheckout,
  buildPrintContextFromReturn,
  buildPrintContextFromWholesale,
} from "@/lib/receipt-context-builder";
import type { Sale } from "@/data/seed";
import type { Product } from "@/types/catalog";
import type {
  CheckoutResponse,
  WholesaleDocument,
  WholesaleOperationLine,
  WholesalePaymentLine,
  WholesaleReturnDocument,
} from "@/lib/sales-api";

const document: WholesaleDocument = {
  id: 10,
  code: "WS-10",
  date: 1_700_000_000,
  partner_id: 2,
  partner_name: "Partner LLC",
  stock_id: 3,
  stock_name: "Main",
  attached_user_id: 4,
  attached_user_name: "Cashier",
  amount: 100,
  performed: true,
  currency: { id: 1, name: "Somoni", code_chr: "TJS", exchange_rate: 1 },
};

const operations: WholesaleOperationLine[] = [
  {
    id: 1,
    document_id: 10,
    item_id: 7,
    item_code: "SKU-7",
    item_name: "Widget",
    item_group_id: 10,
    item_group_name: "Parts",
    item_unit_name: "шт",
    item_brand: "Test",
    quantity: 2,
    price: 40,
    price2: 45,
    amount: 80,
  },
];

const payments: WholesalePaymentLine[] = [
  {
    id: 99,
    code: "PAY-99",
    date: 1_700_000_000,
    amount: 100,
    category_id: 1,
    category_name: "Sales",
    payment_type_name: "Cash",
    partner_id: 2,
    partner_name: "Partner LLC",
    attached_user_id: 4,
    attached_user_name: "Cashier",
    exchange_rate: 1,
    currency: { id: 1, name: "Somoni", code_chr: "TJS", exchange_rate: 1 },
  },
];

describe("receipt context builder", () => {
  it("maps wholesale documents with operations and payments", () => {
    const context = buildPrintContextFromWholesale(document, operations, payments);
    expect(context.kind).toBe("sale");
    expect(context.document.code).toBe("WS-10");
    expect(context.operations[0]?.item_code).toBe("SKU-7");
    expect(context.operation_groups).toHaveLength(1);
    expect(context.totals.quantity).toBe(2);
    expect(context.payments[0]?.payment_type_name).toBe("Cash");
    expect(context.sale.total).toBe(100);
    expect(context.sale.discount).toBe(10);
    expect(context.totals.amount_gross).toBe(90);
    expect(context.totals.discount).toBe(10);
    expect(context.document_code).toBe("WS-10");
  });

  it("maps return documents with refund metadata", () => {
    const returnDocument: WholesaleReturnDocument = {
      ...document,
      id: 11,
      code: "WR-11",
      description: "pulse:ws:10|Damaged",
      wholesale_doc_id: 10,
      reason: "Damaged",
    };
    const context = buildPrintContextFromReturn(returnDocument, operations, payments);
    expect(context.kind).toBe("return");
    expect(context.sale.type).toBe("refund");
    expect(context.sale.reason).toBe("Damaged");
    expect(context.sale.refundOf).toBe("10");
  });

  it("maps checkout operations with cart line metadata for receipt templates", () => {
    const result: CheckoutResponse = {
      wholesale_doc_id: 213,
      wholesale_code: "213",
      payment_doc_id: 1,
      performed_at: "2026-06-24T12:00:00.000Z",
      lines: [
        { regos_item_id: 42, qty: 2, price: 44950, price2: 44950 },
      ],
      payment: {
        payment_type_id: 1,
        payment_doc_id: 1,
        amount: 89900,
        amount_paid: 89900,
        balance_due: 0,
        is_fully_paid: true,
      },
      subtotal: 89900,
      discount: 0,
      total: 89900,
      amount_paid: 89900,
      balance_due: 0,
      is_fully_paid: true,
    };
    const sale: Sale = {
      id: "213",
      createdAt: result.performed_at,
      cashierId: "1",
      cashierName: "Cashier",
      items: [{ productId: "p1", name: "Brake Pad Set", price: 44950, qty: 2 }],
      subtotal: 89900,
      discount: 0,
      tax: 0,
      total: 89900,
      paymentTypeId: 1,
      paymentTypeName: "Cash",
      isCash: true,
      amountPaid: 89900,
      balanceDue: 0,
      saleCurrency: null,
    };

    const context = buildPrintContextFromCheckout({
      result,
      sale,
      cartLines: [
        {
          regos_item_id: 42,
          name: "Brake Pad Set",
          item_code: "BP-42",
          item_group_id: 5,
          item_group_name: "Brakes",
          item_unit_name: "шт",
        },
      ],
      documentExtras: {
        partnerName: "ADLER GROUP DISTRIBUTION",
        stockName: "Main Warehouse",
      },
    });

    expect(context.operations[0]?.item_name).toBe("Brake Pad Set");
    expect(context.operations[0]?.item_code).toBe("BP-42");
    expect(context.operations[0]?.item_group_name).toBe("Brakes");
    expect(context.operation_groups[0]?.name).toBe("Brakes");
    expect(context.document.stock_name).toBe("Main Warehouse");
  });

  it("builds cart draft print context before checkout completes", () => {
    const catalogProducts: Product[] = [
      {
        id: "p1",
        regos_item_id: 42,
        group_id: 9,
        name: "Brake Pad Set",
        price: 44950,
        category: "Brakes",
        stock: 10,
        image: "",
        sku: "BP-42",
        unit_name: "шт",
      },
    ];

    const context = buildPrintContextFromCartDraft({
      items: [{ productId: "p1", regosItemId: 42, name: "Brake Pad Set", price: 44950, qty: 2 }],
      totals: { subtotal: 89900, discount: 0, total: 89900 },
      catalogProducts,
      saleCurrency: null,
      partnerName: "ADLER GROUP DISTRIBUTION",
      stockName: "Main Warehouse",
      cashierId: "1",
      cashierName: "Cashier",
      wholesaleDocId: 213,
    });

    expect(context.document.performed).toBe(false);
    expect(context.document.code).toBe("213");
    expect(context.operations[0]?.item_code).toBe("BP-42");
    expect(context.payments).toHaveLength(0);
    expect(context.sale.total).toBe(89900);
  });

  it("builds checkout cart lines from catalog products", () => {
    const catalogProducts: Product[] = [
      {
        id: "p1",
        regos_item_id: 42,
        group_id: 9,
        name: "Brake Pad Set",
        price: 44950,
        category: "Brakes",
        stock: 10,
        image: "",
        sku: "BP-42",
        unit_name: "шт",
      },
    ];

    const lines = buildCheckoutCartLines(
      [{ productId: "p1", regosItemId: 42, name: "Brake Pad Set" }],
      catalogProducts,
    );

    expect(lines[0]?.item_code).toBe("BP-42");
    expect(lines[0]?.item_group_name).toBe("Brakes");
    expect(lines[0]?.item_unit_name).toBe("шт");
  });
});
