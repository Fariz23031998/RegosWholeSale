export const PRODUCT_FALLBACK_IMAGE =
  "data:image/svg+xml;charset=UTF-8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="280" viewBox="0 0 400 280">
      <rect width="400" height="280" fill="#eef2ff"/>
      <text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="#64748b" font-family="Arial, sans-serif" font-size="24">No image</text>
    </svg>`,
  );

export function hasProductImage(image: string | undefined | null): boolean {
  return Boolean(image?.trim());
}
