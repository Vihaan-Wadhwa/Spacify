/** Triggers a browser download of a data URL. */
export function downloadDataUrl(dataUrl: string, filename: string) {
  const link = document.createElement("a");
  link.download = filename;
  link.href = dataUrl;
  link.click();
}

/**
 * Shrinks an uploaded image to at most `max` px on its longest side and re-encodes it as JPEG.
 * Turns a 3 MB phone photo into ~100 KB before it goes to the AI.
 */
export function compressImage(file: File, max = 800, quality = 0.75): Promise<{ dataUrl: string; base64: string; mimeType: string; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => {
      let { width: w, height: h } = img;
      if (w > max || h > max) {
        if (w > h) {
          h = Math.round((h * max) / w);
          w = max;
        } else {
          w = Math.round((w * max) / h);
          h = max;
        }
      }
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(objectUrl);
      const dataUrl = canvas.toDataURL("image/jpeg", quality);
      resolve({ dataUrl, base64: dataUrl.split(",")[1], mimeType: "image/jpeg", width: w, height: h });
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Could not read that image. Try a JPG or PNG."));
    };
    img.src = objectUrl;
  });
}
