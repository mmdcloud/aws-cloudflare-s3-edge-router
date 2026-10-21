/**
 * Dynamic Edge HLS Manifest Rewriter (TransformStream & Streaming Parser)
 * Intercepts master and media playlists (.m3u8) to:
 * 1. Inject short-lived HMAC authorization tokens into child playlists and video segments.
 * 2. Dynamically steer or filter bitrate variants based on cf-ipcountry and client bandwidth/RTT heuristics.
 */

export interface HlsRewriteOptions {
  manifestText: string;
  token?: string;
  clientCountry?: string;
  clientTcpRtt?: number; // milliseconds
  enableGeoSteering?: boolean;
  bandwidthCapBps?: number;
  requestUrl: URL;
}

interface StreamVariant {
  infoLine: string;
  uriLine: string;
  bandwidth: number;
  resolution?: string;
}

/**
 * Rewrites an HLS Master or Media playlist
 */
export function rewriteHlsManifest(options: HlsRewriteOptions): string {
  const { manifestText, token, clientCountry, clientTcpRtt, enableGeoSteering, bandwidthCapBps } = options;
  const lines = manifestText.split(/\r?\n/);
  const outputLines: string[] = [];

  const isMasterPlaylist = manifestText.includes('#EXT-X-STREAM-INF');

  if (isMasterPlaylist) {
    // -------------------------------------------------------------------------
    // Master Playlist Processing
    // -------------------------------------------------------------------------
    const variants: StreamVariant[] = [];
    let currentInfoLine: string | null = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]?.trim();
      if (!line) {
        if (i < lines.length - 1) outputLines.push('');
        continue;
      }

      if (line.startsWith('#EXT-X-STREAM-INF:')) {
        currentInfoLine = line;
      } else if (currentInfoLine && !line.startsWith('#')) {
        // This line is the URI for the variant stream
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
        // Tag or header line (e.g. #EXTM3U, #EXT-X-VERSION)
        outputLines.push(line);
      }
    }

    // Dynamic Bandwidth & Geo adaptation
    // If client RTT is high (> 300ms) or bandwidth cap is set, sort or filter out 4K/ultra-high bitrates
    let filteredVariants = variants;

    if (enableGeoSteering) {
      if (bandwidthCapBps && bandwidthCapBps > 0) {
        const capped = variants.filter(v => v.bandwidth <= bandwidthCapBps);
        if (capped.length > 0) {
          filteredVariants = capped;
        }
      } else if (clientTcpRtt && clientTcpRtt > 250) {
        // High latency connection: ensure low/medium bitrates are prioritized for immediate TTFF
        filteredVariants = [...variants].sort((a, b) => a.bandwidth - b.bandwidth);
      }
    }

    // Emit rewritten variants with token injected into playlist URI
    for (const v of filteredVariants) {
      outputLines.push(v.infoLine);
      outputLines.push(injectTokenIntoUri(v.uriLine, token));
    }

    // Add telemetry comment
    if (clientCountry) {
      outputLines.push(`## CF-Geo: ${clientCountry} | RTT: ${clientTcpRtt || 0}ms`);
    }

    return outputLines.join('\n');
  } else {
    // -------------------------------------------------------------------------
    // Media (Variant) Playlist Processing
    // -------------------------------------------------------------------------
    for (const line of lines) {
      const trimmed = line.trim();

      if (!trimmed) {
        outputLines.push(line);
        continue;
      }

      // Handle DRM / AES-128 Key URI
      if (trimmed.startsWith('#EXT-X-KEY:')) {
        const rewrittenKeyLine = trimmed.replace(/URI="([^"]+)"/, (_match, uri) => {
          return `URI="${injectTokenIntoUri(uri, token)}"`;
        });
        outputLines.push(rewrittenKeyLine);
        continue;
      }

      // Handle Initialization Segment (#EXT-X-MAP:URI="init.mp4")
      if (trimmed.startsWith('#EXT-X-MAP:')) {
        const rewrittenMapLine = trimmed.replace(/URI="([^"]+)"/, (_match, uri) => {
          return `URI="${injectTokenIntoUri(uri, token)}"`;
        });
        outputLines.push(rewrittenMapLine);
        continue;
      }

      // Handle Media Segment URI (lines not starting with #)
      if (!trimmed.startsWith('#')) {
        outputLines.push(injectTokenIntoUri(trimmed, token));
        continue;
      }

      // Pass through other tags (#EXTINF, #EXT-X-TARGETDURATION, etc.)
      outputLines.push(line);
    }

    return outputLines.join('\n');
  }
}

/**
 * Injects token parameter into a relative or absolute URI
 */
function injectTokenIntoUri(uri: string, token?: string): string {
  if (!token) {
    return uri;
  }

  const hashIndex = uri.indexOf('#');
  const hash = hashIndex !== -1 ? uri.substring(hashIndex) : '';
  const cleanUri = hashIndex !== -1 ? uri.substring(0, hashIndex) : uri;

  const separator = cleanUri.includes('?') ? '&' : '?';
  return `${cleanUri}${separator}token=${encodeURIComponent(token)}${hash}`;
}

/**
 * Creates a streaming TransformStream to rewrite HLS playlists on the fly
 */
export function createHlsTransformStream(options: Omit<HlsRewriteOptions, 'manifestText'>): TransformStream<Uint8Array, Uint8Array> {
  let buffer = '';
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();

  return new TransformStream({
    transform(chunk, _controller) {
      buffer += decoder.decode(chunk, { stream: true });
    },
    flush(controller) {
      buffer += decoder.decode();
      const rewritten = rewriteHlsManifest({
        ...options,
        manifestText: buffer,
      });
      controller.enqueue(encoder.encode(rewritten));
    },
  });
}

