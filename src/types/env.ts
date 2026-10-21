/**
 * Environment bindings, secrets, and configuration interfaces for Cloudflare Worker.
 */

export interface Env {
  // Cloudflare R2 Storage Binding for Edge Tiered Cache
  MEDIA_R2: R2Bucket;

  // Cloudflare KV Namespaces
  REVOKED_TOKENS_KV: KVNamespace;
  ROUTING_CONFIG_KV?: KVNamespace;

  // AWS S3 Origin Credentials & Secrets
  AWS_ACCESS_KEY_ID: string;
  AWS_SECRET_ACCESS_KEY: string;

  // HMAC Token Auth Secret Key
  AUTH_SECRET_KEY: string;

  // Edge Router Configuration Variables
  AWS_REGION?: string;
  S3_BUCKET_NAME?: string;
  CACHE_MANIFEST_TTL?: string;
  CACHE_SEGMENT_TTL?: string;
  ASYNC_HYDRATION_ENABLED?: string;
  ENABLE_GEO_STEERING?: string;
  ALLOWED_ORIGINS?: string;
}

export interface MediaTokenPayload {
  /** Resource path or prefix the token is valid for (e.g., /stream/hls/live1/) */
  path: string;
  /** Unix timestamp in seconds when token expires */
  exp: number;
  /** Optional client IP binding (e.g. 192.0.2.1) */
  ip?: string;
  /** Optional client Autonomous System Number binding (e.g. 13335) */
  asn?: number;
  /** Optional unique token ID for explicit revocation */
  jti?: string;
  /** Optional custom session identifier */
  sid?: string;
}

export interface ParsedByteRange {
  start: number;
  end: number;
  total?: number;
  length: number;
  isPartial: boolean;
}

export interface RoutingConfig {
  geoSteering?: {
    [countryCode: string]: {
      s3BucketOverride?: string;
      s3RegionOverride?: string;
      primaryStorage?: 'r2' | 's3';
      bandwidthCapBps?: number;
    };
  };
  blockedCountries?: string[];
  maintenanceMode?: boolean;
}
