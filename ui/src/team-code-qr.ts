import jsQR from "jsqr";

const QR_SCAN_SCALES = [1, 0.75, 0.5, 1.5, 2] as const;
const MAX_SCAN_EDGE = 4_096;

function canvasContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (context === null) throw new Error("浏览器无法创建二维码识别画布");
  return context;
}

function scanCanvas(canvas: HTMLCanvasElement): string | null {
  const context = canvasContext(canvas);
  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  const result = jsQR(imageData.data, imageData.width, imageData.height, {
    inversionAttempts: "attemptBoth"
  });
  return result?.data.trim() || null;
}

function scanImageSource(source: CanvasImageSource, width: number, height: number, validate: (value: string) => string): string {
  const safeWidth = Math.max(1, width);
  const safeHeight = Math.max(1, height);
  for (const scale of QR_SCAN_SCALES) {
    const effectiveScale = Math.min(scale, MAX_SCAN_EDGE / Math.max(safeWidth, safeHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.floor(safeWidth * effectiveScale));
    canvas.height = Math.max(1, Math.floor(safeHeight * effectiveScale));
    const context = canvasContext(canvas);
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    const value = scanCanvas(canvas);
    if (value !== null) return validate(value);
  }
  throw new Error("未识别到二维码，请确保二维码完整、清晰且未被遮挡");
}

function imageFromBlob(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("无法读取图片，请选择 PNG、JPEG 或 WebP 截图"));
    };
    image.src = url;
  });
}

export function validateTeamCodeQrText(value: string): string {
  const normalized = value.trim();
  if (!normalized.startsWith("#TA#")) throw new Error("二维码中不是阴阳师阵容码（缺少 #TA# 前缀）");
  return normalized;
}

export interface ClipboardTeamCodeResult {
  readonly code: string;
  readonly source: "text" | "image";
}

/** Reads an existing screenshot or image without uploading it anywhere. */
async function decodeCodeFromQrImage(file: Blob, validate: (value: string) => string): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("请选择二维码图片");
  const image = await imageFromBlob(file);
  return scanImageSource(image, image.naturalWidth, image.naturalHeight, validate);
}

/** Reads text or an image from the Async Clipboard API after a button click. */
async function readCodeFromClipboard(validate: (value: string) => string, label: string): Promise<ClipboardTeamCodeResult> {
  if (navigator.clipboard?.read === undefined) {
    throw new Error("当前浏览器不支持读取剪贴板，请直接按 Ctrl+V（macOS 为 Cmd+V）粘贴");
  }
  try {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      if (!item.types.includes("text/plain")) continue;
      const text = await (await item.getType("text/plain")).text();
      try {
        return { code: validate(text), source: "text" };
      } catch {
        // Clipboard HTML may include unrelated text alongside a QR image.
      }
    }
    for (const item of items) {
      const imageType = item.types.find((type) => type.startsWith("image/"));
      if (imageType !== undefined) {
        return { code: await decodeCodeFromQrImage(await item.getType(imageType), validate), source: "image" };
      }
    }
    throw new Error(`剪贴板中没有${label}或二维码图片`);
  } catch (reason) {
    if (reason instanceof DOMException && reason.name === "NotAllowedError") {
      throw new Error("浏览器未允许读取剪贴板，请直接按 Ctrl+V（macOS 为 Cmd+V）粘贴");
    }
    throw reason;
  }
}

export function validateYuhunCodeQrText(value: string): string {
  const normalized = value.replace(/\s+/g, "");
  if (!normalized || !/^[A-Za-z0-9+/]+={0,2}$/.test(normalized) || normalized.replace(/=+$/, "").length % 4 === 1) {
    throw new Error("内容不是有效的御魂筛选码，请使用游戏内导出的御魂码或二维码");
  }
  return normalized;
}

export function decodeTeamCodeFromQrImage(file: Blob): Promise<string> {
  return decodeCodeFromQrImage(file, validateTeamCodeQrText);
}

export function readTeamCodeFromClipboard(): Promise<ClipboardTeamCodeResult> {
  return readCodeFromClipboard(validateTeamCodeQrText, " #TA# 阵容码");
}

export function decodeYuhunCodeFromQrImage(file: Blob): Promise<string> {
  return decodeCodeFromQrImage(file, validateYuhunCodeQrText);
}

export function readYuhunCodeFromClipboard(): Promise<ClipboardTeamCodeResult> {
  return readCodeFromClipboard(validateYuhunCodeQrText, "御魂筛选码");
}
