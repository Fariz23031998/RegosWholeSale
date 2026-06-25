import type { ReceiptTemplateLogo } from "@/types/receipt-templates";

export const MAX_RECEIPT_TEMPLATE_LOGOS = 10;
export const MAX_RECEIPT_LOGO_BYTES = 200_000;
export const RECEIPT_LOGO_ACCEPT = "image/png,image/jpeg,image/gif,image/webp,image/svg+xml";

const ALLOWED_LOGO_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/svg+xml",
]);

const LOGO_DATA_URL_PATTERN =
  /^data:image\/(?:png|jpe?g|gif|webp|svg\+xml)(?:;charset=utf-8)?;base64,[a-z0-9+/=\s]+$/i;

const LOGO_SVG_DATA_URL_PATTERN =
  /^data:image\/svg\+xml(?:;charset=utf-8)?,(?:[a-z0-9%+/=\s]|%[0-9a-f]{2})+$/i;

export function isValidReceiptLogoDataUrl(src: string): boolean {
  const trimmed = src.trim();
  if (!trimmed.startsWith("data:image/")) return false;
  if (LOGO_DATA_URL_PATTERN.test(trimmed)) return true;
  if (LOGO_SVG_DATA_URL_PATTERN.test(trimmed)) return true;
  return false;
}

export function normalizeReceiptTemplateLogo(raw: unknown): ReceiptTemplateLogo | null {
  if (!raw || typeof raw !== "object") return null;
  const data = raw as Partial<ReceiptTemplateLogo>;
  const src = typeof data.src === "string" ? data.src.trim() : "";
  if (!src || !isValidReceiptLogoDataUrl(src)) return null;

  const byteLength = new TextEncoder().encode(src).length;
  if (byteLength > MAX_RECEIPT_LOGO_BYTES) return null;

  const name = typeof data.name === "string" && data.name.trim() ? data.name.trim() : "Logo";
  const id =
    typeof data.id === "string" && data.id.trim() ? data.id.trim() : crypto.randomUUID();

  let maxWidth: number | null = null;
  if (typeof data.max_width === "number" && Number.isFinite(data.max_width) && data.max_width > 0) {
    maxWidth = Math.min(Math.round(data.max_width), 600);
  }

  return {
    id,
    name,
    src,
    max_width: maxWidth,
  };
}

export function normalizeReceiptTemplateLogos(raw: unknown): ReceiptTemplateLogo[] {
  if (!Array.isArray(raw)) return [];
  const logos: ReceiptTemplateLogo[] = [];
  for (const item of raw) {
    const logo = normalizeReceiptTemplateLogo(item);
    if (logo) logos.push(logo);
    if (logos.length >= MAX_RECEIPT_TEMPLATE_LOGOS) break;
  }
  return logos;
}

export function validateReceiptTemplateLogos(logos: ReceiptTemplateLogo[]): void {
  if (logos.length > MAX_RECEIPT_TEMPLATE_LOGOS) {
    throw new Error(`A template can have at most ${MAX_RECEIPT_TEMPLATE_LOGOS} logos.`);
  }

  const names = new Set<string>();
  for (const logo of logos) {
    if (!isValidReceiptLogoDataUrl(logo.src)) {
      throw new Error(`Logo "${logo.name}" has an invalid image source.`);
    }
    const byteLength = new TextEncoder().encode(logo.src).length;
    if (byteLength > MAX_RECEIPT_LOGO_BYTES) {
      throw new Error(`Logo "${logo.name}" exceeds the size limit.`);
    }
    const key = logo.name.trim().toLowerCase();
    if (names.has(key)) {
      throw new Error(`Duplicate logo name "${logo.name}".`);
    }
    names.add(key);
  }
}

export function readReceiptLogoFile(file: File): Promise<ReceiptTemplateLogo> {
  if (!ALLOWED_LOGO_MIME_TYPES.has(file.type)) {
    return Promise.reject(new Error("Only PNG, JPEG, GIF, WebP, and SVG images are allowed."));
  }
  if (file.size > MAX_RECEIPT_LOGO_BYTES) {
    return Promise.reject(
      new Error(`Image must be ${Math.round(MAX_RECEIPT_LOGO_BYTES / 1024)} KB or smaller.`),
    );
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const src = typeof reader.result === "string" ? reader.result.trim() : "";
      if (!src || !isValidReceiptLogoDataUrl(src)) {
        reject(new Error("Failed to read image file."));
        return;
      }
      const byteLength = new TextEncoder().encode(src).length;
      if (byteLength > MAX_RECEIPT_LOGO_BYTES) {
        reject(
          new Error(`Image must be ${Math.round(MAX_RECEIPT_LOGO_BYTES / 1024)} KB or smaller.`),
        );
        return;
      }

      const baseName = file.name.replace(/\.[^.]+$/, "").trim() || "Logo";
      resolve({
        id: crypto.randomUUID(),
        name: baseName,
        src,
        max_width: null,
      });
    };
    reader.onerror = () => reject(new Error("Failed to read image file."));
    reader.readAsDataURL(file);
  });
}

export function createReceiptLogoImgMarkup(logo: ReceiptTemplateLogo): string {
  const widthAttr =
    logo.max_width != null && logo.max_width > 0
      ? ` style="max-width:${logo.max_width}px;height:auto;"`
      : "";
  const alt = logo.name.replace(/"/g, "&quot;");
  return `<img src="${logo.src}" alt="${alt}"${widthAttr} />`;
}
