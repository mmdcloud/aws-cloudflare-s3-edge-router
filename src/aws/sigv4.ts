/**
 * Pure WebCrypto AWS Signature Version 4 (SigV4) Signer
 * Optimized for Cloudflare Workers (V8 Isolates) with zero external npm dependencies.
 * Signs HTTP requests for private AWS S3 origins.
 */

// Helper: Hex string encoder
function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (b !== undefined) {
      hex += b.toString(16).padStart(2, '0');
    }
  }
  return hex;
}

// Helper: SHA256 Hash
async function sha256Hex(data: string | Uint8Array): Promise<string> {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const hash = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return bytesToHex(new Uint8Array(hash));
}

// Helper: HMAC-SHA256 calculation
async function hmacSha256(key: Uint8Array | CryptoKey, data: string): Promise<Uint8Array> {
  let cryptoKey: CryptoKey;
  if (key instanceof Uint8Array) {
    cryptoKey = await crypto.subtle.importKey(
      'raw',
      key as BufferSource,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
  } else {
    cryptoKey = key;
  }

  const encodedData = new TextEncoder().encode(data);
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, encodedData as BufferSource);
  return new Uint8Array(signature);
}

// Helper: Derive AWS SigV4 Signing Key
async function getSignatureKey(
  key: string,
  dateStamp: string,
  regionName: string,
  serviceName: string
): Promise<Uint8Array> {
  const kSecret = new TextEncoder().encode(`AWS4${key}`);
  const kDate = await hmacSha256(kSecret, dateStamp);
  const kRegion = await hmacSha256(kDate, regionName);
  const kService = await hmacSha256(kRegion, serviceName);
  return hmacSha256(kService, 'aws4_request');
}

// Helper: URI Encode according to RFC 3986
function uriEncode(string: string, encodeSlash = true): string {
  let result = '';
  for (let i = 0; i < string.length; i++) {
    const ch = string[i];
    if (
      ch &&
      ((ch >= 'A' && ch <= 'Z') ||
      (ch >= 'a' && ch <= 'z') ||
      (ch >= '0' && ch <= '9') ||
      ch === '_' ||
      ch === '-' ||
      ch === '~' ||
      ch === '.')
    ) {
      result += ch;
    } else if (ch === '/' && !encodeSlash) {
      result += '/';
    } else if (ch !== undefined) {
      const hex = ch.charCodeAt(0).toString(16).toUpperCase();
      result += '%' + (hex.length < 2 ? '0' : '') + hex;
    }
  }
  return result;
}

export interface SigV4SignOptions {
  method: string;
  url: URL;
  region: string;
  service?: string; // defaults to 's3'
  accessKeyId: string;
  secretAccessKey: string;
  headers?: HeadersInit;
  body?: Uint8Array | string;
}

/**
 * Creates signed Headers for an AWS S3 request using AWS SigV4.
 */
export async function signAwsRequest(options: SigV4SignOptions): Promise<Headers> {
  const service = options.service || 's3';
  const method = options.method.toUpperCase();
  const url = options.url;

  // Date and timestamp calculations
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, ''); // YYYYMMDDTHHMMSSZ
  const dateStamp = amzDate.substring(0, 8); // YYYYMMDD

  // Prepare base headers
  const signedHeadersMap = new Map<string, string>();
  const inputHeaders = new Headers(options.headers);

  // Host header is mandatory for SigV4
  signedHeadersMap.set('host', url.host);
  signedHeadersMap.set('x-amz-date', amzDate);

  // Payload hash
  let payloadHash: string;
  if (options.body) {
    payloadHash = await sha256Hex(options.body);
  } else {
    // Empty payload SHA-256 for GET/HEAD
    payloadHash = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
  }
  signedHeadersMap.set('x-amz-content-sha256', payloadHash);

  // Pass Range header if present (critical for partial video content scrubbing)
  const rangeHeader = inputHeaders.get('range');
  if (rangeHeader) {
    signedHeadersMap.set('range', rangeHeader);
  }

  // Canonical URI
  const canonicalUri = uriEncode(url.pathname, false) || '/';

  // Canonical Query String
  const queryParams: Array<[string, string]> = [];
  url.searchParams.forEach((value, key) => {
    queryParams.push([uriEncode(key), uriEncode(value)]);
  });
  queryParams.sort(([a], [b]) => a.localeCompare(b));
  const canonicalQueryString = queryParams
    .map(([k, v]) => `${k}=${v}`)
    .join('&');

  // Sorted Canonical Headers
  const sortedHeaderKeys = Array.from(signedHeadersMap.keys()).sort();
  const canonicalHeaders = sortedHeaderKeys
    .map(key => `${key}:${signedHeadersMap.get(key)!.trim()}\n`)
    .join('');
  const signedHeadersList = sortedHeaderKeys.join(';');

  // Step 1: Canonical Request
  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQueryString,
    canonicalHeaders,
    signedHeadersList,
    payloadHash,
  ].join('\n');

  // Step 2: String to Sign
  const credentialScope = `${dateStamp}/${options.region}/${service}/aws4_request`;
  const canonicalRequestHash = await sha256Hex(canonicalRequest);
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    canonicalRequestHash,
  ].join('\n');

  // Step 3: Calculate Signature
  const signingKey = await getSignatureKey(
    options.secretAccessKey,
    dateStamp,
    options.region,
    service
  );
  const signatureBytes = await hmacSha256(signingKey, stringToSign);
  const signature = bytesToHex(signatureBytes);

  // Step 4: Build Authorization Header
  const authHeader = `AWS4-HMAC-SHA256 Credential=${options.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeadersList}, Signature=${signature}`;

  // Assemble final headers
  const outputHeaders = new Headers(options.headers);
  outputHeaders.set('host', url.host);
  outputHeaders.set('x-amz-date', amzDate);
  outputHeaders.set('x-amz-content-sha256', payloadHash);
  outputHeaders.set('Authorization', authHeader);
  if (rangeHeader) {
    outputHeaders.set('range', rangeHeader);
  }

  return outputHeaders;
}

