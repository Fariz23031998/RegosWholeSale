import { formatCurrency } from "@/lib/format";
import type { SupportedLanguage } from "@/services/language";
import type { RegosCurrencyOption } from "@/types/settings";

export type AmountInWordsLanguage = SupportedLanguage;

const VALID_AMOUNT_IN_WORDS_LANGUAGES: readonly AmountInWordsLanguage[] = [
  "ru",
  "uz",
  "en",
  "tj",
];

export function normalizeAmountInWordsLanguage(
  value: unknown,
): AmountInWordsLanguage | null {
  if (typeof value !== "string" || !value.trim()) return null;
  return VALID_AMOUNT_IN_WORDS_LANGUAGES.includes(value as AmountInWordsLanguage)
    ? (value as AmountInWordsLanguage)
    : null;
}

type CurrencyUnits = {
  major: string;
  minor: string;
};

type CurrencyUnitNames = Record<AmountInWordsLanguage, CurrencyUnits>;

const CURRENCY_WORD_UNITS: Record<string, CurrencyUnitNames> = {
  UZS: {
    ru: { major: "сум", minor: "тийин" },
    uz: { major: "so'm", minor: "tiyin" },
    en: { major: "som", minor: "tiyin" },
    tj: { major: "сом", minor: "тийин" },
  },
  USD: {
    ru: { major: "доллар", minor: "цент" },
    uz: { major: "dollar", minor: "sent" },
    en: { major: "dollar", minor: "cent" },
    tj: { major: "доллар", minor: "цент" },
  },
  EUR: {
    ru: { major: "евро", minor: "цент" },
    uz: { major: "yevro", minor: "sent" },
    en: { major: "euro", minor: "cent" },
    tj: { major: "евро", minor: "цент" },
  },
  RUB: {
    ru: { major: "рубль", minor: "копейка" },
    uz: { major: "rubl", minor: "tiyin" },
    en: { major: "ruble", minor: "kopek" },
    tj: { major: "рубл", minor: "копейка" },
  },
};

function defaultMinorUnit(language: AmountInWordsLanguage): string {
  switch (language) {
    case "uz":
      return "tiyin";
    case "en":
      return "cent";
    case "tj":
      return "тийин";
    case "ru":
    default:
      return "копейка";
  }
}

function defaultCurrencyUnits(language: AmountInWordsLanguage): CurrencyUnits {
  return CURRENCY_WORD_UNITS.UZS[language];
}

function resolveCurrencyCode(currency: RegosCurrencyOption | null | undefined): string {
  const code = currency?.code_chr?.trim() ?? "";
  const name = currency?.name?.trim() ?? "";
  const upperCode = code.toUpperCase();

  if (upperCode === "UZS" || code === "сум" || code === "Сум" || name.toUpperCase() === "UZS") {
    return "UZS";
  }
  if (upperCode === "USD" || /dollar/i.test(name)) {
    return "USD";
  }
  if (upperCode === "EUR" || /euro/i.test(name)) {
    return "EUR";
  }
  if (upperCode === "RUB" || upperCode === "RUR" || /ruble|рубл/i.test(name)) {
    return "RUB";
  }
  if (upperCode) {
    return upperCode;
  }
  if (/сум|so'?m|som/i.test(name)) {
    return "UZS";
  }

  return "UNKNOWN";
}

function wordsCurrencyUnits(
  currency: RegosCurrencyOption | null | undefined,
  language: AmountInWordsLanguage,
): CurrencyUnits {
  const code = resolveCurrencyCode(currency);
  const known = CURRENCY_WORD_UNITS[code];
  if (known) {
    return known[language];
  }

  const major = displayCurrencyLabel(currency, language);
  return { major, minor: defaultMinorUnit(language) };
}

function displayCurrencyLabel(
  currency: RegosCurrencyOption | null | undefined,
  language: AmountInWordsLanguage,
): string {
  return (
    currency?.code_chr?.trim() ||
    currency?.name?.trim() ||
    defaultCurrencyUnits(language).major
  );
}

