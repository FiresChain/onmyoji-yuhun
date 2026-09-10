declare module "qrcode" {
  interface Options {
    errorCorrectionLevel?: "M" | "L";
    type?: "image/png";
    margin?: number;
    scale?: number;
    color?: { dark: string; light: string };
  }
  export function create(text: string, options?: Options): unknown;
  export function toDataURL(text: string, options?: Options): Promise<string>;
}
