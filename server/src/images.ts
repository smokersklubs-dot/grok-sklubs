/**
 * Picture generation through any service that speaks the common "images/generations" request
 * (POST {base}/images/generations with a model and a prompt, answering with base64 data or a link).
 * Configure it with IMAGE_API_KEY / IMAGE_BASE_URL / IMAGE_MODEL, or let it reuse the OpenAI or xAI key.
 */
interface ImageService { baseUrl: string; apiKey: string; model: string }

export function imageService(): ImageService | null {
  const e = process.env;
  if (e.IMAGE_API_KEY) return { baseUrl: e.IMAGE_BASE_URL ?? "https://api.openai.com/v1", apiKey: e.IMAGE_API_KEY, model: e.IMAGE_MODEL ?? "gpt-image-1" };
  if (e.OPENAI_API_KEY) return { baseUrl: e.OPENAI_BASE_URL ?? "https://api.openai.com/v1", apiKey: e.OPENAI_API_KEY, model: e.IMAGE_MODEL ?? "gpt-image-1" };
  if (e.XAI_API_KEY) return { baseUrl: e.XAI_BASE_URL ?? "https://api.x.ai/v1", apiKey: e.XAI_API_KEY, model: e.IMAGE_MODEL ?? "grok-2-image" };
  return null;
}

export async function generateImage(prompt: string, signal?: AbortSignal): Promise<{ bytes: Buffer; mime: string }> {
  const svc = imageService();
  if (!svc) throw new Error("no image service is configured on this server");
  const res = await fetch(`${svc.baseUrl.replace(/\/$/, "")}/images/generations`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${svc.apiKey}` },
    body: JSON.stringify({ model: svc.model, prompt, n: 1 }),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(180_000)]) : AbortSignal.timeout(180_000),
  });
  if (!res.ok) throw new Error(`the image service answered ${res.status}: ${(await res.text().catch(() => "")).slice(0, 300)}`);
  const first = ((await res.json()) as { data?: { b64_json?: string; url?: string }[] }).data?.[0];
  if (first?.b64_json) return { bytes: Buffer.from(first.b64_json, "base64"), mime: sniff(Buffer.from(first.b64_json.slice(0, 16), "base64")) };
  if (first?.url) {
    const img = await fetch(first.url, { signal: AbortSignal.timeout(60_000) });
    if (!img.ok) throw new Error(`could not download the generated image (${img.status})`);
    const bytes = Buffer.from(await img.arrayBuffer());
    return { bytes, mime: sniff(bytes) };
  }
  throw new Error("the image service returned no image");
}

function sniff(head: Buffer): string {
  if (head[0] === 0xff && head[1] === 0xd8) return "image/jpeg";
  if (head.subarray(0, 4).toString("latin1") === "RIFF") return "image/webp";
  return "image/png";
}
