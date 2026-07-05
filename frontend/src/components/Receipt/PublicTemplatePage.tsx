import { useEffect, useState, type ReactNode } from "react";
import { Printer } from "lucide-react";
import { ApiError } from "@/lib/api";
import {
  collectKnownCurrencies,
  currencyLabel,
  currencyWithExchangeRate,
} from "@/lib/currency-conversion";
import { fetchPublicTemplateShare } from "@/lib/receipt-share-api";
import type { DocumentPrintContext } from "@/lib/receipt-print-context";
import type { WholesaleReturnDocument } from "@/lib/sales-api";
import type { ReceiptTemplate } from "@/types/receipt-templates";
import type { RegosCurrencyOption } from "@/types/settings";
import { Button } from "@/components/posui/Button";
import { LanguageSelector } from "@/components/LanguageSelector";
import { useLanguage } from "@/contexts/LanguageContext";
import { ReturnsDetailContent } from "@/components/Returns/ReturnsDetailContent";
import { SalesDetailContent } from "@/components/Sales/SalesDetailContent";
import salesStyles from "@/components/Sales/Sales.module.css";
import { PrintAreaPortal } from "./PrintAreaPortal";
import { TemplatedReceiptView } from "./TemplatedReceiptView";
import styles from "./PublicTemplatePage.module.css";

type PageState =
  | { status: "loading" }
  | {
      status: "ready";
      template: ReceiptTemplate;
      context: DocumentPrintContext;
      documentCode: string | null;
    }
  | { status: "not_found" }
  | { status: "expired" }
  | { status: "private" }
  | { status: "error"; message: string };

type Props = {
  publicToken: string;
};

function formatNonUnityExchangeRate(value: number | null | undefined): string | null {
  if (value == null || value === 1) return null;
  return Number.isInteger(value) ? String(value) : value.toFixed(4).replace(/\.?0+$/, "");
}

function formatCurrencyName(currency: RegosCurrencyOption | null | undefined): string {
  if (!currency) return "—";
  return currencyLabel(currency) || currency.name || "—";
}

type PaymentCurrencyEntry = {
  key: string;
  currency: RegosCurrencyOption;
  exchangeRate: number | null;
  paymentTypeName?: string | null;
};

function resolvePaymentCurrencyEntries(context: DocumentPrintContext): PaymentCurrencyEntry[] {
  const knownCurrencies = collectKnownCurrencies(
    [context.document.currency, context.sale.saleCurrency],
    context.payments.map((payment) => payment.currency),
    context.sale.payments?.map((payment) => payment.paymentCurrency) ?? [],
    [context.sale.paymentCurrency],
  );
  const entries: PaymentCurrencyEntry[] = [];
  const seen = new Set<number>();

  const addEntry = (
    currency: RegosCurrencyOption | null | undefined,
    exchangeRate: number | null | undefined,
    paymentTypeName?: string | null,
    keySuffix = "",
  ) => {
    const resolved = currencyWithExchangeRate(currency, knownCurrencies);
    if (!resolved?.id || seen.has(resolved.id)) return;
    seen.add(resolved.id);
    entries.push({
      key: `${resolved.id}${keySuffix}`,
      currency: resolved,
      exchangeRate: exchangeRate ?? resolved.exchange_rate ?? null,
      paymentTypeName,
    });
  };

  for (const payment of context.payments) {
    addEntry(
      payment.currency,
      payment.exchange_rate,
      payment.payment_type_name,
      `:${payment.id}`,
    );
  }

  if (entries.length === 0 && context.sale.paymentCurrency) {
    addEntry(context.sale.paymentCurrency, context.sale.paymentCurrency.exchange_rate);
  }

  if (entries.length === 0 && context.sale.payments?.length) {
    for (const [index, payment] of context.sale.payments.entries()) {
      addEntry(
        payment.paymentCurrency,
        payment.paymentCurrency?.exchange_rate,
        payment.paymentTypeName,
        `:sale:${index}`,
      );
    }
  }

  return entries;
}

function PublicDocumentCurrencyMeta({ context }: { context: DocumentPrintContext }) {
  const { t } = useLanguage();
  const knownCurrencies = collectKnownCurrencies(
    [context.document.currency, context.sale.saleCurrency],
    context.payments.map((payment) => payment.currency),
    context.sale.payments?.map((payment) => payment.paymentCurrency) ?? [],
    [context.sale.paymentCurrency],
  );
  const saleCurrency = currencyWithExchangeRate(
    context.document.currency ?? context.sale.saleCurrency,
    knownCurrencies,
  );
  const paymentEntries = resolvePaymentCurrencyEntries(context);
  const saleExchangeRate = formatNonUnityExchangeRate(saleCurrency?.exchange_rate);

  if (!saleCurrency && paymentEntries.length === 0) {
    return null;
  }

  return (
    <div className={salesStyles.detailMeta}>
      {saleCurrency ? (
        <div>
          <span className={salesStyles.detailLabel}>
            {t("publicDocument.saleCurrency", "Sale currency")}
          </span>
          <span>{formatCurrencyName(saleCurrency)}</span>
        </div>
      ) : null}
      {saleExchangeRate ? (
        <div>
          <span className={salesStyles.detailLabel}>
            {t("publicDocument.saleExchangeRate", "Sale exchange rate")}
          </span>
          <span>{saleExchangeRate}</span>
        </div>
      ) : null}
      {paymentEntries.flatMap((entry) => {
        const paymentExchangeRate = formatNonUnityExchangeRate(entry.exchangeRate);
        const paymentLabel = entry.paymentTypeName
          ? t(
              "publicDocument.paymentCurrencyWithType",
              "Payment currency ({{type}})",
              { type: entry.paymentTypeName },
            )
          : t("publicDocument.paymentCurrency", "Payment currency");
        const cells = [
          <div key={`${entry.key}-currency`}>
            <span className={salesStyles.detailLabel}>{paymentLabel}</span>
            <span>{formatCurrencyName(entry.currency)}</span>
          </div>,
        ];
        if (paymentExchangeRate) {
          cells.push(
            <div key={`${entry.key}-rate`}>
              <span className={salesStyles.detailLabel}>
                {entry.paymentTypeName
                  ? t(
                      "publicDocument.paymentExchangeRateWithType",
                      "Payment exchange rate ({{type}})",
                      { type: entry.paymentTypeName },
                    )
                  : t("publicDocument.paymentExchangeRate", "Payment exchange rate")}
              </span>
              <span>{paymentExchangeRate}</span>
            </div>,
          );
        }
        return cells;
      })}
    </div>
  );
}

