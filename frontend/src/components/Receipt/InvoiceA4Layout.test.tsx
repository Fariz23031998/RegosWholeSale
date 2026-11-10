import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { InvoiceA4Layout } from "@/components/Receipt/InvoiceA4Layout";
import { SAMPLE_RECEIPT_CONTEXT } from "@/lib/receipt-print-context";
import { createReceiptTemplate } from "@/lib/receipt-template-utils";

describe("InvoiceA4Layout product images", () => {
  it("shows a thumbnail only for lines that have an image", () => {
    const html = renderToStaticMarkup(
      <InvoiceA4Layout
        template={createReceiptTemplate("a4", "Acme")}
        context={SAMPLE_RECEIPT_CONTEXT}
      />,
    );

    expect(html).toContain("Балон болт 9594681 UZ");
    expect(html).toContain("data:image/svg+xml");
    expect(html.match(/<img /g)).toHaveLength(1);
    expect(html).toContain("Колодка передни HAGEN керамик");
  });
});
