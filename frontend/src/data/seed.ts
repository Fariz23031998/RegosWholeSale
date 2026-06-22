import type { Product } from "@/types/catalog";
import type { RegosCurrencyOption } from "@/types/settings";

export type Cashier = {
  id: string;
  name: string;
  pin: string;
  initials: string;
  color: string;
};

export const CATEGORIES = [
  "All",
  "Beverages",
  "Snacks",
  "Bakery",
  "Produce",
  "Household",
] as const;

const img = (slug: string) => `https://picsum.photos/seed/${slug}/400/280`;

export const SEED_PRODUCTS: Product[] = [
  // Beverages
  { id: "p1", sku: "BEV-001", name: "Espresso Roast Coffee", price: 12.5, category: "Beverages", stock: 24, image: img("coffeebag") },
  { id: "p2", sku: "BEV-002", name: "Cold Brew Bottle", price: 4.25, category: "Beverages", stock: 36, image: img("coldbrew") },
  { id: "p3", sku: "BEV-003", name: "Sparkling Water", price: 1.75, category: "Beverages", stock: 80, image: img("sparkling") },
  { id: "p4", sku: "BEV-004", name: "Orange Juice 1L", price: 5.5, category: "Beverages", stock: 18, image: img("oj") },
  { id: "p5", sku: "BEV-005", name: "Green Tea Box", price: 6.0, category: "Beverages", stock: 22, image: img("greentea") },
  { id: "p6", sku: "BEV-006", name: "Energy Drink", price: 3.25, category: "Beverages", stock: 60, image: img("energy") },

  // Snacks
  { id: "p7", sku: "SNK-001", name: "Sea Salt Chips", price: 2.99, category: "Snacks", stock: 45, image: img("chips") },
  { id: "p8", sku: "SNK-002", name: "Dark Chocolate Bar", price: 3.5, category: "Snacks", stock: 30, image: img("chocolate") },
  { id: "p9", sku: "SNK-003", name: "Trail Mix", price: 5.75, category: "Snacks", stock: 25, image: img("trailmix") },
  { id: "p10", sku: "SNK-004", name: "Granola Bar Pack", price: 4.5, category: "Snacks", stock: 40, image: img("granola") },
  { id: "p11", sku: "SNK-005", name: "Pretzels", price: 2.5, category: "Snacks", stock: 50, image: img("pretzel") },
  { id: "p12", sku: "SNK-006", name: "Roasted Almonds", price: 6.25, category: "Snacks", stock: 28, image: img("almonds") },

  // Bakery
  { id: "p13", sku: "BAK-001", name: "Sourdough Loaf", price: 7.0, category: "Bakery", stock: 12, image: img("sourdough") },
  { id: "p14", sku: "BAK-002", name: "Croissant", price: 3.25, category: "Bakery", stock: 20, image: img("croissant") },
  { id: "p15", sku: "BAK-003", name: "Blueberry Muffin", price: 2.75, category: "Bakery", stock: 18, image: img("muffin") },
  { id: "p16", sku: "BAK-004", name: "Bagel", price: 1.95, category: "Bakery", stock: 32, image: img("bagel") },
  { id: "p17", sku: "BAK-005", name: "Cinnamon Roll", price: 3.75, category: "Bakery", stock: 14, image: img("cinnamon") },
  { id: "p18", sku: "BAK-006", name: "Baguette", price: 4.5, category: "Bakery", stock: 10, image: img("baguette") },

  // Produce
  { id: "p19", sku: "PRD-001", name: "Bananas (lb)", price: 0.69, category: "Produce", stock: 100, image: img("banana") },
  { id: "p20", sku: "PRD-002", name: "Hass Avocado", price: 1.5, category: "Produce", stock: 50, image: img("avocado") },
  { id: "p21", sku: "PRD-003", name: "Honeycrisp Apple", price: 1.25, category: "Produce", stock: 70, image: img("apple") },
  { id: "p22", sku: "PRD-004", name: "Spinach Bunch", price: 3.0, category: "Produce", stock: 25, image: img("spinach") },
  { id: "p23", sku: "PRD-005", name: "Strawberries Pint", price: 4.5, category: "Produce", stock: 18, image: img("strawberry") },
  { id: "p24", sku: "PRD-006", name: "Roma Tomato (lb)", price: 1.99, category: "Produce", stock: 40, image: img("tomato") },

  // Household
  { id: "p25", sku: "HSE-001", name: "Paper Towels 6pk", price: 9.99, category: "Household", stock: 15, image: img("papertowel") },
  { id: "p26", sku: "HSE-002", name: "Dish Soap", price: 4.25, category: "Household", stock: 22, image: img("dishsoap") },
  { id: "p27", sku: "HSE-003", name: "Toothpaste", price: 3.5, category: "Household", stock: 30, image: img("toothpaste") },
  { id: "p28", sku: "HSE-004", name: "Laundry Pods", price: 14.5, category: "Household", stock: 12, image: img("laundry") },
  { id: "p29", sku: "HSE-005", name: "LED Light Bulb", price: 5.99, category: "Household", stock: 26, image: img("bulb") },
  { id: "p30", sku: "HSE-006", name: "Trash Bags 30ct", price: 8.5, category: "Household", stock: 18, image: img("trashbag") },
];

