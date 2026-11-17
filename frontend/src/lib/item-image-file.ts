const ALLOWED_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/gif",
  "image/webp",
]);

/** Regos catalog image: max width or height (px). */
export const REGOS_ITEM_IMAGE_MAX_EDGE_PX = 2000;

/** Regos catalog image: max file size after encode. */
export const REGOS_ITEM_IMAGE_MAX_BYTES = 1024 * 1024;

/** Soft ceiling on the picked file before decode (avoids browser OOM). */
export const MAX_ITEM_IMAGE_INPUT_BYTES = 20 * 1024 * 1024;

/** @deprecated Prefer REGOS_ITEM_IMAGE_MAX_BYTES; kept for callers expecting the old name. */
export const MAX_ITEM_IMAGE_BYTES = REGOS_ITEM_IMAGE_MAX_BYTES;

const JPEG_MIME = "image/jpeg";
const JPEG_QUALITY_START = 0.92;
const JPEG_QUALITY_MIN = 0.5;
const JPEG_QUALITY_STEP = 0.08;
const EDGE_SHRINK_FACTOR = 0.9;
const EDGE_FLOOR_PX = 800;

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

/** Scale so the longest edge is at most `maxEdge`, preserving aspect ratio. */
export function computeFitSize(
  width: number,
  height: number,
  maxEdge: number,
): FitSize {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const edge = Math.max(1, Math.round(maxEdge));
  const longest = Math.max(w, h);
  if (longest <= edge) {
    return { width: w, height: h };
  }
  const scale = edge / longest;
  return {
    width: Math.max(1, Math.round(w * scale)),
    height: Math.max(1, Math.round(h * scale)),
  };
}

function stripDataUrlPrefix(dataUrl: string): string {
  const comma = dataUrl.indexOf(",");
  if (comma < 0) return dataUrl.trim();
  return dataUrl.slice(comma + 1).trim();
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

function drawScaled(
  source: CanvasImageSource,
  width: number,
  height: number,
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Failed to process image.");
  }
  // White background so transparent PNG/WebP/GIF don't become black JPEG.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(source, 0, 0, width, height);
  return canvas;
}

async function encodeWithinRegosLimits(
  source: CanvasImageSource,
  naturalWidth: number,
  naturalHeight: number,
): Promise<Blob> {
  let maxEdge = Math.min(
    REGOS_ITEM_IMAGE_MAX_EDGE_PX,
    Math.max(naturalWidth, naturalHeight),
  );

  while (maxEdge >= EDGE_FLOOR_PX) {
    const { width, height } = computeFitSize(naturalWidth, naturalHeight, maxEdge);
    const canvas = drawScaled(source, width, height);

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

    const nextEdge = Math.floor(maxEdge * EDGE_SHRINK_FACTOR);
    if (nextEdge >= maxEdge) break;
    maxEdge = nextEdge;
  }

  // Final attempt at the floor edge with minimum quality.
  const { width, height } = computeFitSize(
    naturalWidth,
    naturalHeight,
    Math.min(EDGE_FLOOR_PX, REGOS_ITEM_IMAGE_MAX_EDGE_PX),
  );
  const canvas = drawScaled(source, width, height);
  const blob = await canvasToJpegBlob(canvas, JPEG_QUALITY_MIN);
  if (blob.size <= REGOS_ITEM_IMAGE_MAX_BYTES) {
    return blob;
  }
  throw new Error("Image could not be compressed to Regos size limits (1024 KB).");
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

  const alreadyFits =
    Math.max(naturalWidth, naturalHeight) <= REGOS_ITEM_IMAGE_MAX_EDGE_PX
    && file.size <= REGOS_ITEM_IMAGE_MAX_BYTES
    && (file.type === "image/jpeg" || file.type === "image/jpg");

  if (alreadyFits) {
    const dataUrl = await blobToDataUrl(file);
    const base64 = stripDataUrlPrefix(dataUrl);
    if (!base64) {
      throw new Error("Failed to read image file.");
    }
    return {
      base64,
      previewUrl: dataUrl,
      fileName: file.name,
    };
  }

  const blob = await encodeWithinRegosLimits(img, naturalWidth, naturalHeight);
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
