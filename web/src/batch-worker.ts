/// <reference lib="webworker" />
import { encodeOutput } from "@/src/output-engine";
import { resizeRgba, validateDimensions } from "@/src/resize-core";
import type { BatchOutput } from "@/src/batch";

type Request = { id: number; file: File; output: BatchOutput };

self.onmessage = async (event: MessageEvent<Request>) => {
  const { id, file, output } = event.data;
  try {
    validateDimensions(output.width, output.height);
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const sourceCanvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const sourceContext = sourceCanvas.getContext("2d", { willReadFrequently: true });
    if (!sourceContext) throw new Error("Offscreen 2D canvas is unavailable");
    sourceContext.drawImage(bitmap, 0, 0); bitmap.close?.();
    const source = sourceContext.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);
    const resized = resizeRgba({ width: sourceCanvas.width, height: sourceCanvas.height, data: source.data }, output.width, output.height);
    const canvas = new OffscreenCanvas(output.width, output.height);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Offscreen 2D canvas is unavailable");
    const imageData = context.createImageData(output.width, output.height); imageData.data.set(resized.data);
    if (output.format === "jpg") {
      const rgba = new OffscreenCanvas(output.width, output.height); rgba.getContext("2d")!.putImageData(imageData, 0, 0);
      context.fillStyle = output.jpegBackground; context.fillRect(0, 0, output.width, output.height); context.drawImage(rgba, 0, 0);
    } else context.putImageData(imageData, 0, 0);
    const bytes = await encodeOutput(canvas, {
      format: output.format, quality: output.quality, dpi: { x: output.dpi, y: output.dpi },
      maxBytes: output.maxBytes ?? undefined,
    });
    self.postMessage({ id, bytes: bytes.buffer }, { transfer: [bytes.buffer] });
  } catch (error) {
    self.postMessage({ id, error: (error as Error).message || "processing failed" });
  }
};

export {};
