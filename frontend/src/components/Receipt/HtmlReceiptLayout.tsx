import { useEffect, useMemo, useRef } from "react";
import clsx from "clsx";
import type { DocumentPrintContext } from "@/lib/receipt-print-context";
import { renderReceiptTemplate } from "@/lib/receipt-template-engine";
import { sanitizeReceiptCss } from "@/lib/receipt-template-utils";
import type { ReceiptTemplate } from "@/types/receipt-templates";
import styles from "./HtmlReceipt.module.css";

type Props = {
  template: ReceiptTemplate;
  context: DocumentPrintContext;
  preview?: boolean;
};

function buildSandboxedReceiptDocument(html: string, css: string, preview: boolean): string {
  const previewCss = preview
    ? "html,body{margin:0;padding:0;overflow-x:hidden;background:#fff;}body{min-height:100%;}"
    : "";
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${previewCss}${css}</style></head><body>${html}</body></html>`;
}

function resolveSafeCss(css: string): string {
  if (!css) return "";
  try {
    return sanitizeReceiptCss(css);
  } catch {
    return "";
  }
}

function safeRenderReceiptTemplate(
  template: ReceiptTemplate,
  context: DocumentPrintContext,
) {
  try {
    return renderReceiptTemplate(template, context);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Template render failed.";
    return {
      html: "",
      css: template.css,
      error: message,
    };
  }
}

export function HtmlReceiptLayout({ template, context, preview = false }: Props) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const { html, css, error } = useMemo(
    () => safeRenderReceiptTemplate(template, context),
    [template, context],
  );
  const safeCss = useMemo(() => resolveSafeCss(css), [css]);
  const srcDoc = useMemo(() => {
    if (error) return "";
    return buildSandboxedReceiptDocument(html, safeCss, preview);
  }, [error, html, preview, safeCss]);

  useEffect(() => {
    if (error) return;

    const frame = frameRef.current;
    if (!frame) return;

    let observer: ResizeObserver | undefined;

    const resize = () => {
      const doc = frame.contentDocument;
      if (!doc) return;
      const height = Math.max(
        doc.body?.scrollHeight ?? 0,
        doc.documentElement?.scrollHeight ?? 0,
      );
      if (height > 0) {
        frame.style.height = `${height}px`;
      }
    };

    const onLoad = () => {
      resize();

      const doc = frame.contentDocument;
      if (!doc?.body) return;

      observer?.disconnect();
      observer = new ResizeObserver(() => resize());
      observer.observe(doc.body);
    };

    frame.addEventListener("load", onLoad);
    onLoad();

    return () => {
      frame.removeEventListener("load", onLoad);
      observer?.disconnect();
    };
  }, [error, preview, srcDoc]);

  if (error) {
    return (
      <div className={styles.htmlReceipt}>
        <div className={styles.renderError} role="alert">
          {error}
        </div>
      </div>
    );
  }

  return (
    <div className={clsx(styles.htmlReceipt, preview && styles.htmlReceiptPreview)}>
      <iframe
        ref={frameRef}
        className={clsx(styles.htmlFramePreview, preview && styles.htmlFramePreviewEditor)}
        title={template.name}
        sandbox=""
        srcDoc={srcDoc}
      />
      <div className={styles.htmlBodyPrint}>
        {safeCss ? <style>{safeCss}</style> : null}
        <div dangerouslySetInnerHTML={{ __html: html }} />
      </div>
    </div>
  );
}