function PublicPageShell({ children }: { children: ReactNode }) {
  return (
    <div className={styles.page}>
      <div className={styles.pageToolbar}>
        <LanguageSelector />
      </div>
      {children}
    </div>
  );
}

export function PublicTemplatePage({ publicToken }: Props) {
  const { t } = useLanguage();
  const [state, setState] = useState<PageState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const payload = await fetchPublicTemplateShare(publicToken);
        if (cancelled) return;
        setState({
          status: "ready",
          template: payload.template,
          context: payload.context,
          documentCode: payload.document_code,
        });
      } catch (error) {
        if (cancelled) return;
        if (error instanceof ApiError) {
          if (error.code === "PUBLIC_TEMPLATE_NOT_FOUND") {
            setState({ status: "not_found" });
            return;
          }
          if (error.code === "PUBLIC_TEMPLATE_EXPIRED") {
            setState({ status: "expired" });
            return;
          }
          if (error.code === "PUBLIC_TEMPLATE_PRIVATE") {
            setState({ status: "private" });
            return;
          }
        }
        setState({
          status: "error",
          message:
            error instanceof Error
              ? error.message
              : t("publicDocument.errors.load", "Failed to load document details."),
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [publicToken, t]);

  if (state.status === "loading") {
    return (
      <PublicPageShell>
        <div className={styles.messageCard}>
          {t("publicDocument.loading", "Loading document details…")}
        </div>
      </PublicPageShell>
    );
  }

  if (state.status === "not_found") {
    return (
      <PublicPageShell>
        <div className={styles.messageCard}>
          <h1>{t("publicDocument.notFound.title", "Document not found")}</h1>
          <p>
            {t(
              "publicDocument.notFound.description",
              "This link is invalid or the document is no longer available.",
            )}
          </p>
        </div>
      </PublicPageShell>
    );
  }

  if (state.status === "expired") {
    return (
      <PublicPageShell>
        <div className={styles.messageCard}>
          <h1>{t("publicDocument.expired.title", "Link expired")}</h1>
          <p>
            {t(
              "publicDocument.expired.description",
              "This link has expired. Ask the sender for a new link.",
            )}
          </p>
        </div>
      </PublicPageShell>
    );
  }

  if (state.status === "private") {
    return (
      <PublicPageShell>
        <div className={styles.messageCard}>
          <h1>{t("publicDocument.private.title", "Private document")}</h1>
          <p>
            {t(
              "publicDocument.private.description",
              "This document is not available for public viewing.",
            )}
          </p>
        </div>
      </PublicPageShell>
    );
  }

  if (state.status === "error") {
    return (
      <PublicPageShell>
        <div className={styles.messageCard}>
          <h1>{t("publicDocument.error.title", "Could not load document")}</h1>
          <p>{state.message}</p>
        </div>
      </PublicPageShell>
    );
  }

  const { template, context, documentCode } = state;
  const isReturn = context.kind === "return";
  const docCode =
    documentCode ??
    context.document_code ??
    context.document.code ??
    String(context.document.id);

  const pageTitle = isReturn
    ? t("returns.detail.title", undefined, { code: docCode })
    : t("sales.detail.title", undefined, { code: docCode });

  const pageSubtitle = isReturn
    ? t("publicReturn.subtitle", "Shared return details")
    : t("publicSale.subtitle", "Shared sale details");

  return (
    <PublicPageShell>
      <div className={styles.content}>
        <header className={styles.header}>
          <div>
            <h1 className={styles.title}>{pageTitle}</h1>
            <p className={styles.subtitle}>{pageSubtitle}</p>
          </div>
          <Button variant="secondary" onClick={() => window.print()}>
            <Printer size={16} /> {t("receipt.print", "Print")}
          </Button>
        </header>

        <section className={styles.detailsCard}>
          <PublicDocumentCurrencyMeta context={context} />
          {isReturn ? (
            <ReturnsDetailContent
              document={context.document as WholesaleReturnDocument}
              operations={context.operations}
              payments={context.payments}
            />
          ) : (
            <SalesDetailContent
              document={context.document}
              operations={context.operations}
              payments={context.payments}
            />
          )}
        </section>
      </div>

      <PrintAreaPortal active>
        <TemplatedReceiptView template={template} context={context} />
      </PrintAreaPortal>
    </PublicPageShell>
  );
}
