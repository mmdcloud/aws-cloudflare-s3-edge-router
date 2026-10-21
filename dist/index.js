/**
 * High-Throughput Edge Media Streaming Router (Production Bundle)
 * Cloudflare Workers (V8 Isolates) + AWS S3 Origin + Cloudflare R2 Replica
 *
 * Generated Standalone ES Module for direct Terraform deployment
 * Compatibility: Cloudflare Workers ES Module (compatibility_date: >= 2024-04-01)
 */

// =============================================================================
// 1. Utilities & MIME Types
// =============================================================================
function getMimeType(path) {
  const lower = path.toLowerCase();
  if (lower.endsWith('.m3u8')) return 'application/vnd.apple.mpegurl; charset=utf-8';
  if (lower.endsWith('.mpd')) return 'application/dash+xml; charset=utf-8';
  if (lower.endsWith('.ts')) return 'video/mp2t';
  if (lower.endsWith('.m4s')) return 'video/iso.segment';
  if (lower.endsWith('.mp4')) return 'video/mp4';
  if (lower.endsWith('.m4a')) return 'audio/mp4';
  if (lower.endsWith('.aac')) return 'audio/aac';
  if (lower.endsWith('.vtt')) return 'text/vtt; charset=utf-8';
  if (lower.endsWith('.key')) return 'application/octet-stream';
  return 'application/octet-stream';
}

function isManifest(path) {
  const lower = path.toLowerCase();
  return lower.endsWith('.m3u8') || lower.endsWith('.mpd');
}

function applyCorsHeaders(headers, request, env) {
  const origin = request.headers.get('Origin');
  const allowedOrigins = (env.ALLOWED_ORIGINS || '*').split(',').map(o => o.trim());

  if (allowedOrigins.includes('*') || (origin && allowedOrigins.includes(origin))) {
    headers.set('Access-Control-Allow-Origin', origin || '*');
  } else if (allowedOrigins.length > 0 && allowedOrigins[0]) {
    headers.set('Access-Control-Allow-Origin', allowedOrigins[0]);
  }

  headers.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  headers.set(
    'Access-Control-Allow-Headers',
    'Range, Authorization, Content-Type, Origin, Accept, X-Playback-Session-Id'
  );
  headers.set(
    'Access-Control-Expose-Headers',
    'Content-Range, Content-Length, ETag, Accept-Ranges, X-Cache-Status, X-Origin-Storage, X-Edge-Router, X-Hydrated-To-R2'
  );
  headers.set('Access-Control-Max-Age', '86400');
}

function applyCacheControl(headers, path, env) {
  headers.set('Accept-Ranges', 'bytes');
  headers.set('X-Edge-Router', 'Cloudflare-V8-Worker');
  headers.set('X-Content-Type-Options', 'nosniff');

  if (isManifest(path)) {
    const manifestTtl = env.CACHE_MANIFEST_TTL || '2';
    const staleTtl = Math.max(5, parseInt(manifestTtl, 10) * 3);
    headers.set(
      'Cache-Control',
      `public, max-age=${manifestTtl}, stale-while-revalidate=${staleTtl}, stale-if-error=30`
    );
  } else {
    const segmentTtl = env.CACHE_SEGMENT_TTL || '31536000';
    headers.set(
      'Cache-Control',
      `public, max-age=${segmentTtl}, s-maxage=${segmentTtl}, immutable`
    );
  }
}