export const SEED_CASHIERS: Cashier[] = [
  { id: "c1", name: "Alice Chen", pin: "1234", initials: "AC", color: "#4f46e5" },
  { id: "c2", name: "Bobby Reyes", pin: "5678", initials: "BR", color: "#0ea5e9" },
];

// Pre-seed a few sales for the dashboard / sales history.
// Use a fixed epoch so SSR + client hydration produce identical IDs.
const SEED_EPOCH = new Date("2025-01-15T12:00:00Z").getTime();
const dayMs = 24 * 60 * 60 * 1000;

import type { RegosCurrencyOption } from "@/types/settings";

export type SaleItem = {
  productId: string;
  name: string;
  price: number;
  qty: number;
};

export type SalePaymentLine = {
  paymentTypeId: number;
  paymentTypeName: string;
  isCash: boolean;
  amountPaid: number;
  paymentCurrency?: RegosCurrencyOption | null;
  paymentAmount?: number;
};

export type Sale = {
  id: string;
  createdAt: string;
  cashierId: string;
  cashierName: string;
  items: SaleItem[];
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  paymentTypeId: number;
  paymentTypeName: string;
  isCash: boolean;
  tendered?: number;
  change?: number;
  amountPaid?: number;
  balanceDue?: number;
  saleCurrency?: RegosCurrencyOption | null;
  paymentCurrency?: RegosCurrencyOption | null;
  paymentAmount?: number;
  tenderedInPaymentCurrency?: number;
  changeInPaymentCurrency?: number;
  payments?: SalePaymentLine[];
  type?: "sale" | "refund";
  refundOf?: string;
  reason?: string;
};

const SEED_PAYMENT = {
  cash: { id: 1, name: "Cash", isCash: true },
  card: { id: 2, name: "Card", isCash: false },
} as const;

const mkSale = (
  daysAgo: number,
  hour: number,
  cashier: Cashier,
  items: { p: Product; qty: number }[],
  payment: keyof typeof SEED_PAYMENT,
): Sale => {
  const paymentType = SEED_PAYMENT[payment];
  const ts = new Date(SEED_EPOCH - daysAgo * dayMs);
  ts.setUTCHours(hour, (daysAgo * 7 + hour * 3) % 59, 0, 0);
  const lineItems: SaleItem[] = items.map(({ p, qty }) => ({
    productId: p.id,
    name: p.name,
    price: p.price,
    qty,
  }));
  const subtotal = lineItems.reduce((s, i) => s + i.price * i.qty, 0);
  const total = +subtotal.toFixed(2);
  return {
    id: `S${ts.getTime().toString(36).toUpperCase()}`,
    createdAt: ts.toISOString(),
    cashierId: cashier.id,
    cashierName: cashier.name,
    items: lineItems,
    subtotal: +subtotal.toFixed(2),
    discount: 0,
    tax: 0,
    total,
    paymentTypeId: paymentType.id,
    paymentTypeName: paymentType.name,
    isCash: paymentType.isCash,
    tendered: paymentType.isCash ? Math.ceil(total / 5) * 5 : undefined,
    change: paymentType.isCash
      ? +(Math.ceil(total / 5) * 5 - total).toFixed(2)
      : undefined,
  };
};

const p = (id: string) => SEED_PRODUCTS.find((x) => x.id === id)!;

export const SEED_SALES: Sale[] = [
  mkSale(0, 9, SEED_CASHIERS[0], [{ p: p("p1"), qty: 1 }, { p: p("p14"), qty: 2 }], "card"),
  mkSale(0, 11, SEED_CASHIERS[1], [{ p: p("p7"), qty: 3 }, { p: p("p3"), qty: 2 }], "cash"),
  mkSale(0, 13, SEED_CASHIERS[0], [{ p: p("p13"), qty: 1 }, { p: p("p20"), qty: 4 }], "card"),
  mkSale(1, 10, SEED_CASHIERS[1], [{ p: p("p25"), qty: 1 }, { p: p("p26"), qty: 2 }], "card"),
  mkSale(1, 15, SEED_CASHIERS[0], [{ p: p("p2"), qty: 4 }], "cash"),
  mkSale(2, 12, SEED_CASHIERS[0], [{ p: p("p7"), qty: 5 }, { p: p("p11"), qty: 2 }], "card"),
  mkSale(3, 14, SEED_CASHIERS[1], [{ p: p("p19"), qty: 6 }, { p: p("p21"), qty: 4 }], "cash"),
  mkSale(4, 9, SEED_CASHIERS[0], [{ p: p("p13"), qty: 2 }, { p: p("p14"), qty: 3 }], "card"),
  mkSale(5, 16, SEED_CASHIERS[1], [{ p: p("p28"), qty: 1 }, { p: p("p30"), qty: 1 }], "card"),
  mkSale(6, 11, SEED_CASHIERS[0], [{ p: p("p7"), qty: 2 }, { p: p("p8"), qty: 3 }, { p: p("p3"), qty: 4 }], "cash"),
];
