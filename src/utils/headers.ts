/**
 * Header and MIME utility functions for media streaming and edge caching.
 */

import { Env } from '../types/env';

export function getMimeType(path: string): string {
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

export function isManifest(path: string): boolean {
  const lower = path.toLowerCase();
  return lower.endsWith('.m3u8') || lower.endsWith('.mpd');
}

export function isMediaSegment(path: string): boolean {
  const lower = path.toLowerCase();
  return (
    lower.endsWith('.ts') ||
    lower.endsWith('.m4s') ||
    lower.endsWith('.mp4') ||
    lower.endsWith('.aac') ||
    lower.endsWith('.m4a') ||
    lower.endsWith('.vtt') ||
    lower.endsWith('.key')
  );
}

/**
 * Applies production-grade CORS headers
 */
export function applyCorsHeaders(headers: Headers, request: Request, env: Env): void {
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
    'Content-Range, Content-Length, ETag, Accept-Ranges, X-Cache-Status, X-Origin-Storage, X-Edge-Router'
  );
  headers.set('Access-Control-Max-Age', '86400');
}

/**
 * Applies Cache-Control headers based on content type:
 * - Manifests (.m3u8, .mpd): Micro-TTL (stale-while-revalidate)
 * - Media Chunks (.ts, .m4s): Long-term immutable TTL
 */
export function applyCacheControl(headers: Headers, path: string, env: Env): void {
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
    const segmentTtl = env.CACHE_SEGMENT_TTL || '31536000'; // 1 year
    headers.set(
      'Cache-Control',
      `public, max-age=${segmentTtl}, s-maxage=${segmentTtl}, immutable`
    );
  }
}

