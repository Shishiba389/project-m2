/// <reference lib="webworker" />
/**
 * The editor's export, off the main thread.
 *
 * One worker serves one export run: `runExport` starts it, sends every file
 * to it in turn and terminates it at the end, so the template layers it has
 * resampled live exactly as long as the run that reuses them.
 */
import { renderPage, type FrameSpec, type LayerCache, type RenderMetadata } from "@/src/page-render";
import type { EncodableFormat } from "@/src/output-engine";

export type ExportRequest = {
  id: number; file: File; spec: FrameSpec; format: EncodableFormat; quality: number; metadata: RenderMetadata;
};
export type ExportReply = { id: number; bytes?: ArrayBuffer; error?: string };

const templates: LayerCache = new Map();

self.onmessage = async (event: MessageEvent<ExportRequest>) => {
  const { id, file, spec, format, quality, metadata } = event.data;
  try {
    const bytes = await renderPage(file, spec, format, quality, metadata, templates);
    // Hand the buffer over rather than copy it; it must be exactly the file.
    const buffer = (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength ? bytes : bytes.slice()).buffer as ArrayBuffer;
    self.postMessage({ id, bytes: buffer } satisfies ExportReply, { transfer: [buffer] });
  } catch (error) {
    self.postMessage({ id, error: (error as Error).message || "could not be read" } satisfies ExportReply);
  }
};

export {};
