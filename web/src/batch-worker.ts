/// <reference lib="webworker" />
import { resizeFile } from "@/src/page-render";
import type { BatchOutput } from "@/src/batch";

type Request = { id: number; file: File; output: BatchOutput };

self.onmessage = async (event: MessageEvent<Request>) => {
  const { id, file, output } = event.data;
  try {
    const bytes = await resizeFile(file, output);
    const buffer = (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength ? bytes : bytes.slice()).buffer as ArrayBuffer;
    self.postMessage({ id, bytes: buffer }, { transfer: [buffer] });
  } catch (error) {
    self.postMessage({ id, error: (error as Error).message || "processing failed" });
  }
};

export {};
