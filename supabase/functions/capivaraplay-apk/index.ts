const CHUNK_SIZE = 40 * 1024 * 1024;
const MAX_APK_SIZE = 180 * 1024 * 1024;
const APP_ID = "capivaraplay-block";
const BUCKET = "capivara-updates";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "Range, If-Range, Accept, Content-Type",
  "Access-Control-Expose-Headers": "Accept-Ranges, Content-Length, Content-Range, Content-Disposition",
};

type AppRelease = {
  versionCode?: unknown;
  sizeBytes?: unknown;
  sha256?: unknown;
  parts?: Array<{ path?: unknown }>;
};

type Segment = {
  url: string;
  partLength: number;
  localStart: number;
  length: number;
};

function jsonResponse(message: string, status: number, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8", ...extraHeaders },
  });
}

function publicApiKey(): string {
  const publishedKeys = Deno.env.get("SUPABASE_PUBLISHABLE_KEYS");
  if (publishedKeys) {
    try {
      const keys = JSON.parse(publishedKeys) as Record<string, string>;
      const key = keys.default || Object.values(keys)[0];
      if (key) return key;
    } catch {
      // Fall through to the legacy public anon key.
    }
  }
  return Deno.env.get("SUPABASE_ANON_KEY") || "";
}

async function publishedRelease(base: string, apiKey: string): Promise<AppRelease | null> {
  const url = new URL(`${base}/rest/v1/remote_app_config`);
  url.searchParams.set("app_id", `eq.${APP_ID}`);
  url.searchParams.set("select", "config");
  const response = await fetch(url, { headers: { apikey: apiKey, Accept: "application/json" } });
  if (!response.ok) throw new Error(`Config request failed (${response.status})`);
  const rows = await response.json();
  if (!Array.isArray(rows) || !rows[0]?.config || typeof rows[0].config !== "object") return null;
  const release = rows[0].config.appUpdate;
  return release && typeof release === "object" ? release as AppRelease : null;
}

function parseRange(value: string | null, total: number): { start: number; end: number } | null | false {
  if (!value) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match || (!match[1] && !match[2])) return false;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return false;
    return { start: Math.max(0, total - suffix), end: total - 1 };
  }
  const start = Number(match[1]);
  const requestedEnd = match[2] ? Number(match[2]) : total - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(requestedEnd) || start < 0 || start >= total || requestedEnd < start) return false;
  return { start, end: Math.min(requestedEnd, total - 1) };
}

function sliceResponse(upstream: Response, skipBytes: number, byteLimit: number, abort: AbortController): ReadableStream<Uint8Array> {
  const reader = upstream.body?.getReader();
  if (!reader) throw new Error("APK part has no response body");
  let skip = skipBytes;
  let remaining = byteLimit;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        while (remaining > 0) {
          const result = await reader.read();
          if (result.done) throw new Error("APK part ended early");
          const bytes = result.value;
          const from = Math.min(skip, bytes.length);
          skip -= from;
          if (from === bytes.length) continue;
          const count = Math.min(remaining, bytes.length - from);
          remaining -= count;
          controller.enqueue(bytes.subarray(from, from + count));
          if (remaining === 0) {
            controller.close();
            void reader.cancel().catch(() => {});
          }
          return;
        }
        controller.close();
      } catch {
        controller.error(new Error("APK part could not be read completely"));
      }
    },
    async cancel() {
      abort.abort();
      await reader.cancel().catch(() => {});
    },
  });
}

function joinedApkStream(segments: Segment[]): ReadableStream<Uint8Array> {
  let segmentIndex = 0;
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let activeAbort: AbortController | null = null;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        while (true) {
          if (reader) {
            const result = await reader.read();
            if (!result.done) {
              controller.enqueue(result.value);
              return;
            }
            reader.releaseLock();
            reader = null;
            activeAbort = null;
          }

          const segment = segments[segmentIndex++];
          if (!segment) {
            controller.close();
            return;
          }

          const abort = new AbortController();
          activeAbort = abort;
          const headers = new Headers();
          const localEnd = segment.localStart + segment.length - 1;
          if (segment.localStart > 0 || segment.length < segment.partLength) {
            headers.set("Range", `bytes=${segment.localStart}-${localEnd}`);
          }
          const upstream = await fetch(segment.url, { headers, signal: abort.signal });
          if (upstream.status !== 200 && upstream.status !== 206) throw new Error(`APK part request failed (${upstream.status})`);
          if (upstream.status === 206) {
            const contentRange = upstream.headers.get("Content-Range") || "";
            if (!contentRange.startsWith(`bytes ${segment.localStart}-`)) throw new Error("APK part returned a mismatched byte range");
          }
          reader = sliceResponse(upstream, upstream.status === 206 ? 0 : segment.localStart, segment.length, abort).getReader();
        }
      } catch {
        controller.error(new Error("The APK download could not be completed"));
      }
    },
    async cancel() {
      activeAbort?.abort();
      await reader?.cancel().catch(() => {});
    },
  });
}

