import { describe, expect, it } from "vitest";
import {
  renderLabelPage,
  renderLabelSheets,
  renderLabelSnippet,
} from "@/lib/label-template-engine";

describe("formatNumber", () => {
  it("groups thousands and drops a zero fraction", () => {
    expect(renderLabelSnippet("{{formatNumber price}}", { price: 123456 })).toBe("123 456");
  });

  it("rounds to two decimals", () => {
    expect(renderLabelSnippet("{{formatNumber price}}", { price: 123000.23433 })).toBe("123 000.23");
  });

  it("prints nothing for an empty price", () => {
    expect(renderLabelSnippet("{{formatNumber price}}", { price: "" })).toBe("");
  });
});

describe("numberPart", () => {
  it("extracts the start, middle, and end of the whole number", () => {
    const html = "{{numberPart price 0 3}}-{{numberPart price 3 6}}-{{numberPart price -3}}";
    expect(renderLabelSnippet(html, { price: 123000.23 })).toBe("123-000-000");
  });

  it("cuts off decimals instead of rounding", () => {
    expect(renderLabelSnippet("{{numberPart price -3}}", { price: "123000.99" })).toBe("000");
  });

  it("ignores the sign", () => {
    expect(renderLabelSnippet("{{numberPart price 0 3}}", { price: -123000.23 })).toBe("123");
  });

  it("returns the digits that exist when the range is longer than the number", () => {
    expect(renderLabelSnippet("{{numberPart price 0 3}}", { price: 45 })).toBe("45");
  });

  it("prints nothing for a value that is not a number", () => {
    expect(renderLabelSnippet("{{numberPart price 0 3}}", { price: "abc" })).toBe("");
  });
});

describe("label template rendering", () => {
  it("substitutes fields and escapes text", () => {
    const html = renderLabelPage(
      { html: "<div>{{ name }}</div>", css: "" },
      { name: "Milk <1L>" },
    );
    expect(html).toContain("<div>Milk &lt;1L&gt;</div>");
    expect(html).not.toContain("Milk <1L>");
  });

  it("escapes text even when the template asks for raw output", () => {
    const html = renderLabelSnippet("{{{ name }}}", { name: "Milk <1L>" });
    expect(html).toBe("Milk &lt;1L&gt;");
  });

  it("builds one sheet per row at the template page size", () => {
    const html = renderLabelSheets(
      {
        html: "<body>{{formatNumber price}}</body>",
        css: ".price { color: red; }",
        paper: { width_mm: 58, height_mm: 40 },
      },
      [{ price: 123456 }, { price: 50 }],
    );
    expect(html).toContain("size: 58mm 40mm");
    expect(html).toContain(".price { color: red; }");
    const templateCssAt = html.indexOf(".price { color: red; }");
    const blackInkAt = html.indexOf("color: #000 !important");
    expect(blackInkAt).toBeGreaterThan(templateCssAt);
    expect(html).toContain("-webkit-font-smoothing: none");
    expect(html).toContain("-webkit-text-fill-color: #000 !important");
    expect(html.match(/label-sheet/g)?.length).toBeGreaterThanOrEqual(2);
    expect(html).toContain("123 456");
    expect(html).toContain(">50<");
  });

  it("renders product image_src into an img tag", () => {
    const html = renderLabelPage(
      { html: '<img class="product" src="{{ image_src }}" alt="" />', css: "" },
      { image_src: "https://cdn.example.test/milk.png" },
    );
    expect(html).toContain('src="https://cdn.example.test/milk.png"');
  });

  it("renders logoImg from template logos", () => {
    const html = renderLabelPage(
      {
        html: '<div>{{logoImg "Primary"}}</div>',
        css: "",
        logos: [
          {
            id: "logo-1",
            name: "Primary",
            src: "data:image/png;base64,aaa",
            max_width: 40,
          },
        ],
      },
      {},
    );
    expect(html).toContain('src="data:image/png;base64,aaa"');
    expect(html).toContain("max-width:40px");
    expect(html).toContain('alt="Primary"');
  });

  it("prints nothing for an unknown logo name", () => {
    expect(
      renderLabelSnippet('{{logoImg "Missing"}}', {}, [
        {
          id: "logo-1",
          name: "Primary",
          src: "data:image/png;base64,aaa",
          max_width: null,
        },
      ]),
    ).toBe("");
  });
});
