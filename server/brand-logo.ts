/** Only the host-configured logo may enter the offline 3D frame. */
export function createLogoReader(read = fetch) {
  let cached: { url: string; until: number; result: Promise<string | null> } | undefined;
  return (url: string) => {
    if (cached?.url === url && Date.now() < cached.until) return cached.result;
    const result = readLogo(url, read).catch(() => null);
    cached = { url, until: Date.now() + 300_000, result };
    return result;
  };
}

async function readLogo(url: string, read: typeof fetch): Promise<string | null> {
  const response = await read(url, { redirect: "error", signal: AbortSignal.timeout(5000) });
  const type = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  if (!response.ok || !type || !/^image\/(png|jpeg|webp|gif|svg\+xml|avif)$/.test(type)) {
    await response.body?.cancel();
    return null;
  }
  const reader = response.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    size += chunk.value.length;
    if (size > 1024 * 1024) {
      await reader.cancel();
      return null;
    }
    chunks.push(chunk.value);
  }
  return size ? `data:${type};base64,${Buffer.concat(chunks).toString("base64")}` : null;
}
