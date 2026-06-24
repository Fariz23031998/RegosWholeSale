import { describe, expect, it } from "vitest";
import {
  amountToWordsText,
  formatAmountWithWordsText,
  normalizeAmountInWordsLanguage,
} from "@/lib/amount-in-words";

const uzCurrency = { id: 1, name: "Сум", code_chr: "сум", exchange_rate: 1 };
const usdCurrency = { id: 2, name: "US Dollar", code_chr: "USD", exchange_rate: 12600 };

describe("amount-in-words", () => {
  it("normalizes supported languages", () => {
    expect(normalizeAmountInWordsLanguage("ru")).toBe("ru");
    expect(normalizeAmountInWordsLanguage("")).toBeNull();
    expect(normalizeAmountInWordsLanguage("de")).toBeNull();
  });

  it("formats Russian total with words", () => {
    expect(amountToWordsText(1296.38, uzCurrency, "ru")).toBe(
      "Одна тысяча двести девяносто шесть сум 38 тийин",
    );
    expect(formatAmountWithWordsText(1296.38, uzCurrency, "ru")).toBe(
      "1 296.38 (Одна тысяча двести девяносто шесть сум 38 тийин) сум",
    );
  });

  it("formats whole amounts without minor units", () => {
    expect(amountToWordsText(100, uzCurrency, "ru")).toBe("Сто сум");
    expect(formatAmountWithWordsText(100, uzCurrency, "en")).toBe(
      "100 (One hundred som) сум",
    );
  });

  it("formats English amounts with words", () => {
    expect(amountToWordsText(1296.38, uzCurrency, "en")).toBe(
      "One thousand two hundred ninety-six som 38 tiyin",
    );
  });

  it("uses currency-specific unit names for USD", () => {
    expect(amountToWordsText(100.5, usdCurrency, "ru")).toBe(
      "Сто доллар 50 цент",
    );
    expect(formatAmountWithWordsText(100.5, usdCurrency, "en")).toBe(
      "100.50 (One hundred dollar 50 cent) USD",
    );
  });

  it("detects UZS from code_chr UZS", () => {
    const uzs = { id: 44, name: "UZS", code_chr: "UZS", exchange_rate: 1 };
    expect(amountToWordsText(10, uzs, "ru")).toBe("Десять сум");
  });
});