function capitalizeFirst(text: string): string {
  if (!text) return text;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function splitAmountParts(amount: number): { integer: number; fraction: number; negative: boolean } {
  const rounded = Math.round(amount * 100) / 100;
  const negative = rounded < 0;
  const abs = Math.abs(rounded);
  const integer = Math.floor(abs);
  const fraction = Math.round((abs - integer) * 100);
  return { integer, fraction, negative };
}

type Gender = "m" | "f";

const RU_ONES_M = [
  "",
  "один",
  "два",
  "три",
  "четыре",
  "пять",
  "шесть",
  "семь",
  "восемь",
  "девять",
];
const RU_ONES_F = [
  "",
  "одна",
  "две",
  "три",
  "четыре",
  "пять",
  "шесть",
  "семь",
  "восемь",
  "девять",
];
const RU_TEENS = [
  "десять",
  "одиннадцать",
  "двенадцать",
  "тринадцать",
  "четырнадцать",
  "пятнадцать",
  "шестнадцать",
  "семнадцать",
  "восемнадцать",
  "девятнадцать",
];
const RU_TENS = [
  "",
  "",
  "двадцать",
  "тридцать",
  "сорок",
  "пятьдесят",
  "шестьдесят",
  "семьдесят",
  "восемьдесят",
  "девяносто",
];
const RU_HUNDREDS = [
  "",
  "сто",
  "двести",
  "триста",
  "четыреста",
  "пятьсот",
  "шестьсот",
  "семьсот",
  "восемьсот",
  "девятьсот",
];

function ruPluralForm(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}

function ruTripletWords(n: number, gender: Gender): string {
  if (n === 0) return "";

  const hundreds = Math.floor(n / 100);
  const tensUnits = n % 100;
  const tens = Math.floor(tensUnits / 10);
  const ones = tensUnits % 10;
  const parts: string[] = [];

  if (hundreds > 0) parts.push(RU_HUNDREDS[hundreds]);
  if (tensUnits >= 10 && tensUnits < 20) {
    parts.push(RU_TEENS[tensUnits - 10]);
  } else {
    if (tens > 0) parts.push(RU_TENS[tens]);
    if (ones > 0) parts.push((gender === "f" ? RU_ONES_F : RU_ONES_M)[ones]);
  }

  return parts.join(" ");
}

function integerToWordsRu(n: number): string {
  if (n === 0) return "ноль";

  const scales: Array<{ value: number; gender: Gender; forms: [string, string, string] }> = [
    { value: 1_000_000_000, gender: "m", forms: ["миллиард", "миллиарда", "миллиардов"] },
    { value: 1_000_000, gender: "m", forms: ["миллион", "миллиона", "миллионов"] },
    { value: 1_000, gender: "f", forms: ["тысяча", "тысячи", "тысяч"] },
  ];

  let remaining = n;
  const parts: string[] = [];

  for (const scale of scales) {
    const count = Math.floor(remaining / scale.value);
    if (count > 0) {
      parts.push(ruTripletWords(count, scale.gender));
      parts.push(ruPluralForm(count, ...scale.forms));
      remaining %= scale.value;
    }
  }

  if (remaining > 0 || parts.length === 0) {
    parts.push(ruTripletWords(remaining, "m"));
  }

  return parts.join(" ").replace(/\s+/g, " ").trim();
}

const EN_ONES = [
  "",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
];
const EN_TENS = [
  "",
  "",
  "twenty",
  "thirty",
  "forty",
  "fifty",
  "sixty",
  "seventy",
  "eighty",
  "ninety",
];

function integerToWordsEn(n: number): string {
  if (n === 0) return "zero";
  if (n < 20) return EN_ONES[n];

  const scales = [
    { value: 1_000_000_000, name: "billion" },
    { value: 1_000_000, name: "million" },
    { value: 1_000, name: "thousand" },
  ];

  let remaining = n;
  const parts: string[] = [];

  for (const scale of scales) {
    const count = Math.floor(remaining / scale.value);
    if (count > 0) {
      parts.push(integerToWordsEn(count));
      parts.push(scale.name);
      remaining %= scale.value;
    }
  }

  if (remaining >= 100) {
    const hundreds = Math.floor(remaining / 100);
    parts.push(`${EN_ONES[hundreds]} hundred`);
    remaining %= 100;
  }

  if (remaining >= 20) {
    const tens = Math.floor(remaining / 10);
    const ones = remaining % 10;
    parts.push(ones > 0 ? `${EN_TENS[tens]}-${EN_ONES[ones]}` : EN_TENS[tens]);
  } else if (remaining > 0) {
    parts.push(EN_ONES[remaining]);
  }

  return parts.join(" ");
}

const UZ_ONES = [
  "",
  "bir",
  "ikki",
  "uch",
  "to'rt",
  "besh",
  "olti",
  "yetti",
  "sakkiz",
  "to'qqiz",
];
const UZ_TEENS = [
  "o'n",
  "o'n bir",
  "o'n ikki",
  "o'n uch",
  "o'n to'rt",
  "o'n besh",
  "o'n olti",
  "o'n yetti",
  "o'n sakkiz",
  "o'n to'qqiz",
];
const UZ_TENS = [
  "",
  "",
  "yigirma",
  "o'ttiz",
  "qirq",
  "ellik",
  "oltmish",
  "yetmish",
  "sakson",
  "to'qson",
];
const UZ_HUNDREDS = [
  "",
  "yuz",
  "ikki yuz",
  "uch yuz",
  "to'rt yuz",
  "besh yuz",
  "olti yuz",
  "yetti yuz",
  "sakkiz yuz",
  "to'qqiz yuz",
];

function uzTripletWords(n: number): string {
  if (n === 0) return "";
  const hundreds = Math.floor(n / 100);
  const tensUnits = n % 100;
  const tens = Math.floor(tensUnits / 10);
  const ones = tensUnits % 10;
  const parts: string[] = [];
  if (hundreds > 0) parts.push(UZ_HUNDREDS[hundreds]);
  if (tensUnits >= 10 && tensUnits < 20) {
    parts.push(UZ_TEENS[tensUnits - 10]);
  } else {
    if (tens > 0) parts.push(UZ_TENS[tens]);
    if (ones > 0) parts.push(UZ_ONES[ones]);
  }
  return parts.join(" ");
}

function integerToWordsUz(n: number): string {
  if (n === 0) return "nol";
  const scales = [
    { value: 1_000_000_000, name: "milliard" },
    { value: 1_000_000, name: "million" },
    { value: 1_000, name: "ming" },
  ];
  let remaining = n;
  const parts: string[] = [];
  for (const scale of scales) {
    const count = Math.floor(remaining / scale.value);
    if (count > 0) {
      parts.push(uzTripletWords(count));
      parts.push(scale.name);
      remaining %= scale.value;
    }
  }
  if (remaining > 0 || parts.length === 0) {
    parts.push(uzTripletWords(remaining));
  }
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

const TJ_ONES_M = [
  "",
  "як",
  "ду",
  "се",
  "чор",
  "панҷ",
  "шаш",
  "ҳафт",
  "ҳашт",
  "нӯҳ",
];
const TJ_ONES_F = [
  "",
  "як",
  "ду",
  "се",
  "чор",
  "панҷ",
  "шаш",
  "ҳафт",
  "ҳашт",
  "нӯҳ",
];
const TJ_TEENS = [
  "даҳ",
  "ёздаҳ",
  "дувоздаҳ",
  "сенздаҳ",
  "чордаҳ",
  "понздаҳ",
  "шонздаҳ",
  "ҳабдаҳ",
  "ҳаждаҳ",
  "нуздаҳ",
];
const TJ_TENS = [
  "",
  "",
  "бист",
  "сӣ",
  "чил",
  "панҷоҳ",
  "шаст",
  "ҳафтод",
  "ҳаштод",
  "навад",
];
const TJ_HUNDREDS = [
  "",
  "сад",
  "ду сад",
  "се сад",
  "чор сад",
  "панҷ сад",
  "шаш сад",
  "ҳафт сад",
  "ҳашт сад",
  "нӯҳ сад",
];

function tjPluralForm(n: number, one: string, few: string, many: string): string {
  return ruPluralForm(n, one, few, many);
}

function tjTripletWords(n: number, gender: Gender): string {
  if (n === 0) return "";
  const hundreds = Math.floor(n / 100);
  const tensUnits = n % 100;
  const tens = Math.floor(tensUnits / 10);
  const ones = tensUnits % 10;
  const parts: string[] = [];
  if (hundreds > 0) parts.push(TJ_HUNDREDS[hundreds]);
  if (tensUnits >= 10 && tensUnits < 20) {
    parts.push(TJ_TEENS[tensUnits - 10]);
  } else {
    if (tens > 0) parts.push(TJ_TENS[tens]);
    if (ones > 0) parts.push((gender === "f" ? TJ_ONES_F : TJ_ONES_M)[ones]);
  }
  return parts.join(" ");
}

function integerToWordsTj(n: number): string {
  if (n === 0) return "сифр";
  const scales: Array<{ value: number; gender: Gender; forms: [string, string, string] }> = [
    { value: 1_000_000_000, gender: "m", forms: ["миллиард", "миллиард", "миллиард"] },
    { value: 1_000_000, gender: "m", forms: ["миллион", "миллион", "миллион"] },
    { value: 1_000, gender: "f", forms: ["ҳазор", "ҳазор", "ҳазор"] },
  ];
  let remaining = n;
  const parts: string[] = [];
  for (const scale of scales) {
    const count = Math.floor(remaining / scale.value);
    if (count > 0) {
      parts.push(tjTripletWords(count, scale.gender));
      parts.push(tjPluralForm(count, ...scale.forms));
      remaining %= scale.value;
    }
  }
  if (remaining > 0 || parts.length === 0) {
    parts.push(tjTripletWords(remaining, "m"));
  }
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

function integerToWords(n: number, language: AmountInWordsLanguage): string {
  switch (language) {
    case "en":
      return integerToWordsEn(n);
    case "uz":
      return integerToWordsUz(n);
    case "tj":
      return integerToWordsTj(n);
    case "ru":
    default:
      return integerToWordsRu(n);
  }
}

export function amountToWordsText(
  amount: number,
  currency: RegosCurrencyOption | null | undefined,
  language: AmountInWordsLanguage,
): string {
  const { integer, fraction, negative } = splitAmountParts(amount);
  const units = wordsCurrencyUnits(currency, language);
  const integerWords = capitalizeFirst(integerToWords(integer, language));
  const prefix = negative ? "-" : "";

  if (fraction > 0) {
    return `${prefix}${integerWords} ${units.major} ${fraction} ${units.minor}`;
  }

  return `${prefix}${integerWords} ${units.major}`;
}

export function formatAmountWithWordsText(
  amount: number,
  currency: RegosCurrencyOption | null | undefined,
  language: AmountInWordsLanguage,
): string {
  const label = displayCurrencyLabel(currency, language);
  const formattedAmount = formatCurrency(amount);
  const words = amountToWordsText(amount, currency, language);
  return `${formattedAmount} (${words}) ${label}`;
}

export function enrichSaleWithAmountInWords<
  TSale extends { total: number; saleCurrency?: RegosCurrencyOption | null },
>(
  sale: TSale,
  language: AmountInWordsLanguage | null,
): TSale & { total_in_words: string; total_with_words: string } {
  if (!language) {
    return { ...sale, total_in_words: "", total_with_words: "" };
  }

  return {
    ...sale,
    total_in_words: amountToWordsText(sale.total, sale.saleCurrency, language),
    total_with_words: formatAmountWithWordsText(sale.total, sale.saleCurrency, language),
  };
}
