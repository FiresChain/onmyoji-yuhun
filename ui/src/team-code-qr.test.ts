import assert from "node:assert/strict";
import { test } from "node:test";
import { readTeamCodeFromClipboard, readYuhunCodeFromClipboard, validateTeamCodeQrText, validateYuhunCodeQrText, decodeYuhunCodeFromQrImage } from "./team-code-qr.js";

test("QR text validation keeps team codes and filter codes separate", () => {
  assert.equal(validateTeamCodeQrText("  #TA#example  "), "#TA#example");
  assert.equal(validateYuhunCodeQrText(" eJwA\nAA== "), "eJwAAA==");
  assert.throws(() => validateYuhunCodeQrText("#TA#example"), /御魂筛选码/);
  assert.throws(() => validateTeamCodeQrText("eJwAAA=="), /#TA#/);
  for (const invalid of ["", "https://example.com", "abcde", "ab=c"]) {
    assert.throws(() => validateYuhunCodeQrText(invalid));
  }
});

test("clipboard readers select their own code type and explain permission failures", async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const item = (text: string) => ({ types: ["text/plain"], getType: async () => new Blob([text]) });
  try {
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: { clipboard: { read: async () => [item("#TA#example"), item("eJwAAA==")] } } });
    assert.deepEqual(await readTeamCodeFromClipboard(), { code: "#TA#example", source: "text" });
    assert.deepEqual(await readYuhunCodeFromClipboard(), { code: "eJwAAA==", source: "text" });
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: { clipboard: { read: async () => { throw new DOMException("Denied", "NotAllowedError"); } } } });
    await assert.rejects(readYuhunCodeFromClipboard(), /Ctrl\+V/);
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: {} });
    await assert.rejects(readYuhunCodeFromClipboard(), /不支持读取剪贴板/);
    await assert.rejects(decodeYuhunCodeFromQrImage(new Blob(["text"])), /请选择二维码图片/);
  } finally {
    if (original) Object.defineProperty(globalThis, "navigator", original);
    else Reflect.deleteProperty(globalThis, "navigator");
  }
});
