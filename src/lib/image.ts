// Scale an uploaded image to cover w×h, crop the overflow from the center, and encode as webp (data URL)
export async function shrinkImage(file: File, w: number, h: number): Promise<string> {
  const img = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  const scale = Math.max(w / img.width, h / img.height);
  const dw = img.width * scale, dh = img.height * scale;
  ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
  return canvas.toDataURL("image/webp", 0.85);
}
