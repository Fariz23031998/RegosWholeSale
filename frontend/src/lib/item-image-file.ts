const ALLOWED_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/gif",
  "image/webp",
]);

/**
 * Regos ItemImage/Save requires BOTH width and height >= 900 px
 * (runtime-verified: 899x899 / 800x800 / 500x400 → error 1015; 900x900+ → ok).
 * Official Regos app prepares a fixed 900×900 square with white letterbox.
 */
export const REGOS_ITEM_IMAGE_SIZE_PX = 900;

/** @deprecated Use REGOS_ITEM_IMAGE_SIZE_PX; kept for older imports. */
export const REGOS_ITEM_IMAGE_MAX_EDGE_PX = REGOS_ITEM_IMAGE_SIZE_PX;

/** Soft max encoded JPEG size (official samples are typically well under this). */
export const REGOS_ITEM_IMAGE_MAX_BYTES = 500 * 1024;

/** Soft ceiling on the picked file before decode (avoids browser OOM). */
export const MAX_ITEM_IMAGE_INPUT_BYTES = 20 * 1024 * 1024;

/** @deprecated Prefer REGOS_ITEM_IMAGE_MAX_BYTES; kept for callers expecting the old name. */
export const MAX_ITEM_IMAGE_BYTES = REGOS_ITEM_IMAGE_MAX_BYTES;

const JPEG_MIME = "image/jpeg";
const JPEG_QUALITY_START = 0.92;
const JPEG_QUALITY_MIN = 0.55;
const JPEG_QUALITY_STEP = 0.08;

export type ItemImageFilePayload = {
  /** Raw base64 without data-URL prefix (Regos ItemImage/Save). */
  base64: string;
  /** Object URL or data URL for local preview. */
  previewUrl: string;
  fileName: string;
};

export type FitSize = {
  width: number;
  height: number;
};

/** Scale so the image fits inside a square of `edge` px (letterbox). */
export function computeFitSize(
  width: number,
  height: number,
  edge: number,
): FitSize {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const box = Math.max(1, Math.round(edge));
  const scale = Math.min(box / w, box / h);
  return {
    width: Math.max(1, Math.round(w * scale)),
    height: Math.max(1, Math.round(h * scale)),
  };
}

function stripDataUrlPrefix(dataUrl: string): string {
  const comma = dataUrl.indexOf(",");
  const raw = comma < 0 ? dataUrl : dataUrl.slice(comma + 1);
  // Regos rejects padded/wrapped base64 bodies (error 1015).
  return raw.replace(/\s+/g, "");
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = typeof reader.result === "string" ? reader.result.trim() : "";
      if (!dataUrl.startsWith("data:")) {
        reject(new Error("Failed to encode image."));
        return;
      }
      resolve(dataUrl);
    };
    reader.onerror = () => reject(new Error("Failed to encode image."));
    reader.readAsDataURL(blob);
  });
}

function loadImageElement(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to read image file."));
    };
    img.src = url;
  });
}

function canvasToJpegBlob(
  canvas: HTMLCanvasElement,
  quality: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("Failed to encode image."));
          return;
        }
        resolve(blob);
      },
      JPEG_MIME,
      quality,
    );
  });
}

/** Official Regos prep: fixed square canvas, white fill, image fitted inside. */
function drawRegosSquare(
  source: CanvasImageSource,
  naturalWidth: number,
  naturalHeight: number,
  edge: number = REGOS_ITEM_IMAGE_SIZE_PX,
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = edge;
  canvas.height = edge;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Failed to process image.");
  }
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, edge, edge);
  const { width, height } = computeFitSize(naturalWidth, naturalHeight, edge);
  const x = Math.floor((edge - width) / 2);
  const y = Math.floor((edge - height) / 2);
  ctx.drawImage(source, x, y, width, height);
  return canvas;
}

async function encodeRegosSquareJpeg(
  source: CanvasImageSource,
  naturalWidth: number,
  naturalHeight: number,
): Promise<Blob> {
  const canvas = drawRegosSquare(source, naturalWidth, naturalHeight);

  for (
    let quality = JPEG_QUALITY_START;
    quality >= JPEG_QUALITY_MIN - 1e-9;
    quality -= JPEG_QUALITY_STEP
  ) {
    const blob = await canvasToJpegBlob(canvas, Math.max(JPEG_QUALITY_MIN, quality));
    if (blob.size <= REGOS_ITEM_IMAGE_MAX_BYTES) {
      return blob;
    }
  }

  const blob = await canvasToJpegBlob(canvas, JPEG_QUALITY_MIN);
  if (blob.size <= REGOS_ITEM_IMAGE_MAX_BYTES) {
    return blob;
  }
  throw new Error("Image could not be compressed to Regos size limits (500 KB).");
}

function adjustedFileName(originalName: string): string {
  const base = originalName.replace(/\.[^.]+$/, "").trim() || "image";
  return `${base}.jpg`;
}

export async function readItemImageFile(file: File): Promise<ItemImageFilePayload> {
  if (!ALLOWED_MIME_TYPES.has(file.type)) {
    throw new Error("Only PNG, JPEG, GIF, and WebP images are allowed.");
  }
  if (file.size > MAX_ITEM_IMAGE_INPUT_BYTES) {
    throw new Error(
      `Image must be ${Math.round(MAX_ITEM_IMAGE_INPUT_BYTES / (1024 * 1024))} MB or smaller.`,
    );
  }

  const img = await loadImageElement(file);
  const naturalWidth = img.naturalWidth || img.width;
  const naturalHeight = img.naturalHeight || img.height;
  if (!naturalWidth || !naturalHeight) {
    throw new Error("Failed to read image file.");
  }

  // Always re-encode to a 900×900 RGB JPEG (Regos official prep size).
  const blob = await encodeRegosSquareJpeg(img, naturalWidth, naturalHeight);
  const dataUrl = await blobToDataUrl(blob);
  const base64 = stripDataUrlPrefix(dataUrl);
  if (!base64) {
    throw new Error("Failed to encode image.");
  }

  return {
    base64,
    previewUrl: dataUrl,
    fileName: adjustedFileName(file.name),
  };
}
