import { useEffect, useState, type ReactNode } from "react";
import { Printer } from "lucide-react";
import { ApiError } from "@/lib/api";
import { fetchPublicTemplateShare } from "@/lib/receipt-share-api";
import type { DocumentPrintContext } from "@/lib/receipt-print-context";
import type { WholesaleReturnDocument } from "@/lib/sales-api";
import type { ReceiptTemplate } from "@/types/receipt-templates";
import { Button } from "@/components/posui/Button";
import { LanguageSelector } from "@/components/LanguageSelector";
import { useLanguage } from "@/contexts/LanguageContext";
import { ReturnsDetailContent } from "@/components/Returns/ReturnsDetailContent";
import { SalesDetailContent } from "@/components/Sales/SalesDetailContent";
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
