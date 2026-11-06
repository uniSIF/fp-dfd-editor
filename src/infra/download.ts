/** 文字列をファイルとしてダウンロードさせる */
export function downloadText(filename: string, text: string, mime: string): void {
  downloadBlob(filename, new Blob([text], { type: mime }));
}

/** バイナリ（ZIP など）をファイルとしてダウンロードさせる */
export function downloadBytes(filename: string, bytes: Uint8Array, mime: string): void {
  downloadBlob(filename, new Blob([bytes as Uint8Array<ArrayBuffer>], { type: mime }));
}

function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