// =============================================================================
// 2. HTTP Byte-Range Parser
// =============================================================================
function parseRangeHeader(rangeHeader, totalContentLength) {
  if (!rangeHeader || !rangeHeader.startsWith('bytes=')) return null;
  const rangeSpec = rangeHeader.substring(6).trim();
  const firstRange = rangeSpec.split(',')[0]?.trim();
  if (!firstRange) return null;

  const parts = firstRange.split('-');
  if (parts.length !== 2) return null;

  const startStr = parts[0]?.trim();
  const endStr = parts[1]?.trim();

  let start;
  let end;

  if (startStr === '' && endStr !== undefined && endStr !== '') {
    const suffixLength = parseInt(endStr, 10);
    if (isNaN(suffixLength) || suffixLength <= 0) return null;
    if (totalContentLength !== undefined) {
      start = Math.max(0, totalContentLength - suffixLength);
      end = totalContentLength - 1;
    } else {
      return null;
    }
  } else if (startStr !== undefined && startStr !== '') {
    start = parseInt(startStr, 10);
    if (isNaN(start) || start < 0) return null;

    if (endStr !== undefined && endStr !== '') {
      end = parseInt(endStr, 10);
      if (isNaN(end) || end < start) return null;
      if (totalContentLength !== undefined && end >= totalContentLength) {
        end = totalContentLength - 1;
      }
    } else {
      if (totalContentLength !== undefined) {
        end = totalContentLength - 1;
      } else {
        end = Number.MAX_SAFE_INTEGER;
      }
    }
  } else {
    return null;
  }

  return {
    start,
    end,
    total: totalContentLength,
    length: end - start + 1,
    isPartial: true,
  };
}

function buildContentRangeHeader(start, end, total) {
  const totalStr = total !== undefined ? total.toString() : '*';
  return `bytes ${start}-${end}/${totalStr}`;
}

// =============================================================================
// 3. WebCrypto HMAC-SHA256 Token Auth & Revocation
// =============================================================================
function base64UrlEncode(bytes) {
  const binary = typeof bytes === 'string' ? bytes : String.fromCharCode(...bytes);
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function base64UrlDecode(str) {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) base64 += '=';
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function getHmacKey(secret, usages) {
  const keyData = new TextEncoder().encode(secret);
  return crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    usages
  );
}

function extractTokenFromRequest(request, url) {
  const queryToken = url.searchParams.get('token') || url.searchParams.get('hdnts');
  if (queryToken) return queryToken;

  const authHeader = request.headers.get('Authorization');
  if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
    return authHeader.substring(7).trim();
  }

  const cookieHeader = request.headers.get('Cookie');
  if (cookieHeader) {
    const match = cookieHeader.match(/(?:^|;\s*)media_token=([^;]+)/);
    if (match && match[1]) return match[1];
  }

  return null;
}

async function verifyMediaToken(tokenString, requestPath, request, env) {
  if (!tokenString) return { valid: false, reason: 'Missing authorization token' };
  const parts = tokenString.split('.');
  if (parts.length !== 2) return { valid: false, reason: 'Malformed token structure' };

  const [encodedPayload, encodedSignature] = parts;
  if (!encodedPayload || !encodedSignature) return { valid: false, reason: 'Malformed token parts' };

  try {
    const key = await getHmacKey(env.AUTH_SECRET_KEY, ['verify']);
    const signatureBytes = base64UrlDecode(encodedSignature);
    const dataBytes = new TextEncoder().encode(encodedPayload);

    const isSignatureValid = await crypto.subtle.verify(
      'HMAC',
      key,
      signatureBytes,
      dataBytes
    );

    if (!isSignatureValid) {
      return { valid: false, reason: 'Invalid token signature' };
    }

    const payloadJson = new TextDecoder().decode(base64UrlDecode(encodedPayload));
    const payload = JSON.parse(payloadJson);
    const now = Math.floor(Date.now() / 1000);

    if (payload.exp && payload.exp < now) {
      return { valid: false, payload, reason: 'Token expired' };
    }

    const normalizedRequestPath = requestPath.toLowerCase();
    const normalizedTokenPath = payload.path.toLowerCase();

    const isExactMatch = normalizedRequestPath === normalizedTokenPath;
    const isPrefixMatch = normalizedTokenPath.endsWith('/') && normalizedRequestPath.startsWith(normalizedTokenPath);
    const isParentDirMatch = normalizedRequestPath.startsWith(normalizedTokenPath.substring(0, normalizedTokenPath.lastIndexOf('/') + 1));

    if (!isExactMatch && !isPrefixMatch && !isParentDirMatch) {
      return { valid: false, payload, reason: `Path mismatch: authorized for ${payload.path}` };
    }

    if (payload.ip) {
      const clientIp = request.headers.get('cf-connecting-ip') || '';
      if (clientIp !== payload.ip) {
        return { valid: false, payload, reason: 'Client IP mismatch' };
      }
    }

    if (payload.asn) {
      const cfProps = request.cf;
      if (cfProps?.asn && cfProps.asn !== payload.asn) {
        return { valid: false, payload, reason: 'Client ASN mismatch' };
      }
    }

    if (payload.jti && env.REVOKED_TOKENS_KV) {
      const isRevoked = await env.REVOKED_TOKENS_KV.get(payload.jti);
      if (isRevoked) {
        return { valid: false, payload, reason: 'Token has been revoked' };
      }
    }

    return { valid: true, payload };
  } catch (err) {
    return { valid: false, reason: err?.message || 'Token verification error' };
  }
}