function downloadHeaders(total: number, sha256: unknown, range: { start: number; end: number } | null) {
  const length = range ? range.end - range.start + 1 : total;
  const headers: Record<string, string> = {
    ...corsHeaders,
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-store, no-cache, must-revalidate",
    "Content-Disposition": 'attachment; filename="capivaraplay.apk"',
    "Content-Length": String(length),
    "Content-Type": "application/vnd.android.package-archive",
    "X-Content-Type-Options": "nosniff",
  };
  if (range) headers["Content-Range"] = `bytes ${range.start}-${range.end}/${total}`;
  if (typeof sha256 === "string" && /^[a-f0-9]{64}$/i.test(sha256)) headers["X-Content-SHA256"] = sha256;
  return headers;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (request.method !== "GET" && request.method !== "HEAD") return jsonResponse("Method not allowed", 405, { Allow: "GET, HEAD, OPTIONS" });

  const base = (Deno.env.get("SUPABASE_URL") || "").replace(/\/+$/, "");
  const apiKey = publicApiKey();
  if (!base || !apiKey) return jsonResponse("Download service is not configured", 503);

  let release: AppRelease | null;
  try {
    release = await publishedRelease(base, apiKey);
  } catch {
    return jsonResponse("Could not read the published APK", 502);
  }
  if (!release) return jsonResponse("No APK has been published", 404);

  const versionCode = Number(release.versionCode);
  const total = Number(release.sizeBytes);
  const parts = Array.isArray(release.parts) ? release.parts : [];
  const partCount = Math.ceil(total / CHUNK_SIZE);
  if (!Number.isSafeInteger(versionCode) || versionCode < 1 || !Number.isSafeInteger(total) || total < 4 || total > MAX_APK_SIZE || parts.length !== partCount) {
    return jsonResponse("Published APK metadata is invalid", 404);
  }

  const firstPath = typeof parts[0]?.path === "string" ? parts[0].path : "";
  const firstMatch = new RegExp(`^${versionCode}/(${versionCode}-[0-9a-f-]{36})/part-01\\.bin$`, "i").exec(firstPath);
  if (!firstMatch) return jsonResponse("Published APK parts are invalid", 404);
  const releaseFolder = firstMatch[1];
  const partLengths = parts.map((_, index) => Math.min(CHUNK_SIZE, total - index * CHUNK_SIZE));
  const urls: string[] = [];
  for (let index = 0; index < partCount; index++) {
    const expectedPath = `${versionCode}/${releaseFolder}/part-${String(index + 1).padStart(2, "0")}.bin`;
    if (parts[index]?.path !== expectedPath) return jsonResponse("Published APK parts are invalid", 404);
    const encodedPath = expectedPath.split("/").map(encodeURIComponent).join("/");
    urls.push(`${base}/storage/v1/object/public/${BUCKET}/${encodedPath}`);
  }

  const parsedRange = parseRange(request.headers.get("Range"), total);
  if (parsedRange === false) {
    return new Response(null, { status: 416, headers: { ...corsHeaders, "Accept-Ranges": "bytes", "Content-Range": `bytes */${total}` } });
  }
  const range = parsedRange;
  const headers = downloadHeaders(total, release.sha256, range);
  const status = range ? 206 : 200;
  if (request.method === "HEAD") return new Response(null, { status, headers });

  const start = range?.start ?? 0;
  const end = range?.end ?? total - 1;
  const segments: Segment[] = [];
  for (let index = 0; index < partCount; index++) {
    const partStart = index * CHUNK_SIZE;
    const partEnd = partStart + partLengths[index] - 1;
    const selectedStart = Math.max(start, partStart);
    const selectedEnd = Math.min(end, partEnd);
    if (selectedStart <= selectedEnd) {
      segments.push({
        url: urls[index],
        partLength: partLengths[index],
        localStart: selectedStart - partStart,
        length: selectedEnd - selectedStart + 1,
      });
    }
  }
  return new Response(joinedApkStream(segments), { status, headers });
});

