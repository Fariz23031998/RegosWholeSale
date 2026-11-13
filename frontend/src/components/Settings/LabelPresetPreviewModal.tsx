import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/posui/Button";
import { Modal } from "@/components/posui/Modal";
import { useLanguage } from "@/contexts/LanguageContext";
import { fetchLabelSampleRow } from "@/lib/labels-api";
import { renderLabelPreviewDocument } from "@/lib/label-template-engine";
import { useAuth } from "@/store/auth";
import type { LabelPreset } from "@/templates/labels";
import type { LabelFieldRow } from "@/types/label-templates";
import styles from "./ReceiptTemplates.module.css";

type Props = {
  open: boolean;
  preset: LabelPreset | null;
  onClose: () => void;
};

const MM_TO_PX = 96 / 25.4;

export function LabelPresetPreviewModal({ open, preset, onClose }: Props) {
  const { t } = useLanguage();
  const token = useAuth((state) => state.accessToken);
  const [previewHtml, setPreviewHtml] = useState("");
  const [previewError, setPreviewError] = useState("");
  const [sampleRow, setSampleRow] = useState<LabelFieldRow | null>(null);
  const [scale, setScale] = useState(1);
  const [contentBox, setContentBox] = useState({ width: 0, height: 0 });
  const [stageNode, setStageNode] = useState<HTMLDivElement | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  const width = Number(preset?.paper.width_mm) || 58;
  const height = Number(preset?.paper.height_mm) || 40;

  useEffect(() => {
    if (!open || !token) return;
    let cancelled = false;
    void fetchLabelSampleRow(token)
      .then((response) => {
        if (!cancelled) setSampleRow(response.row);
      })
      .catch(() => {
        if (cancelled) return;
        setSampleRow(null);
        setPreviewHtml("");
        setPreviewError(
          t("settings.labelTemplates.editor.previewFailed", "Preview is not available for this HTML."),
        );
      });
    return () => {
      cancelled = true;
    };
  }, [open, t, token]);

  useEffect(() => {
    if (!open || !preset || !sampleRow) return;
    try {
      setPreviewHtml(
        renderLabelPreviewDocument(
          {
            html: preset.html,
            css: preset.css,
            paper: {
              width_mm: width,
              height_mm: height,
            },
            logos: preset.logos ?? [],
          },
          sampleRow,
        ),
      );
      setPreviewError("");
    } catch {
      setPreviewHtml("");
      setPreviewError(
        t("settings.labelTemplates.editor.previewFailed", "Preview is not available for this HTML."),
      );
    }
  }, [height, open, preset, sampleRow, t, width]);

  useEffect(() => {
    if (!open || !stageNode) return;
    const frame = iframeRef.current;
    let documentObserver: ResizeObserver | undefined;
    let measuring = false;

    const fit = () => {
      if (measuring) return;
      const availableWidth = stageNode.clientWidth;
      const availableHeight = stageNode.clientHeight;
      const paperWidth = width * MM_TO_PX;
      const paperHeight = height * MM_TO_PX;
      if (!paperWidth || !paperHeight || !availableWidth || !availableHeight) return;

      let contentWidth = paperWidth;
      let contentHeight = paperHeight;
      const doc = frame?.contentDocument;
      if (doc?.documentElement && frame) {
        measuring = true;
        const previousWidth = frame.style.width;
        const previousHeight = frame.style.height;
        frame.style.width = `${paperWidth}px`;
        frame.style.height = `${paperHeight}px`;
        const root = doc.documentElement;
        const sheet = doc.querySelector(".label-sheet") ?? doc.body;
        contentWidth = Math.max(paperWidth, root.scrollWidth, doc.body?.scrollWidth ?? 0);
        contentHeight = Math.max(paperHeight, root.scrollHeight, doc.body?.scrollHeight ?? 0);
        if (sheet) {
          const nodes = sheet.querySelectorAll("*");
          for (const node of nodes) {
            if (!(node instanceof HTMLElement)) continue;
            const rect = node.getBoundingClientRect();
            contentWidth = Math.max(contentWidth, rect.left + node.scrollWidth, rect.right);
            contentHeight = Math.max(contentHeight, rect.top + node.scrollHeight, rect.bottom);
          }
        }
        contentWidth += 4;
        contentHeight += 4;
        frame.style.width = previousWidth;
        frame.style.height = previousHeight;
        measuring = false;
      }

      const nextScale = Math.min(
        Math.max(availableWidth - 2, 0) / contentWidth,
        Math.max(availableHeight - 2, 0) / contentHeight,
      );
      if (!Number.isFinite(nextScale) || nextScale <= 0) return;
      setContentBox((current) =>
        Math.abs(current.width - contentWidth) < 0.5 && Math.abs(current.height - contentHeight) < 0.5
          ? current
          : { width: contentWidth, height: contentHeight },
      );
      setScale((current) => (Math.abs(current - nextScale) < 0.001 ? current : nextScale));
    };

    const watchDocument = () => {
      documentObserver?.disconnect();
      const body = frame?.contentDocument?.body;
      if (!body) return;
      documentObserver = new ResizeObserver(fit);
      documentObserver.observe(body);
      fit();
    };

    fit();
    const stageObserver = new ResizeObserver(fit);
    stageObserver.observe(stageNode);
    frame?.addEventListener("load", watchDocument);
    watchDocument();
    window.addEventListener("resize", fit);
    return () => {
      stageObserver.disconnect();
      documentObserver?.disconnect();
      frame?.removeEventListener("load", watchDocument);
      window.removeEventListener("resize", fit);
    };
  }, [height, open, previewHtml, stageNode, width]);

  if (!open || !preset) return null;

  const paperWidth = contentBox.width || width * MM_TO_PX;
  const paperHeight = contentBox.height || height * MM_TO_PX;

  return (
    <Modal
      open
      title={t("settings.labelTemplates.previewTitle", "Sample template preview")}
      onClose={onClose}
      headerActions={
        <Button type="button" variant="secondary" onClick={onClose}>
          {t("settings.labelTemplates.previewClose", "Close")}
        </Button>
      }
    >
      <div className={styles.previewPane} style={{ minHeight: 320 }}>
        <div className={styles.previewTitle}>
          {preset.name} · {preset.paper.width_mm}×{preset.paper.height_mm} mm
        </div>
        {previewError ? <p className={styles.templateMeta}>{previewError}</p> : null}
        <div ref={setStageNode} className={styles.labelPreviewStage} style={{ minHeight: 260 }}>
          <div
            className={styles.labelPreviewFrame}
            style={{ width: paperWidth * scale, height: paperHeight * scale }}
          >
            <iframe
              ref={iframeRef}
              title={t("settings.labelTemplates.previewTitle", "Sample template preview")}
              scrolling="no"
              srcDoc={previewHtml}
              style={{
                width: paperWidth,
                height: paperHeight,
                transform: `scale(${scale})`,
              }}
            />
          </div>
        </div>
      </div>
    </Modal>
  );
}