// =============================================================================
// 4. Pure WebCrypto AWS SigV4 Signer
// =============================================================================
function bytesToHex(bytes) {
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

async function sha256Hex(data) {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return bytesToHex(new Uint8Array(hash));
}

async function hmacSha256(key, data) {
  let cryptoKey;
  if (key instanceof Uint8Array) {
    cryptoKey = await crypto.subtle.importKey(
      'raw',
      key,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
  } else {
    cryptoKey = key;
  }
  const encoded = new TextEncoder().encode(data);
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, encoded);
  return new Uint8Array(signature);
}

async function getSignatureKey(key, dateStamp, regionName, serviceName) {
  const kSecret = new TextEncoder().encode(`AWS4${key}`);
  const kDate = await hmacSha256(kSecret, dateStamp);
  const kRegion = await hmacSha256(kDate, regionName);
  const kService = await hmacSha256(kRegion, serviceName);
  return hmacSha256(kService, 'aws4_request');
}

function uriEncode(string, encodeSlash = true) {
  let result = '';
  for (let i = 0; i < string.length; i++) {
    const ch = string[i];
    if (
      (ch >= 'A' && ch <= 'Z') ||
      (ch >= 'a' && ch <= 'z') ||
      (ch >= '0' && ch <= '9') ||
      ch === '_' || ch === '-' || ch === '~' || ch === '.'
    ) {
      result += ch;
    } else if (ch === '/' && !encodeSlash) {
      result += '/';
    } else {
      const hex = ch.charCodeAt(0).toString(16).toUpperCase();
      result += '%' + (hex.length < 2 ? '0' : '') + hex;
    }
  }
  return result;
}

async function signAwsRequest(options) {
  const service = options.service || 's3';
  const method = options.method.toUpperCase();
  const url = options.url;

  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.substring(0, 8);

  const signedHeadersMap = new Map();
  const inputHeaders = new Headers(options.headers);

  signedHeadersMap.set('host', url.host);
  signedHeadersMap.set('x-amz-date', amzDate);

  let payloadHash = options.body
    ? await sha256Hex(options.body)
    : 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
  signedHeadersMap.set('x-amz-content-sha256', payloadHash);

  const rangeHeader = inputHeaders.get('range');
  if (rangeHeader) {
    signedHeadersMap.set('range', rangeHeader);
  }

  const canonicalUri = uriEncode(url.pathname, false) || '/';

  const queryParams = [];
  url.searchParams.forEach((value, key) => {
    queryParams.push([uriEncode(key), uriEncode(value)]);
  });
  queryParams.sort(([a], [b]) => a.localeCompare(b));
  const canonicalQueryString = queryParams.map(([k, v]) => `${k}=${v}`).join('&');

  const sortedHeaderKeys = Array.from(signedHeadersMap.keys()).sort();
  const canonicalHeaders = sortedHeaderKeys
    .map(key => `${key}:${signedHeadersMap.get(key).trim()}\n`)
    .join('');
  const signedHeadersList = sortedHeaderKeys.join(';');

  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQueryString,
    canonicalHeaders,
    signedHeadersList,
    payloadHash,
  ].join('\n');

  const credentialScope = `${dateStamp}/${options.region}/${service}/aws4_request`;
  const canonicalRequestHash = await sha256Hex(canonicalRequest);
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    canonicalRequestHash,
  ].join('\n');

  const signingKey = await getSignatureKey(
    options.secretAccessKey,
    dateStamp,
    options.region,
    service
  );
  const signatureBytes = await hmacSha256(signingKey, stringToSign);
  const signature = bytesToHex(signatureBytes);

  const authHeader = `AWS4-HMAC-SHA256 Credential=${options.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeadersList}, Signature=${signature}`;

  const outputHeaders = new Headers(options.headers);
  outputHeaders.set('host', url.host);
  outputHeaders.set('x-amz-date', amzDate);
  outputHeaders.set('x-amz-content-sha256', payloadHash);
  outputHeaders.set('Authorization', authHeader);
  if (rangeHeader) outputHeaders.set('range', rangeHeader);

  return outputHeaders;
}

