import type { ReceiptFormat } from "@/types/receipt-templates";

type CaptureHandle = {
  element: HTMLElement;
  cleanup: () => void;
};

function prepareCaptureElement(source: HTMLElement): CaptureHandle {
  const clone = source.cloneNode(true) as HTMLElement;
  clone.querySelectorAll(".htmlFramePreview").forEach((node) => {
    (node as HTMLElement).style.display = "none";
  });
  clone.querySelectorAll(".htmlBodyPrint").forEach((node) => {
    (node as HTMLElement).style.display = "block";
  });

  const container = document.createElement("div");
  container.style.position = "fixed";
  container.style.left = "-10000px";
  container.style.top = "0";
  container.style.zIndex = "-1";
  container.style.background = "#fff";
  container.appendChild(clone);
  document.body.appendChild(container);

  return {
    element: clone,
    cleanup: () => container.remove(),
  };
}

export function buildReceiptFilename(documentCode: string): string {
  const safe = documentCode.replace(/[^\w.-]+/g, "_") || "receipt";
  const date = new Date().toISOString().slice(0, 10);
  return `receipt-${safe}-${date}.pdf`;
}

export async function generateReceiptPdfBlob(
  printRoot: HTMLElement,
  format: ReceiptFormat,
): Promise<Blob> {
  const { element, cleanup } = prepareCaptureElement(printRoot);
  try {
    const html2pdf = (await import("html2pdf.js")).default;
    const widthMm = format === "a4" ? 210 : 80;
    const margin = format === "a4" ? 10 : 2;
    const blob = await html2pdf()
      .set({
        margin,
        image: { type: "jpeg", quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true, logging: false },
        jsPDF: {
          unit: "mm",
          format: format === "a4" ? "a4" : [widthMm, 297],
          orientation: "portrait",
        },
        pagebreak: { mode: ["avoid-all", "css", "legacy"] },
      })
      .from(element)
      .output("blob");
    return blob as Blob;
  } finally {
    cleanup();
  }
}

export function downloadPdfBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function isMobileSharePlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return (
    /Android/i.test(ua) ||
    /iPhone|iPad|iPod/i.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

export function canSharePdfFile(file: File): boolean {
  if (typeof navigator.share !== "function") return false;
  if (typeof navigator.canShare !== "function") return true;
  try {
    return navigator.canShare({ files: [file] });
  } catch {
    return false;
  }
}

export async function sharePdfFile(file: File, title: string): Promise<void> {
  await navigator.share({ title, files: [file] });
}

export async function shareWebUrl(title: string, url: string): Promise<void> {
  await navigator.share({ title, url });
}

export type SharePdfResult = "file" | "unsupported";

export async function trySharePdfFile(file: File, title: string): Promise<SharePdfResult> {
  if (typeof navigator.share !== "function") return "unsupported";

  if (canSharePdfFile(file)) {
    await sharePdfFile(file, title);
    return "file";
  }

  if (isMobileSharePlatform()) {
    try {
      await sharePdfFile(file, title);
      return "file";
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw error;
    }
  }

  return "unsupported";
}
