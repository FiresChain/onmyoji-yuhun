/** Produce a lossless PNG with a quiet zone and whole pixels per QR module. */
export async function yuhunCodeQrDataUrl(code: string): Promise<string> {
  if (!code.trim()) throw new Error("当前方案没有可导出的御魂码");
  const QRCode = await import("qrcode");
  let errorCorrectionLevel: "M" | "L" = "M";
  try {
    QRCode.create(code, { errorCorrectionLevel });
  } catch {
    errorCorrectionLevel = "L";
    try {
      QRCode.create(code, { errorCorrectionLevel });
    } catch {
      throw new Error("御魂码内容过长，无法生成单张二维码，请使用复制功能");
    }
  }
  return QRCode.toDataURL(code, { type: "image/png", margin: 4, scale: 8, errorCorrectionLevel, color: { dark: "#000000ff", light: "#ffffffff" } });
}

export function downloadYuhunCodeQr(dataUrl: string, kind: "discard" | "rescue"): void {
  const anchor = document.createElement("a");
  anchor.href = dataUrl;
  anchor.download = `yuhun-${kind}.png`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}