// =============================================================================
// 5. Dynamic HLS & DASH Manifest Rewriters
// =============================================================================
function injectTokenIntoUri(uri, token) {
  if (!token) return uri;
  const hashIndex = uri.indexOf('#');
  const hash = hashIndex !== -1 ? uri.substring(hashIndex) : '';
  const cleanUri = hashIndex !== -1 ? uri.substring(0, hashIndex) : uri;
  const separator = cleanUri.includes('?') ? '&' : '?';
  return `${cleanUri}${separator}token=${encodeURIComponent(token)}${hash}`;
}

function rewriteHlsManifest(options) {
  const { manifestText, token, clientCountry, clientTcpRtt, enableGeoSteering, bandwidthCapBps } = options;
  const lines = manifestText.split(/\r?\n/);
  const outputLines = [];

  const isMasterPlaylist = manifestText.includes('#EXT-X-STREAM-INF');

  if (isMasterPlaylist) {
    const variants = [];
    let currentInfoLine = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]?.trim();
      if (!line) {
        if (i < lines.length - 1) outputLines.push('');
        continue;
      }

      if (line.startsWith('#EXT-X-STREAM-INF:')) {
        currentInfoLine = line;
      } else if (currentInfoLine && !line.startsWith('#')) {
        const bandwidthMatch = currentInfoLine.match(/BANDWIDTH=(\d+)/i);
        const resolutionMatch = currentInfoLine.match(/RESOLUTION=([\dx]+)/i);
        const bandwidth = bandwidthMatch && bandwidthMatch[1] ? parseInt(bandwidthMatch[1], 10) : 0;
        const resolution = resolutionMatch && resolutionMatch[1] ? resolutionMatch[1] : undefined;

        variants.push({
          infoLine: currentInfoLine,
          uriLine: line,
          bandwidth,
          resolution,
        });
        currentInfoLine = null;
      } else {
        outputLines.push(line);
      }
    }

    let filteredVariants = variants;
    if (enableGeoSteering) {
      if (bandwidthCapBps && bandwidthCapBps > 0) {
        const capped = variants.filter(v => v.bandwidth <= bandwidthCapBps);
        if (capped.length > 0) filteredVariants = capped;
      } else if (clientTcpRtt && clientTcpRtt > 250) {
        filteredVariants = [...variants].sort((a, b) => a.bandwidth - b.bandwidth);
      }
    }

    for (const v of filteredVariants) {
      outputLines.push(v.infoLine);
      outputLines.push(injectTokenIntoUri(v.uriLine, token));
    }

    if (clientCountry) {
      outputLines.push(`## CF-Geo: ${clientCountry} | RTT: ${clientTcpRtt || 0}ms`);
    }

    return outputLines.join('\n');
  } else {
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        outputLines.push(line);
        continue;
      }

      if (trimmed.startsWith('#EXT-X-KEY:')) {
        outputLines.push(trimmed.replace(/URI="([^"]+)"/, (_m, uri) => `URI="${injectTokenIntoUri(uri, token)}"`));
        continue;
      }

      if (trimmed.startsWith('#EXT-X-MAP:')) {
        outputLines.push(trimmed.replace(/URI="([^"]+)"/, (_m, uri) => `URI="${injectTokenIntoUri(uri, token)}"`));
        continue;
      }

      if (!trimmed.startsWith('#')) {
        outputLines.push(injectTokenIntoUri(trimmed, token));
        continue;
      }

      outputLines.push(line);
    }

    return outputLines.join('\n');
  }
}

