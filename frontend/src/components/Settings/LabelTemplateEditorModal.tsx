import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/posui/Button";
import { Modal } from "@/components/posui/Modal";
import { useLanguage } from "@/contexts/LanguageContext";
import { fetchLabelSampleRow } from "@/lib/labels-api";
import { renderLabelPreviewDocument } from "@/lib/label-template-engine";
import { splitLabelDocument } from "@/lib/label-templates-api";
import { useAuth } from "@/store/auth";
import { LABEL_PLACEHOLDERS, type LabelFieldRow, type LabelTemplate } from "@/types/label-templates";
import { ReceiptTemplateLogosEditor } from "./ReceiptTemplateLogosEditor";
import styles from "./ReceiptTemplates.module.css";

type Props = {
  open: boolean;
  template: LabelTemplate | null;
  isNew: boolean;
  onClose: () => void;
  onSave: (template: LabelTemplate) => void;
};

type EditorTab = "html" | "css";

const MM_TO_PX = 96 / 25.4;

function draftFromTemplate(template: LabelTemplate): LabelTemplate {
  const draft: LabelTemplate = {
    ...template,
    css: template.css ?? "",
    logos: Array.isArray(template.logos) ? template.logos : [],
    paper: { ...template.paper },
  };
  if (!draft.css.trim()) {
    const split = splitLabelDocument(draft.html);
    if (split.css) {
      return { ...draft, html: split.html, css: split.css };
    }
  }
  return draft;
}

