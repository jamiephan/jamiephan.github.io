/**
 * Decodes images to raw RGBA pixels off the main thread (see `imageDecoder.ts`).
 *
 * Request: `{ id, url }`. Reply: `{ id, width, height, pixels }` (an ArrayBuffer, transferred),
 * or `{ id, error }`. Rows come bottom-up (flipped, as the ImageBitmapLoader delivers them), so
 * row 0 is texture row 0. The maps are opaque, so the 2D canvas's premultiplied storage loses
 * nothing.
 */
interface Scope {
  onmessage: ((event: MessageEvent<{ id: number; url: string }>) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
}
const scope = self as unknown as Scope;

scope.onmessage = ({ data: { id, url } }) => {
  void (async () => {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bitmap = await createImageBitmap(await response.blob(), {
        imageOrientation: "flipY",
        premultiplyAlpha: "none",
      });
      const { width, height } = bitmap;
      const canvas = new OffscreenCanvas(width, height);
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("No 2D context in this worker");
      context.drawImage(bitmap, 0, 0);
      bitmap.close();
      const pixels = context.getImageData(0, 0, width, height).data.buffer;
      scope.postMessage({ id, width, height, pixels }, [pixels]);
    } catch (error) {
      scope.postMessage({ id, error: String(error) });
    }
  })();
};
