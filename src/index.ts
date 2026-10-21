/**
 * High-Throughput Edge Media Streaming Router
 * Cloudflare Workers (V8 Isolates) + AWS S3 Origin + Cloudflare R2 Replica
 *
 * Core Capabilities:
 * - Edge HMAC-SHA256 Token Verification & KV Revocation Checks
 * - Streaming Dynamic HLS/DASH Manifest Rewriter
 * - Two-Tier Edge Cache & Byte-Range Request Handling
 * - Multi-Cloud Failover & Async Zero-Egress Storage Hydration
 * - Origin Shielding via In-Flight Request Coalescing
 */

import { Env, RoutingConfig } from './types/env';
import { extractTokenFromRequest, verifyMediaToken } from './auth/token';
import { routeMediaStoreRequest } from './storage/router';
import { rewriteHlsManifest } from './manifest/hls';
import { rewriteDashManifest } from './manifest/dash';
import { applyCorsHeaders, isManifest } from './utils/headers';

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // -------------------------------------------------------------------------
    // 1. Healthcheck & Operational Probes
    // -------------------------------------------------------------------------
    if (path === '/healthz' || path === '/livez') {
      return new Response(JSON.stringify({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        service: 'edge-media-router',
        region: (request as unknown as { cf?: { colo?: string } }).cf?.colo || 'UNKNOWN',
      }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        },
      });
    }

    // -------------------------------------------------------------------------
    // 2. CORS Preflight Options
    // -------------------------------------------------------------------------
    if (request.method === 'OPTIONS') {
      const headers = new Headers();
      applyCorsHeaders(headers, request, env);
      return new Response(null, { status: 204, headers });
    }

    // -------------------------------------------------------------------------
    // 3. Edge Geo-Fencing & Dynamic Routing Config (from KV)
    // -------------------------------------------------------------------------
    const clientCountry = (request as unknown as { cf?: { country?: string } }).cf?.country ||
                          request.headers.get('cf-ipcountry') || 'XX';
    const clientTcpRtt = (request as unknown as { cf?: { clientTcpRtt?: number } }).cf?.clientTcpRtt;

    let routingConfig: RoutingConfig | null = null;
    if (env.ROUTING_CONFIG_KV) {
      try {
        const configJson = await env.ROUTING_CONFIG_KV.get('global', 'text');
        if (configJson) {
          routingConfig = JSON.parse(configJson);
        }
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

    // -------------------------------------------------------------------------
    // 4. Token Verification (Anti-Hotlinking & Authorization)
    // -------------------------------------------------------------------------
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

    // -------------------------------------------------------------------------
    // 5. Media Retrieval & Manifest Rewriting
    // -------------------------------------------------------------------------
    // Clean key: strip leading /stream/ or use direct path
    let objectKey = path;
    if (objectKey.startsWith('/stream/')) {
      objectKey = objectKey.substring('/stream/'.length);
    } else if (objectKey.startsWith('/')) {
      objectKey = objectKey.substring(1);
    }

    // Check if request is an HLS or DASH manifest
    if (isManifest(path)) {
      // Fetch original manifest from storage tiers
      const manifestResponse = await routeMediaStoreRequest({
        request,
        objectKey,
        env,
        ctx,
      });

      if (!manifestResponse.ok) {
        return manifestResponse;
      }

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

    // -------------------------------------------------------------------------
    // 6. Direct Media Segment Streaming (.ts, .m4s, .mp4, etc.)
    // -------------------------------------------------------------------------
    return routeMediaStoreRequest({
      request,
      objectKey,
      env,
      ctx,
    });
  },
};

