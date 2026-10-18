export interface Region { left: number; top: number; right: number; bottom: number }
export function textBlockPlacement(region: Region, width: number, height: number): { left: number; top: number; width: number; height: number } | null {
  if (![region.left, region.top, region.right, region.bottom, width, height].every(Number.isFinite) || width <= 0 || height <= 0 || region.left < 0 || region.top < 0 || region.right > 1 || region.bottom > 1 || region.left >= region.right || region.top >= region.bottom) return null;
  const w = Math.min(width, Math.max(28, (region.right - region.left) * width + 6));
  const h = Math.min(height, Math.max(22, (region.bottom - region.top) * height + 4));
  return { left: Math.max(0, Math.min(width - w, region.left * width - 3)), top: Math.max(0, Math.min(height - h, region.top * height - 2)), width: w, height: h };
}
export function translationPlacement(region: Region, width: number, height: number): { left: number; top: number; width: number; height: number } | null {
  if (![region.left, region.top, region.right, region.bottom, width, height].every(Number.isFinite) || width <= 0 || height <= 0 || region.left < 0 || region.top < 0 || region.right > 1 || region.bottom > 1 || region.right <= region.left || region.bottom <= region.top) return null;
  if (region.left === 0 && region.top === 0 && region.right === 1 && region.bottom === 1) {
    const w = Math.min(760, Math.max(1, width - 32));
    const h = Math.min(800, Math.max(1, height - 96));
    return { left: (width - w) / 2, top: (height - h) / 2, width: w, height: h };
  }
  const w = Math.min(width, Math.max(180, (region.right - region.left) * width));
  const h = Math.min(height, Math.max(70, (region.bottom - region.top) * height));
  return { left: Math.min(region.left * width, width - w), top: Math.min(region.top * height, height - h), width: w, height: h };
}
// Fractions avoid mixing CSS coordinates and physical pixels on scaled monitors.
export function screenRegion(start: { x: number; y: number }, end: { x: number; y: number }, width: number, height: number): Region | null {
  if (![start.x, start.y, end.x, end.y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return null;
  const clamp = (value: number, max: number) => Math.max(0, Math.min(value, max));
  const left = clamp(Math.min(start.x, end.x), width), right = clamp(Math.max(start.x, end.x), width);
  const top = clamp(Math.min(start.y, end.y), height), bottom = clamp(Math.max(start.y, end.y), height);
  if (right - left < 5 || bottom - top < 5) return null;
  return { left: left / width, top: top / height, right: right / width, bottom: bottom / height };
}
