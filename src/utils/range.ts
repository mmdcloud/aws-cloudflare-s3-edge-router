/**
 * HTTP Byte-Range Parser and Range Response Utilities
 * Supports standard HTTP 206 Partial Content scrubbing for video players (HLS/DASH/MP4).
 */

import { ParsedByteRange } from '../types/env';

/**
 * Parses the HTTP 'Range' header (e.g. 'bytes=0-1048575' or 'bytes=1024-')
 */
export function parseRangeHeader(rangeHeader: string | null, totalContentLength?: number): ParsedByteRange | null {
  if (!rangeHeader || !rangeHeader.startsWith('bytes=')) {
    return null;
  }

  const rangeSpec = rangeHeader.substring(6).trim();
  // Support single range (first range if multiple comma-separated)
  const firstRange = rangeSpec.split(',')[0]?.trim();
  if (!firstRange) {
    return null;
  }

  const parts = firstRange.split('-');
  if (parts.length !== 2) {
    return null;
  }

  const startStr = parts[0]?.trim();
  const endStr = parts[1]?.trim();

  let start: number;
  let end: number;

  if (startStr === '' && endStr !== undefined && endStr !== '') {
    // Suffix range: bytes=-500 (last 500 bytes)
    const suffixLength = parseInt(endStr, 10);
    if (isNaN(suffixLength) || suffixLength <= 0) {
      return null;
    }
    if (totalContentLength !== undefined) {
      start = Math.max(0, totalContentLength - suffixLength);
      end = totalContentLength - 1;
    } else {
      // Cannot resolve suffix range without total length
      return null;
    }
  } else if (startStr !== undefined && startStr !== '') {
    start = parseInt(startStr, 10);
    if (isNaN(start) || start < 0) {
      return null;
    }

    if (endStr !== undefined && endStr !== '') {
      end = parseInt(endStr, 10);
      if (isNaN(end) || end < start) {
        return null;
      }
      if (totalContentLength !== undefined && end >= totalContentLength) {
        end = totalContentLength - 1;
      }
    } else {
      // Open-ended range: bytes=1000-
      if (totalContentLength !== undefined) {
        end = totalContentLength - 1;
      } else {
        // Assume slice up to length
        end = Number.MAX_SAFE_INTEGER;
      }
    }
  } else {
    return null;
  }

  const length = end - start + 1;
  return {
    start,
    end,
    total: totalContentLength,
    length,
    isPartial: true
  };
}

/**
 * Builds Content-Range header value (e.g. 'bytes 0-1048575/5242880')
 */
export function buildContentRangeHeader(start: number, end: number, total?: number): string {
  const totalStr = total !== undefined ? total.toString() : '*';
  return `bytes ${start}-${end}/${totalStr}`;
}

