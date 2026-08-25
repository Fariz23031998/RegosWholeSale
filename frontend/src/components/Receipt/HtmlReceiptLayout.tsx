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
  /** When true, preview stretches to fill a tall editor pane. Keep false in print modals. */
  previewFill?: boolean;
};

function buildSandboxedReceiptDocument(html: string, css: string, preview: boolean): string {
  const previewCss = preview
    ? "html,body{margin:0;padding:0;overflow-x:hidden;background:#fff;}"
    : "";
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${previewCss}${css}</style></head><body>${html}</body></html>`;
}

function measureFrameContentHeight(doc: Document): number {
  const body = doc.body;
  const html = doc.documentElement;
  if (!body || !html) return 0;

  let bottom = 0;
  for (const child of body.children) {
    if (!(child instanceof HTMLElement)) continue;
    bottom = Math.max(bottom, child.offsetTop + child.offsetHeight);
  }

  if (bottom > 0) {
    const bodyStyle = doc.defaultView?.getComputedStyle(body);
    const paddingBottom = parseFloat(bodyStyle?.paddingBottom ?? "0") || 0;
    return Math.ceil(bottom + paddingBottom);
  }

  return Math.ceil(body.scrollHeight);
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

export function HtmlReceiptLayout({
  template,
  context,
  preview = false,
  previewFill = false,
}: Props) {
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
    if (error || !previewFill) return;

    const frame = frameRef.current;
    if (!frame) return;

    let observer: ResizeObserver | undefined;

    const resize = () => {
      const doc = frame.contentDocument;
      if (!doc) return;

      // Collapse before measuring so scrollHeight is not inflated by the iframe viewport.
      const previousHeight = frame.style.height;
      frame.style.height = "0px";
      const height = measureFrameContentHeight(doc);
      frame.style.height = height > 0 ? `${height}px` : previousHeight;
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
  }, [error, previewFill, srcDoc]);

  const previewPane = preview && !previewFill;

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
    <div
      className={clsx(
        styles.htmlReceipt,
        preview && styles.htmlReceiptPreview,
        previewPane && styles.htmlReceiptPreviewPane,
        previewFill && styles.htmlReceiptPreviewFill,
      )}
    >
      <iframe
        ref={frameRef}
        data-receipt-preview
        className={clsx(
          styles.htmlFramePreview,
          previewPane && styles.htmlFramePreviewPane,
          previewFill && styles.htmlFramePreviewFill,
        )}
        title={template.name}
        sandbox=""
        scrolling={previewPane || previewFill ? "auto" : "no"}
        srcDoc={srcDoc}
      />
      <div data-receipt-print-body className={styles.htmlBodyPrint}>
        {safeCss ? <style>{safeCss}</style> : null}
        <div dangerouslySetInnerHTML={{ __html: html }} />
      </div>
    </div>
  );
}
