import { describe, expect, it } from "vitest";
import { invalidateReceiptTemplateCache, renderReceiptHtmlTemplate } from "@/lib/receipt-template-engine";
import { SAMPLE_RECEIPT_CONTEXT } from "@/lib/receipt-print-context";
import {
  parseImportedReceiptTemplate,
  sanitizeReceiptCss,
  sanitizeTemplateMarkup,
} from "@/lib/receipt-template-utils";
import type { ReceiptTemplate } from "@/types/receipt-templates";

const htmlTemplate: ReceiptTemplate = {
  id: "test-html",
  name: "Test HTML",
  format: "a4",
  engine: "html",
  is_default: false,
  header: {
    company_name: "Acme",
    address: "",
    phone: "",
    tax_id: "",
  },
  invoice_title: "INVOICE",
  footer_text: "Thanks",
  amount_in_words_language: null,
  sections: {
    header: true,
    meta: true,
    partner: true,
    items: true,
    subtotal: true,
    discount: true,
    total: true,
    payments: true,
    tendered_change: true,
    balance_due: true,
    closed_without_payment: true,
    footer: true,
  },
  line_sort: { column: "document_order", direction: "asc" },
  logos: [],
  html: `
    <h1>{{document.code}}</h1>
    {{#each operation_groups}}<section>{{name}}{{#each lines}}<div>{{item_name}}</div>{{/each}}</section>{{/each}}
  `,
  css: "",
};

describe("receipt template engine", () => {
  it("renders document, operations, and payments", () => {
    const html = renderReceiptHtmlTemplate(htmlTemplate, SAMPLE_RECEIPT_CONTEXT);
    expect(html).toContain("13 705");
    expect(html).toContain("Автожон");
    expect(html).toContain("CTR/Valeo Фирма");
  });

  it("renders sale total in words when language is configured", () => {
    invalidateReceiptTemplateCache("test-html-words");
    const html = renderReceiptHtmlTemplate(
      {
        ...htmlTemplate,
        id: "test-html-words",
        amount_in_words_language: "ru",
        html: "<div>{{total_in_words}}</div>",
      },
      SAMPLE_RECEIPT_CONTEXT,
    );
    expect(html).toContain("Триста двадцать шесть");
  });

  it("renders totals amount in words at root level", () => {
    invalidateReceiptTemplateCache("test-html-totals-words");
    const html = renderReceiptHtmlTemplate(
      {
        ...htmlTemplate,
        id: "test-html-totals-words",
        amount_in_words_language: "ru",
        html: "<div>{{formatCurrency totals.amount}} ({{total_in_words}})</div>",
      },
      SAMPLE_RECEIPT_CONTEXT,
    );
    expect(html).toContain("326.74");
    expect(html).toContain("Триста двадцать шесть");
  });

  it("renders logo helper by name", () => {
    invalidateReceiptTemplateCache("test-html-logo");
    const html = renderReceiptHtmlTemplate(
      {
        ...htmlTemplate,
        id: "test-html-logo",
        logos: [
          {
            id: "logo-1",
            name: "Primary",
            src: "data:image/png;base64,abc",
            max_width: 80,
          },
        ],
        html: "<div>{{logoImg \"Primary\"}}</div>",
      },
      SAMPLE_RECEIPT_CONTEXT,
    );
    expect(html).toContain('src="data:image/png;base64,abc"');
    expect(html).toContain('style="max-width:80px');
  });
});

describe("receipt template import", () => {
  it("rejects unsupported versions", () => {
    expect(() =>
      parseImportedReceiptTemplate({ version: 2, template: { format: "a4" } }, "Co"),
    ).toThrow("Unsupported template file version");
  });

  it("parses versioned import packages", () => {
    const imported = parseImportedReceiptTemplate(
      {
        version: 1,
        template: {
          name: "Imported",
          format: "80mm",
          engine: "html",
          html: "<div>{{document.code}}</div>",
          css: ".x{}",
        },
      },
      "Co",
    );
    expect(imported.engine).toBe("html");
    expect(imported.format).toBe("80mm");
    expect(imported.html).toContain("document.code");
  });
});

describe("receipt template security", () => {
  it("rejects script tags and inline handlers in html", () => {
    expect(() => sanitizeTemplateMarkup("<script>alert(1)</script>")).toThrow();
    expect(() => sanitizeTemplateMarkup('<img src="x" onerror="alert(1)">')).toThrow();
    expect(() => sanitizeTemplateMarkup('<iframe src="https://evil.test"></iframe>')).toThrow();
  });

  it("rejects dangerous css directives", () => {
    expect(() => sanitizeReceiptCss("@import url('https://evil.test/x.css');")).toThrow();
    expect(sanitizeReceiptCss(".x { color: red; }")).toBe(".x { color: red; }");
  });
});