export function LabelTemplateEditorModal({ open, template, isNew, onClose, onSave }: Props) {
  const { t } = useLanguage();
  const token = useAuth((state) => state.accessToken);
  const [draft, setDraft] = useState<LabelTemplate | null>(null);
  const [editorTab, setEditorTab] = useState<EditorTab>("html");
  const [previewHtml, setPreviewHtml] = useState("");
  const [previewError, setPreviewError] = useState("");
  const [editorError, setEditorError] = useState("");
  const [sampleRow, setSampleRow] = useState<LabelFieldRow | null>(null);
  const [scale, setScale] = useState(1);
  const [contentBox, setContentBox] = useState({ width: 0, height: 0 });
  const [stageNode, setStageNode] = useState<HTMLDivElement | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    if (!open || !template) {
      setDraft(null);
      setPreviewHtml("");
      return;
    }
    setEditorTab("html");
    setEditorError("");
    setDraft(draftFromTemplate(template));
  }, [open, template]);

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
    if (!open || !draft || !sampleRow) return;
    try {
      setPreviewHtml(
        renderLabelPreviewDocument(
          {
            html: draft.html,
            css: draft.css,
            paper: {
              width_mm: Number(draft.paper.width_mm) || 58,
              height_mm: Number(draft.paper.height_mm) || 40,
            },
            logos: draft.logos ?? [],
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
  }, [draft, open, sampleRow, t]);

  const width = Number(draft?.paper.width_mm) || 58;
  const height = Number(draft?.paper.height_mm) || 40;

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
          const walker = doc.createTreeWalker(sheet, NodeFilter.SHOW_TEXT);
          let textNode = walker.nextNode();
          while (textNode) {
            if (textNode.textContent?.trim()) {
              const range = doc.createRange();
              range.selectNodeContents(textNode);
              const rect = range.getBoundingClientRect();
              contentWidth = Math.max(contentWidth, rect.right);
              contentHeight = Math.max(contentHeight, rect.bottom);
            }
            textNode = walker.nextNode();
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

  if (!open || !draft) return null;

  const paperWidth = contentBox.width || width * MM_TO_PX;
  const paperHeight = contentBox.height || height * MM_TO_PX;

  return (
    <Modal
      open
      fullscreen
      bodyClassName={styles.editorModalBody}
      title={
        isNew
          ? t("settings.labelTemplates.editor.titleNew", "New label template")
          : t("settings.labelTemplates.editor.titleEdit", "Edit label template")
      }
      onClose={onClose}
      headerActions={
        <Button
          type="button"
          onClick={() => {
            if (!draft.name.trim() || !draft.html.trim()) return;
            onSave({
              ...draft,
              name: draft.name.trim(),
              css: draft.css,
              logos: draft.logos ?? [],
              paper: {
                width_mm: width,
                height_mm: height,
              },
            });
          }}
        >
          {t("settings.labelTemplates.editor.save", "Save template")}
        </Button>
      }
    >
      <div className={`${styles.editorLayout} ${styles.labelEditorLayout}`}>
        <div className={`${styles.editorForm} ${styles.labelEditorForm}`}>
          {editorError ? <p className={styles.templateMeta}>{editorError}</p> : null}
          <label className={styles.field}>
            <span className={styles.label}>{t("settings.labelTemplates.editor.name", "Name")}</span>
            <input
              className={styles.input}
              value={draft.name}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            />
          </label>
          <div className={styles.sizeRow}>
            <label className={styles.field}>
              <span className={styles.label}>
                {t("settings.labelTemplates.editor.width", "Width (mm)")}
              </span>
              <input
                className={styles.input}
                type="number"
                min={1}
                max={500}
                value={draft.paper.width_mm}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    paper: { ...draft.paper, width_mm: Number(event.target.value) },
                  })
                }
              />
            </label>
            <label className={styles.field}>
              <span className={styles.label}>
                {t("settings.labelTemplates.editor.height", "Height (mm)")}
              </span>
              <input
                className={styles.input}
                type="number"
                min={1}
                max={500}
                value={draft.paper.height_mm}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    paper: { ...draft.paper, height_mm: Number(event.target.value) },
                  })
                }
              />
            </label>
          </div>
          <div className={styles.editorTabs}>
            <button
              type="button"
              className={`${styles.editorTab} ${editorTab === "html" ? styles.editorTabActive : ""}`}
              onClick={() => setEditorTab("html")}
            >
              {t("settings.labelTemplates.editor.tabHtml", "HTML")}
            </button>
            <button
              type="button"
              className={`${styles.editorTab} ${editorTab === "css" ? styles.editorTabActive : ""}`}
              onClick={() => setEditorTab("css")}
            >
              {t("settings.labelTemplates.editor.tabCss", "CSS")}
            </button>
          </div>
          <label className={styles.labelCodeField}>
            <span className={styles.label}>
              {editorTab === "html"
                ? t("settings.labelTemplates.editor.html", "HTML")
                : t("settings.labelTemplates.editor.css", "CSS")}
            </span>
            <textarea
              className={`${styles.textarea} ${styles.codeArea} ${styles.labelCodeArea}`}
              value={editorTab === "html" ? draft.html : draft.css}
              onChange={(event) =>
                setDraft(
                  editorTab === "html"
                    ? { ...draft, html: event.target.value }
                    : { ...draft, css: event.target.value },
                )
              }
            />
          </label>
          <ReceiptTemplateLogosEditor
            logos={draft.logos ?? []}
            onChange={(logos) => {
              setEditorError("");
              setDraft({ ...draft, logos });
            }}
            onError={(message) => setEditorError(message)}
          />
          <div className={styles.field}>
            <span className={styles.label}>
              {t("settings.labelTemplates.editor.placeholders", "Placeholders")}
            </span>
            <p className={styles.templateMeta}>
              {LABEL_PLACEHOLDERS.map((name) => `{{ ${name} }}`).join("  ")}
            </p>
            <span className={styles.label}>
              {t("settings.labelTemplates.editor.helpers", "Helpers")}
            </span>
            <p className={styles.templateMeta}>
              {
                '{{formatNumber price}}  {{numberPart price 0 3}}  {{numberPart price -3}}  {{logoImg "Name"}}'
              }
            </p>
          </div>
        </div>
        <div className={styles.previewPane}>
          <div className={styles.previewTitle}>
            {t("settings.labelTemplates.editor.preview", "Preview")}
          </div>
          {previewError ? <p className={styles.templateMeta}>{previewError}</p> : null}
          <div ref={setStageNode} className={styles.labelPreviewStage}>
            <div
              className={styles.labelPreviewFrame}
              style={{ width: paperWidth * scale, height: paperHeight * scale }}
            >
              <iframe
                ref={iframeRef}
                title={t("settings.labelTemplates.editor.preview", "Preview")}
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
      </div>
    </Modal>
  );
}
