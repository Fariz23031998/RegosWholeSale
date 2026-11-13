import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import GjsEditor from "@grapesjs/react";
import type { Editor, EditorConfig } from "grapesjs";
import grapesjs from "grapesjs";
import "grapesjs/dist/css/grapes.min.css";
import { Button } from "@/components/posui/Button";
import { useLanguage } from "@/contexts/LanguageContext";
import { wrapLabelHtml } from "@/templates/labels/types";
import { LABEL_PLACEHOLDERS } from "@/types/label-templates";
import styles from "./ReceiptTemplates.module.css";

const MM_TO_PX = 96 / 25.4;
const ZOOM_MIN = 25;
const ZOOM_MAX = 800;
const ZOOM_STEP = 25;
const ZOOM_DEFAULT = 100;

function clampZoom(value: number): number {
  if (!Number.isFinite(value)) return ZOOM_DEFAULT;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(value)));
}

type Props = {
  html: string;
  css: string;
  widthMm: number;
  heightMm: number;
  onChange: (next: { html: string; css: string }) => void;
};

function extractBodyInner(html: string): string {
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  if (bodyMatch) return bodyMatch[1].trim();
  return html
    .replace(/<!DOCTYPE[^>]*>/i, "")
    .replace(/<\/?html[^>]*>/gi, "")
    .replace(/<head[\s\S]*?<\/head>/gi, "")
    .trim();
}

function registerLabelBlocks(editor: Editor) {
  const bm = editor.BlockManager;
  const category = "Label";

  bm.add("label-root", {
    label: "Label root",
    category,
    content: `<div class="label">
  <div class="name">{{ name }}</div>
  <div class="price">{{formatNumber price}} <span class="currency">{{ currency }}</span></div>
  <div class="barcode-wrap">
    <img class="barcode" src="{{ barcode_src }}" alt="" />
    <div class="code">{{ barcode }}</div>
  </div>
</div>`,
  });

  bm.add("label-name", {
    label: "Name row",
    category,
    content: `<div class="name">{{ name }}</div>`,
  });

  bm.add("label-price", {
    label: "Price row",
    category,
    content: `<div class="price">{{formatNumber price}} <span class="currency">{{ currency }}</span></div>`,
  });

  bm.add("label-barcode-wrap", {
    label: "Barcode wrap",
    category,
    content: `<div class="barcode-wrap">
  <img class="barcode" src="{{ barcode_src }}" alt="" />
  <div class="code">{{ barcode }}</div>
</div>`,
  });

  bm.add("label-barcode-img", {
    label: "Barcode image",
    category,
    content: `<img class="barcode" src="{{ barcode_src }}" alt="" />`,
  });

  bm.add("label-qr-img", {
    label: "QR image",
    category,
    content: `<img class="qr" src="{{ qr_src }}" alt="" />`,
  });

  bm.add("label-product-img", {
    label: "Product image",
    category,
    content: `<img class="product-image" src="{{ image_src }}" alt="" />`,
  });

  bm.add("label-format-number", {
    label: "formatNumber price",
    category,
    content: `<span>{{formatNumber price}}</span>`,
  });

  bm.add("label-logo-img", {
    label: "logoImg",
    category,
    content: `<div>{{logoImg "Name"}}</div>`,
  });

  for (const name of LABEL_PLACEHOLDERS) {
    if (name.endsWith("_src")) continue;
    bm.add(`label-ph-${name}`, {
      label: `{{ ${name} }}`,
      category,
      content: `<span>{{ ${name} }}</span>`,
    });
  }
}

