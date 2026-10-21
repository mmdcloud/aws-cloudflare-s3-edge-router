/**
 * Dynamic Edge DASH MPD Manifest Rewriter
 * Injects HMAC tokens and session parameters into DASH (.mpd) manifests.
 */

export interface DashRewriteOptions {
  manifestText: string;
  token?: string;
  clientCountry?: string;
  requestUrl: URL;
}

/**
 * Rewrites a DASH MPD manifest to inject session security tokens into segment templates and BaseURLs.
 */
export function rewriteDashManifest(options: DashRewriteOptions): string {
  const { manifestText, token } = options;
  if (!token) {
    return manifestText;
  }

  const encodedToken = encodeURIComponent(token);

  // 1. Rewrite existing BaseURL tags: <BaseURL>url</BaseURL>
  let rewritten = manifestText.replace(/<BaseURL>([^<]+)<\/BaseURL>/g, (_match, url: string) => {
    const separator = url.includes('?') ? '&' : '?';
    return `<BaseURL>${url}${separator}token=${encodedToken}</BaseURL>`;
  });

  // 2. If no BaseURL tag exists, inject token into SegmentTemplate media and initialization attributes
  rewritten = rewritten.replace(/media="([^"]+)"/g, (match, mediaUrl: string) => {
    if (mediaUrl.includes('token=')) return match;
    const separator = mediaUrl.includes('?') ? '&' : '?';
    return `media="${mediaUrl}${separator}token=${encodedToken}"`;
  });

  rewritten = rewritten.replace(/initialization="([^"]+)"/g, (match, initUrl: string) => {
    if (initUrl.includes('token=')) return match;
    const separator = initUrl.includes('?') ? '&' : '?';
    return `initialization="${initUrl}${separator}token=${encodedToken}"`;
  });

  return rewritten;
}

