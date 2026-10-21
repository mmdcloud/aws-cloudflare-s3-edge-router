/**
 * High-Performance Edge HMAC-SHA256 Token Verification and Generation
 * Built entirely on standard Web Crypto API (crypto.subtle) without external dependencies.
 */

import { Env, MediaTokenPayload } from '../types/env';

// Utility: Base64URL encode
export function base64UrlEncode(bytes: Uint8Array | string): string {
  const binary = typeof bytes === 'string' 
    ? bytes 
    : String.fromCharCode(...bytes);
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

// Utility: Base64URL decode
export function base64UrlDecode(str: string): Uint8Array {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) {
    base64 += '=';
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// Convert string to Uint8Array UTF-8
function textToBytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

// Import HMAC-SHA256 CryptoKey
async function getHmacKey(secret: string, usages: KeyUsage[]): Promise<CryptoKey> {
  const keyData = textToBytes(secret);
  return crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    usages
  );
}

/**
 * Signs a media token payload into a compact secure token: `<base64urlPayload>.<signatureHex>`
 */
export async function signMediaToken(
  payload: MediaTokenPayload,
  secretKey: string
): Promise<string> {
  const payloadJson = JSON.stringify(payload);
  const encodedPayload = base64UrlEncode(textToBytes(payloadJson));
  
  const key = await getHmacKey(secretKey, ['sign']);
  const signatureBuffer = await crypto.subtle.sign(
    'HMAC',
    key,
    textToBytes(encodedPayload)
  );

  const signatureBytes = new Uint8Array(signatureBuffer);
  const encodedSignature = base64UrlEncode(signatureBytes);

  return `${encodedPayload}.${encodedSignature}`;
}

export interface VerificationResult {
  valid: boolean;
  payload?: MediaTokenPayload;
  reason?: string;
}

/**
 * Validates a signed media token at the edge:
 * 1. Verifies HMAC-SHA256 cryptographic signature.
 * 2. Validates timestamp expiration (exp).
 * 3. Validates path match (exact or prefix matching for child segments).
 * 4. Checks client IP and ASN binding if configured in token.
 * 5. Checks KV for explicit token revocation (jti).
 */
export async function verifyMediaToken(
  tokenString: string,
  requestPath: string,
  request: Request,
  env: Env
): Promise<VerificationResult> {
  if (!tokenString) {
    return { valid: false, reason: 'Missing authorization token' };
  }

  const parts = tokenString.split('.');
  if (parts.length !== 2) {
    return { valid: false, reason: 'Malformed token structure' };
  }

  const [encodedPayload, encodedSignature] = parts;
  if (!encodedPayload || !encodedSignature) {
    return { valid: false, reason: 'Malformed token parts' };
  }

  try {
    // 1. Verify HMAC cryptographic signature
    const key = await getHmacKey(env.AUTH_SECRET_KEY, ['verify']);
    const signatureBytes = base64UrlDecode(encodedSignature);
    const dataBytes = textToBytes(encodedPayload);

    const isSignatureValid = await crypto.subtle.verify(
      'HMAC',
      key,
      signatureBytes as BufferSource,
      dataBytes as BufferSource
    );

    if (!isSignatureValid) {
      return { valid: false, reason: 'Invalid token signature' };
    }

    // 2. Parse payload
    const payloadJson = new TextDecoder().decode(base64UrlDecode(encodedPayload));
    const payload = JSON.parse(payloadJson) as MediaTokenPayload;

    const now = Math.floor(Date.now() / 1000);

    // 3. Check expiration
    if (payload.exp && payload.exp < now) {
      return { valid: false, payload, reason: 'Token expired' };
    }

    // 4. Check Path authorization
    // Payload path can be an exact path (/stream/video.m3u8) or a directory prefix (/stream/live1/)
    const normalizedRequestPath = requestPath.toLowerCase();
    const normalizedTokenPath = payload.path.toLowerCase();

    const isExactMatch = normalizedRequestPath === normalizedTokenPath;
    const isPrefixMatch = normalizedTokenPath.endsWith('/') && normalizedRequestPath.startsWith(normalizedTokenPath);
    const isParentDirMatch = normalizedRequestPath.startsWith(normalizedTokenPath.substring(0, normalizedTokenPath.lastIndexOf('/') + 1));

    if (!isExactMatch && !isPrefixMatch && !isParentDirMatch) {
      return { valid: false, payload, reason: `Path mismatch: authorized for ${payload.path}` };
    }

    // 5. Check Client IP Binding (if token was locked to specific IP)
    if (payload.ip) {
      const clientIp = request.headers.get('cf-connecting-ip') || '';
      if (clientIp !== payload.ip) {
        return { valid: false, payload, reason: 'Client IP mismatch' };
      }
    }

    // 6. Check Client ASN Binding (if token was locked to specific ASN)
    if (payload.asn) {
      const cfProps = (request as unknown as { cf?: { asn?: number } }).cf;
      if (cfProps?.asn && cfProps.asn !== payload.asn) {
        return { valid: false, payload, reason: 'Client ASN mismatch' };
      }
    }

    // 7. Check KV Revocation List (for immediate stream cutoff / piracy mitigation)
    if (payload.jti && env.REVOKED_TOKENS_KV) {
      const isRevoked = await env.REVOKED_TOKENS_KV.get(payload.jti);
      if (isRevoked) {
        return { valid: false, payload, reason: 'Token has been revoked' };
      }
    }

    return { valid: true, payload };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Token verification error';
    return { valid: false, reason: message };
  }
}

/**
 * Extracts the token from query param (?token=... or ?hdnts=...) or Authorization header
 */
export function extractTokenFromRequest(request: Request, url: URL): string | null {
  // Query param 'token'
  const queryToken = url.searchParams.get('token') || url.searchParams.get('hdnts');
  if (queryToken) {
    return queryToken;
  }

  // Authorization: Bearer <token>
  const authHeader = request.headers.get('Authorization');
  if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
    return authHeader.substring(7).trim();
  }

  // Cookie: media_token=<token>
  const cookieHeader = request.headers.get('Cookie');
  if (cookieHeader) {
    const match = cookieHeader.match(/(?:^|;\s*)media_token=([^;]+)/);
    if (match && match[1]) {
      return match[1];
    }
  }

  return null;
}