export function LabelGrapesEditor({ html, css, widthMm, heightMm, onChange }: Props) {
  const { t } = useLanguage();
  const editorRef = useRef<Editor | null>(null);
  const exportingRef = useRef(false);
  const centeringRef = useRef(false);
  const canvasResizeCleanupRef = useRef<(() => void) | null>(null);
  const scheduleCenterRef = useRef<(editor: Editor, nextZoom?: number) => void>(() => {});
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const [zoom, setZoom] = useState(ZOOM_DEFAULT);

  const widthPx = Math.max(1, Math.round(widthMm * MM_TO_PX));
  const heightPx = Math.max(1, Math.round(heightMm * MM_TO_PX));

  const initialComponents = useMemo(() => extractBodyInner(html), [html]);
  const initialStyles = useMemo(() => css ?? "", [css]);

  const options = useMemo<EditorConfig>(
    () => ({
      height: "100%",
      width: "auto",
      storageManager: false,
      fromElement: false,
      noticeOnUnload: false,
      canvas: {
        styles: [],
        // Needed so Canvas.setZoom can scale past 100% and the label looks bigger.
        infiniteCanvas: true,
      },
      deviceManager: {
        devices: [
          {
            id: "label",
            name: "Label",
            width: `${widthPx}px`,
            height: `${heightPx}px`,
            widthMedia: "",
          },
        ],
      },
      components: initialComponents,
      style: initialStyles,
    }),
    // Mount once per editor instance; parent remounts via key when entering Visual.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  /** Zoom and always keep the label frame centered in the canvas. */
  const centerAtZoom = useCallback((editor: Editor, nextZoom?: number) => {
    if (centeringRef.current) return;
    centeringRef.current = true;
    try {
      const value =
        nextZoom === undefined ? clampZoom(editor.Canvas.getZoom()) : clampZoom(nextZoom);
      editor.Canvas.fitViewport({ gap: 48, zoom: value });
      const applied = clampZoom(editor.Canvas.getZoom());
      setZoom(applied);
      editor.Canvas.refresh();
    } catch {
      const value =
        nextZoom === undefined ? clampZoom(editor.Canvas.getZoom()) : clampZoom(nextZoom);
      editor.Canvas.setZoom(value);
      editor.Canvas.setCoords(0, 0);
      setZoom(value);
    } finally {
      centeringRef.current = false;
    }
  }, []);

  const applyZoom = useCallback(
    (next: number) => {
      const editor = editorRef.current;
      if (!editor) {
        setZoom(clampZoom(next));
        return;
      }
      centerAtZoom(editor, next);
    },
    [centerAtZoom],
  );

  const fitLabelInView = useCallback(
    (editor: Editor) => {
      if (centeringRef.current) return;
      centeringRef.current = true;
      try {
        editor.Canvas.fitViewport({ gap: 48 });
        setZoom(clampZoom(editor.Canvas.getZoom()));
        editor.Canvas.refresh();
      } catch {
        const canvasWidth = editor.Canvas.getElement().clientWidth || 0;
        const fitted =
          canvasWidth > 0 && widthPx > 0
            ? clampZoom(Math.floor((canvasWidth * 0.7 * 100) / widthPx))
            : 200;
        editor.Canvas.setZoom(fitted);
        editor.Canvas.setCoords(0, 0);
        setZoom(fitted);
      } finally {
        centeringRef.current = false;
      }
    },
    [widthPx],
  );

  const exportDraft = useCallback((editor: Editor) => {
    if (exportingRef.current) return;
    exportingRef.current = true;
    try {
      const bodyHtml = editor.getHtml() || "";
      const sheet = editor.getCss() || "";
      onChangeRef.current({
        html: wrapLabelHtml(bodyHtml),
        css: sheet.trim(),
      });
    } finally {
      exportingRef.current = false;
    }
  }, []);

  /** Wait for layout (e.g. fullscreen transition) then keep label centered. */
  const scheduleCenter = useCallback(
    (editor: Editor, nextZoom?: number) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (nextZoom === undefined) centerAtZoom(editor);
          else centerAtZoom(editor, nextZoom);
        });
      });
    },
    [centerAtZoom],
  );
  scheduleCenterRef.current = scheduleCenter;

  const onEditor = useCallback(
    (editor: Editor) => {
      editorRef.current = editor;
      registerLabelBlocks(editor);
      editor.setDevice("label");

      const push = () => exportDraft(editor);
      editor.on("update", push);
      editor.on("style:change", push);
      editor.on("component:update", push);
      editor.on("component:add", push);
      editor.on("component:remove", push);
      // Wheel / pinch zoom can pan the frame away; snap it back to center
      // (including while GrapesJS fullscreen is active).
      editor.on("canvas:zoom", () => {
        if (centeringRef.current) {
          setZoom(clampZoom(editor.Canvas.getZoom()));
          return;
        }
        centerAtZoom(editor);
      });

      const onFullscreenCommand = () => scheduleCenterRef.current(editor);
      editor.on("command:run:core:fullscreen", onFullscreenCommand);
      editor.on("command:run:fullscreen", onFullscreenCommand);
      editor.on("command:stop:core:fullscreen", onFullscreenCommand);
      editor.on("command:stop:fullscreen", onFullscreenCommand);
    },
    [centerAtZoom, exportDraft],
  );

  const onReady = useCallback(
    (editor: Editor) => {
      editorRef.current = editor;
      canvasResizeCleanupRef.current?.();
      canvasResizeCleanupRef.current = null;

      const canvasEl = editor.Canvas.getElement();
      if (canvasEl && typeof ResizeObserver !== "undefined") {
        let timer = 0;
        const observer = new ResizeObserver(() => {
          window.clearTimeout(timer);
          timer = window.setTimeout(() => {
            if (!editorRef.current || centeringRef.current) return;
            // Fullscreen / panel resize changes canvas size — re-center the label.
            scheduleCenterRef.current(editorRef.current);
          }, 80);
        });
        observer.observe(canvasEl);
        canvasResizeCleanupRef.current = () => {
          window.clearTimeout(timer);
          observer.disconnect();
        };
      }

      // Defer until frames have layout so fitViewport can enlarge the tiny mm label.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => fitLabelInView(editor));
      });
    },
    [fitLabelInView],
  );

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const device = editor.Devices.get("label");
    if (device) {
      device.set({ width: `${widthPx}px`, height: `${heightPx}px` });
      editor.setDevice("label");
      scheduleCenter(editor);
    }
  }, [heightPx, scheduleCenter, widthPx]);

  useEffect(() => {
    const onFullscreenChange = () => {
      const editor = editorRef.current;
      if (!editor) return;
      // Browser applies fullscreen size after the event; recenter once layout settles.
      scheduleCenterRef.current(editor);
      window.setTimeout(() => scheduleCenterRef.current(editor), 120);
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    document.addEventListener("webkitfullscreenchange", onFullscreenChange as EventListener);
    return () => {
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      document.removeEventListener("webkitfullscreenchange", onFullscreenChange as EventListener);
      canvasResizeCleanupRef.current?.();
      canvasResizeCleanupRef.current = null;
      editorRef.current = null;
    };
  }, []);

  return (
    <div className={styles.labelGrapesHost}>
      <div className={styles.labelGrapesZoomBar} role="toolbar" aria-label={t("settings.labelTemplates.editor.zoom", "Zoom")}>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={zoom <= ZOOM_MIN}
          onClick={() => applyZoom(zoom - ZOOM_STEP)}
        >
          {t("settings.labelTemplates.editor.zoomOut", "Zoom out")}
        </Button>
        <span className={styles.labelGrapesZoomValue}>{zoom}%</span>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={zoom >= ZOOM_MAX}
          onClick={() => applyZoom(zoom + ZOOM_STEP)}
        >
          {t("settings.labelTemplates.editor.zoomIn", "Zoom in")}
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => {
            const editor = editorRef.current;
            if (editor) fitLabelInView(editor);
            else applyZoom(ZOOM_DEFAULT);
          }}
        >
          {t("settings.labelTemplates.editor.zoomFit", "Fit")}
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={zoom === ZOOM_DEFAULT}
          onClick={() => applyZoom(ZOOM_DEFAULT)}
        >
          {t("settings.labelTemplates.editor.zoomReset", "100%")}
        </Button>
      </div>
      <GjsEditor
        grapesjs={grapesjs}
        options={options}
        onEditor={onEditor}
        onReady={onReady}
        className={styles.labelGrapesEditor}
      />
    </div>
  );
}