function rewriteDashManifest(options) {
  const { manifestText, token } = options;
  if (!token) return manifestText;
  const encodedToken = encodeURIComponent(token);

  let rewritten = manifestText.replace(/<BaseURL>([^<]+)<\/BaseURL>/g, (_m, url) => {
    const separator = url.includes('?') ? '&' : '?';
    return `<BaseURL>${url}${separator}token=${encodedToken}</BaseURL>`;
  });

  rewritten = rewritten.replace(/media="([^"]+)"/g, (match, mediaUrl) => {
    if (mediaUrl.includes('token=')) return match;
    const separator = mediaUrl.includes('?') ? '&' : '?';
    return `media="${mediaUrl}${separator}token=${encodedToken}"`;
  });

  rewritten = rewritten.replace(/initialization="([^"]+)"/g, (match, initUrl) => {
    if (initUrl.includes('token=')) return match;
    const separator = initUrl.includes('?') ? '&' : '?';
    return `initialization="${initUrl}${separator}token=${encodedToken}"`;
  });

  return rewritten;
}

// =============================================================================
// 6. In-Flight Single Flight Coalescing (Thundering Herd Shield)
// =============================================================================
const inFlightCoalesceMap = new Map();

async function singleFlightCoalesce(key, fetchFn) {
  const existing = inFlightCoalesceMap.get(key);
  if (existing) {
    const response = await existing;
    return response.clone();
  }

  const promise = (async () => {
    try {
      return await fetchFn();
    } finally {
      inFlightCoalesceMap.delete(key);
    }
  })();

  inFlightCoalesceMap.set(key, promise);
  const result = await promise;
  return result.clone();
}

