import { describe, expect, it } from "vitest";
import {
  arithmeticExpressionToHandlebars,
  preprocessArithmeticExpressions,
} from "@/lib/receipt-template-arithmetic";

describe("receipt template arithmetic", () => {
  it("converts multiplication", () => {
    expect(arithmeticExpressionToHandlebars("price2 * quantity")).toBe("(mul price2 quantity)");
  });

  it("respects operator precedence", () => {
    expect(arithmeticExpressionToHandlebars("price2 * quantity - amount")).toBe(
      "(sub (mul price2 quantity) amount)",
    );
  });

  it("preprocesses arithmetic tags in html", () => {
    expect(preprocessArithmeticExpressions('<td>{{ price2 * quantity }}</td>')).toBe(
      "<td>{{(mul price2 quantity)}}</td>",
    );
  });

  it("preprocesses arithmetic inside helpers", () => {
    expect(
      preprocessArithmeticExpressions("{{formatCurrency price2 * quantity}}"),
    ).toBe("{{formatCurrency (mul price2 quantity)}}");
  });

  it("leaves non-arithmetic tags unchanged", () => {
    const source = '{{document.code}} {{#if (eq kind "return")}}x{{/if}}';
    expect(preprocessArithmeticExpressions(source)).toBe(source);
  });
});
