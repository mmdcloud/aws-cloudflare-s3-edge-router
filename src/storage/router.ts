/**
 * Multi-Cloud Edge Media Storage Router
 * Tier 1: Cloudflare Edge Cache (caches.default) with Range Key Normalization
 * Tier 2: Cloudflare R2 (Zero-Egress Mirror Storage)
 * Tier 3: AWS S3 (Primary Origin with On-the-Fly SigV4 Signing)
 * Async Cache Hydration: Mirrors hot S3 objects into R2 in the background (ctx.waitUntil)
 * Single-Flight Coalescing: Protects origin storage against thundering herds during live spikes
 */

import { Env } from '../types/env';
import { signAwsRequest } from '../aws/sigv4';
import { parseRangeHeader, buildContentRangeHeader } from '../utils/range';
import { applyCorsHeaders, applyCacheControl, getMimeType, isManifest } from '../utils/headers';
import { edgeCoalescer } from './coalesce';

export interface StorageRouteOptions {
  request: Request;
  objectKey: string;
  env: Env;
  ctx: ExecutionContext;
}

/**
 * Handles media retrieval across Cache, R2, and AWS S3 with failover and async hydration.
 */
export async function routeMediaStoreRequest(options: StorageRouteOptions): Promise<Response> {
  const { request, objectKey, env, ctx } = options;
  const requestUrl = new URL(request.url);
  const rangeHeader = request.headers.get('Range');
  const method = request.method.toUpperCase();

  if (method !== 'GET' && method !== 'HEAD') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  // ---------------------------------------------------------------------------
  // Tier 1: Cloudflare Edge Cache Lookup (caches.default)
  // ---------------------------------------------------------------------------
  const cache = caches.default;
  // Construct normalized cache key including Range to support partial scrub caching
  const cacheKeyUrl = new URL(requestUrl.toString());
  if (rangeHeader) {
    cacheKeyUrl.searchParams.set('cf_range', rangeHeader);
  }
  const cacheKey = new Request(cacheKeyUrl.toString(), {
    method: 'GET',
    headers: request.headers,
  });

  // Skip cache lookup if client explicitly requests bypass or for manifests with micro-TTL
  const isManifestFile = isManifest(objectKey);
  let cachedResponse: Response | undefined;

  if (!isManifestFile) {
    cachedResponse = await cache.match(cacheKey);
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

  // Deduplicate concurrent cache misses using Single-Flight Coalescing
  const coalesceKey = `${objectKey}::${rangeHeader || 'all'}`;

  return edgeCoalescer.do(coalesceKey, async () => {
    // -------------------------------------------------------------------------
    // Tier 2: Cloudflare R2 (Hot Media Zero-Egress Replica)
    // -------------------------------------------------------------------------
    if (env.MEDIA_R2) {
      try {
        const r2Options: R2GetOptions = {};
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

          // Cache media chunks in edge cache
          if (!isManifestFile && status === 200) {
            ctx.waitUntil(cache.put(cacheKey, response.clone()));
          }

          return response;
        }
      } catch (err) {
        console.warn(`R2 lookup failed for ${objectKey}, falling back to S3 origin:`, err);
      }
    }

    // -------------------------------------------------------------------------
    // Tier 3: Amazon S3 (Primary Origin with WebCrypto SigV4)
    // -------------------------------------------------------------------------
    const s3Region = env.AWS_REGION || 'us-east-1';
    const s3Bucket = env.S3_BUCKET_NAME;

    if (!s3Bucket || !env.AWS_ACCESS_KEY_ID || !env.AWS_SECRET_ACCESS_KEY) {
      return new Response('Origin S3 credentials or bucket not configured', {
        status: 502,
        headers: { 'Content-Type': 'text/plain' },
      });
    }

    // Clean leading slash for S3 key
    const cleanKey = objectKey.startsWith('/') ? objectKey.substring(1) : objectKey;
    const s3Url = new URL(`https://${s3Bucket}.s3.${s3Region}.amazonaws.com/${cleanKey}`);

    // Generate SigV4 signed headers
    const signedHeaders = await signAwsRequest({
      method,
      url: s3Url,
      region: s3Region,
      service: 's3',
      accessKeyId: env.AWS_ACCESS_KEY_ID,
      secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
      headers: rangeHeader ? { Range: rangeHeader } : undefined,
    });

    // Subrequest to AWS S3
    const s3Response = await fetch(s3Url.toString(), {
      method,
      headers: signedHeaders,
    });

    if (!s3Response.ok && s3Response.status !== 206) {
      // Pass-through error from origin (e.g. 404 Not Found, 403 Forbidden)
      const errHeaders = new Headers(s3Response.headers);
      applyCorsHeaders(errHeaders, request, env);
      return new Response(s3Response.body, {
        status: s3Response.status,
        statusText: s3Response.statusText,
        headers: errHeaders,
      });
    }

    // Prepare response
    const responseHeaders = new Headers(s3Response.headers);
    responseHeaders.set('X-Cache-Status', 'MISS');
    responseHeaders.set('X-Origin-Storage', 'Amazon-S3');
    if (!responseHeaders.get('Content-Type')) {
      responseHeaders.set('Content-Type', getMimeType(objectKey));
    }
    applyCorsHeaders(responseHeaders, request, env);
    applyCacheControl(responseHeaders, objectKey, env);

    // -------------------------------------------------------------------------
    // Async Cache Hydration: S3 -> Cloudflare R2
    // Zeroes future egress costs by replicating the object into R2 in background
    // -------------------------------------------------------------------------
    const shouldHydrate = env.ASYNC_HYDRATION_ENABLED !== 'false' && env.MEDIA_R2;

    if (shouldHydrate && s3Response.status === 200 && method === 'GET') {
      responseHeaders.set('X-Hydrated-To-R2', 'queued');
      // Clone response stream for background R2 write
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

      // Cache chunks at edge
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

