// Shared vision-document primitive — the ONE place that knows how to hand a document (a PDF or an image) to
// a vision LLM as a message content part. A PDF goes in as a `file`/`document` part (the model parses it
// natively); an image as an `image_url`/`image` part. Used by reconcile-po-bill and the WhatsApp webhook's
// extractors so PDF handling lives in exactly one place.

export const isPdf = (mime: string | null | undefined): boolean => /application\/pdf/i.test(mime || '');

/** True when a vision model can read this media at all — an image or a PDF. Office files (docx/xlsx) are not. */
export const isVisionReadable = (mime: string | null | undefined): boolean =>
  /^image\//i.test(mime || '') || isPdf(mime);

const VALID_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

/** One OpenAI chat content part (Chat Completions) for a document. */
export function openAIMediaPart(base64: string, mime: string): unknown {
  if (isPdf(mime)) {
    return { type: 'file', file: { filename: 'doc.pdf', file_data: `data:application/pdf;base64,${base64}` } };
  }
  const safe = VALID_IMAGE_TYPES.includes(mime) ? mime : 'image/jpeg';
  return { type: 'image_url', image_url: { url: `data:${safe};base64,${base64}`, detail: 'high' } };
}

/** One Anthropic messages content block for a document. */
export function anthropicMediaPart(base64: string, mime: string): unknown {
  if (isPdf(mime)) {
    return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } };
  }
  return { type: 'image', source: { type: 'base64', media_type: mime, data: base64 } };
}

/** Extra Anthropic headers a request needs for its media — the PDF beta flag when a PDF is attached. */
export function anthropicMediaHeaders(mime: string): Record<string, string> {
  return isPdf(mime) ? { 'anthropic-beta': 'pdfs-2024-09-25' } : {};
}