// =============================================================================
// 7. Multi-Tier Storage Router (Cache -> R2 -> S3 -> Async Hydration)
// =============================================================================
async function routeMediaStoreRequest(options) {
  const { request, objectKey, env, ctx } = options;
  const requestUrl = new URL(request.url);
  const rangeHeader = request.headers.get('Range');
  const method = request.method.toUpperCase();

  if (method !== 'GET' && method !== 'HEAD') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  // Tier 1: Cloudflare Edge Cache Lookup
  const cache = caches.default;
  const cacheKeyUrl = new URL(requestUrl.toString());
  if (rangeHeader) {
    cacheKeyUrl.searchParams.set('cf_range', rangeHeader);
  }
  const cacheKey = new Request(cacheKeyUrl.toString(), {
    method: 'GET',
    headers: request.headers,
  });

  const isManifestFile = isManifest(objectKey);

  if (!isManifestFile) {
    const cachedResponse = await cache.match(cacheKey);
    if (cachedResponse) {
      const responseHeaders = new Headers(cachedResponse.headers);
      responseHeaders.set('X-Cache-Status', 'HIT');
      responseHeaders.set('X-Origin-Storage', 'Cloudflare-Edge-Cache');
      applyCorsHeaders(responseHeaders, request, env);

      return new Response(method === 'HEAD' ? null : cachedResponse.body, {
        status: cachedResponse.status,
        statusText: cachedResponse.statusText,
        headers: responseHeaders,
      });
    }
  }

  // Coalesce in-flight requests for the same chunk to shield the origin
  const coalesceKey = `${objectKey}::${rangeHeader || 'all'}`;

  return singleFlightCoalesce(coalesceKey, async () => {
    // Tier 2: Cloudflare R2 Lookup
    if (env.MEDIA_R2) {
      try {
        const r2Options = {};
        if (rangeHeader) {
          const parsed = parseRangeHeader(rangeHeader);
          if (parsed) {
            r2Options.range = {
              offset: parsed.start,
              length: parsed.length,
            };
          }
        }

        const r2Object = await env.MEDIA_R2.get(objectKey, r2Options);

        if (r2Object) {
          const headers = new Headers();
          r2Object.writeHttpMetadata(headers);
          headers.set('ETag', r2Object.httpEtag);
          headers.set('X-Cache-Status', 'MISS');
          headers.set('X-Origin-Storage', 'Cloudflare-R2');

          if (!headers.get('Content-Type')) {
            headers.set('Content-Type', getMimeType(objectKey));
          }

          applyCorsHeaders(headers, request, env);
          applyCacheControl(headers, objectKey, env);

          let status = 200;
          if (rangeHeader && r2Options.range) {
            status = 206;
            const start = r2Options.range.offset ?? 0;
            const length = r2Options.range.length ?? r2Object.size;
            const end = start + length - 1;
            headers.set('Content-Range', buildContentRangeHeader(start, end, r2Object.size));
            headers.set('Content-Length', length.toString());
          } else {
            headers.set('Content-Length', r2Object.size.toString());
          }

          const response = new Response(method === 'HEAD' ? null : r2Object.body, {
            status,
            headers,
          });

          if (!isManifestFile && status === 200) {
            ctx.waitUntil(cache.put(cacheKey, response.clone()));
          }

          return response;
        }
      } catch (err) {
        console.warn(`R2 lookup failed for ${objectKey}, falling back to S3 origin:`, err);
      }
    }

    // Tier 3: Primary Origin Amazon S3 (SigV4 Auth)
    const s3Region = env.AWS_REGION || 'us-east-1';
    const s3Bucket = env.S3_BUCKET_NAME;

    if (!s3Bucket || !env.AWS_ACCESS_KEY_ID || !env.AWS_SECRET_ACCESS_KEY) {
      return new Response('Origin S3 credentials or bucket not configured', {
        status: 502,
        headers: { 'Content-Type': 'text/plain' },
      });
    }

    const cleanKey = objectKey.startsWith('/') ? objectKey.substring(1) : objectKey;
    const s3Url = new URL(`https://${s3Bucket}.s3.${s3Region}.amazonaws.com/${cleanKey}`);

    const signedHeaders = await signAwsRequest({
      method,
      url: s3Url,
      region: s3Region,
      service: 's3',
      accessKeyId: env.AWS_ACCESS_KEY_ID,
      secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
      headers: rangeHeader ? { Range: rangeHeader } : undefined,
    });

    const s3Response = await fetch(s3Url.toString(), {
      method,
      headers: signedHeaders,
    });

    if (!s3Response.ok && s3Response.status !== 206) {
      const errHeaders = new Headers(s3Response.headers);
      applyCorsHeaders(errHeaders, request, env);
      return new Response(s3Response.body, {
        status: s3Response.status,
        statusText: s3Response.statusText,
        headers: errHeaders,
      });
    }

    const responseHeaders = new Headers(s3Response.headers);
    responseHeaders.set('X-Cache-Status', 'MISS');
    responseHeaders.set('X-Origin-Storage', 'Amazon-S3');
    if (!responseHeaders.get('Content-Type')) {
      responseHeaders.set('Content-Type', getMimeType(objectKey));
    }
    applyCorsHeaders(responseHeaders, request, env);
    applyCacheControl(responseHeaders, objectKey, env);

    // Async Cache Hydration: S3 -> Cloudflare R2
    const shouldHydrate = env.ASYNC_HYDRATION_ENABLED !== 'false' && env.MEDIA_R2;

    if (shouldHydrate && s3Response.status === 200 && method === 'GET') {
      responseHeaders.set('X-Hydrated-To-R2', 'queued');
      const [clientStream, r2Stream] = s3Response.body ? s3Response.body.tee() : [null, null];

      if (r2Stream) {
        ctx.waitUntil(
          (async () => {
            try {
              await env.MEDIA_R2.put(cleanKey, r2Stream, {
                httpMetadata: {
                  contentType: responseHeaders.get('Content-Type') || undefined,
                  cacheControl: responseHeaders.get('Cache-Control') || undefined,
                },
              });
            } catch (r2PutErr) {
              console.error(`Async R2 hydration failed for ${cleanKey}:`, r2PutErr);
            }
          })()
        );
      }

      const clientResponse = new Response(clientStream, {
        status: s3Response.status,
        headers: responseHeaders,
      });

      if (!isManifestFile) {
        ctx.waitUntil(cache.put(cacheKey, clientResponse.clone()));
      }

      return clientResponse;
    }

    const finalResponse = new Response(method === 'HEAD' ? null : s3Response.body, {
      status: s3Response.status,
      headers: responseHeaders,
    });

    if (!isManifestFile && (finalResponse.status === 200 || finalResponse.status === 206)) {
      ctx.waitUntil(cache.put(cacheKey, finalResponse.clone()));
    }

    return finalResponse;
  });
}

