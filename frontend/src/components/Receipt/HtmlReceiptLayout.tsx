import { useEffect, useMemo, useRef } from "react";
import type { DocumentPrintContext } from "@/lib/receipt-print-context";
import { renderReceiptTemplate } from "@/lib/receipt-template-engine";
import { sanitizeReceiptCss } from "@/lib/receipt-template-utils";
import type { ReceiptTemplate } from "@/types/receipt-templates";
import styles from "./HtmlReceipt.module.css";

type Props = {
  template: ReceiptTemplate;
  context: DocumentPrintContext;
};

function buildSandboxedReceiptDocument(html: string, css: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${html}</body></html>`;
}

function resolveSafeCss(css: string): string {
  if (!css) return "";
  try {
    return sanitizeReceiptCss(css);
  } catch {
    return "";
  }
}

export function HtmlReceiptLayout({ template, context }: Props) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const { html, css } = renderReceiptTemplate(template, context);
  const safeCss = useMemo(() => resolveSafeCss(css), [css]);
  const srcDoc = useMemo(
    () => buildSandboxedReceiptDocument(html, safeCss),
    [html, safeCss],
  );

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;

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

    frame.addEventListener("load", resize);
    resize();

    return () => frame.removeEventListener("load", resize);
  }, [srcDoc]);

  return (
    <div className={styles.htmlReceipt}>
      <iframe
        ref={frameRef}
        className={styles.htmlFramePreview}
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