// =============================================================================
// 8. Main Worker Fetch Handler
// =============================================================================
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // 1. Healthcheck endpoints
    if (path === '/healthz' || path === '/livez') {
      return new Response(JSON.stringify({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        service: 'edge-media-router',
        region: request.cf?.colo || 'UNKNOWN',
      }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        },
      });
    }

    // 2. CORS Preflight
    if (request.method === 'OPTIONS') {
      const headers = new Headers();
      applyCorsHeaders(headers, request, env);
      return new Response(null, { status: 204, headers });
    }

    // 3. Edge Geo-Fencing
    const clientCountry = request.cf?.country || request.headers.get('cf-ipcountry') || 'XX';
    const clientTcpRtt = request.cf?.clientTcpRtt;

    let routingConfig = null;
    if (env.ROUTING_CONFIG_KV) {
      try {
        const configJson = await env.ROUTING_CONFIG_KV.get('global', 'text');
        if (configJson) routingConfig = JSON.parse(configJson);
      } catch (err) {
        console.warn('Failed reading routing config from KV:', err);
      }
    }

    if (routingConfig?.blockedCountries?.includes(clientCountry)) {
      return new Response(JSON.stringify({ error: 'Access denied in this jurisdiction' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 4. Token Authorization
    const isPublicStatic = path.startsWith('/static/') || path === '/favicon.ico';
    const token = extractTokenFromRequest(request, url);

    if (!isPublicStatic && env.AUTH_SECRET_KEY) {
      const authResult = await verifyMediaToken(token || '', path, request, env);
      if (!authResult.valid) {
        const errorHeaders = new Headers({ 'Content-Type': 'application/json' });
        applyCorsHeaders(errorHeaders, request, env);

        return new Response(JSON.stringify({
          error: 'Unauthorized Media Request',
          reason: authResult.reason,
          status: 401,
        }), {
          status: 401,
          headers: errorHeaders,
        });
      }
    }

    // 5. Media Routing & Manifest Rewriting
    let objectKey = path;
    if (objectKey.startsWith('/stream/')) {
      objectKey = objectKey.substring('/stream/'.length);
    } else if (objectKey.startsWith('/')) {
      objectKey = objectKey.substring(1);
    }

    if (isManifest(path)) {
      const manifestResponse = await routeMediaStoreRequest({
        request,
        objectKey,
        env,
        ctx,
      });

      if (!manifestResponse.ok) return manifestResponse;

      const originalManifestText = await manifestResponse.text();
      let rewrittenText = originalManifestText;

      const isHls = path.toLowerCase().endsWith('.m3u8');
      const isDash = path.toLowerCase().endsWith('.mpd');

      const enableGeoSteering = env.ENABLE_GEO_STEERING !== 'false';
      const geoConfig = routingConfig?.geoSteering?.[clientCountry];

      if (isHls) {
        rewrittenText = rewriteHlsManifest({
          manifestText: originalManifestText,
          token: token || undefined,
          clientCountry,
          clientTcpRtt,
          enableGeoSteering,
          bandwidthCapBps: geoConfig?.bandwidthCapBps,
          requestUrl: url,
        });
      } else if (isDash) {
        rewrittenText = rewriteDashManifest({
          manifestText: originalManifestText,
          token: token || undefined,
          clientCountry,
          requestUrl: url,
        });
      }

      const responseHeaders = new Headers(manifestResponse.headers);
      responseHeaders.set('Content-Length', new TextEncoder().encode(rewrittenText).length.toString());
      applyCorsHeaders(responseHeaders, request, env);

      return new Response(rewrittenText, {
        status: 200,
        headers: responseHeaders,
      });
    }

    // 6. Media Segments
    return routeMediaStoreRequest({
      request,
      objectKey,
      env,
      ctx,
    });
  },
};

