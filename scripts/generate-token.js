#!/usr/bin/env node

/**
 * CLI Utility: Generate Signed Media Playback Tokens
 * Uses Node.js native crypto module (compatible with WebCrypto HMAC-SHA256).
 *
 * Usage:
 *   node scripts/generate-token.js --path=/stream/live/master.m3u8 --secret=my-secret-key --ttl=3600
 *   node scripts/generate-token.js -p /stream/vod/index.mpd -s supersecret -t 7200 --ip 203.0.113.195
 */

import crypto from 'node:crypto';

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    path: '/stream/live/master.m3u8',
    secret: process.env.AUTH_SECRET_KEY || 'default-media-secret-change-in-prod',
    ttl: 3600, // 1 hour
    ip: null,
    asn: null,
    sid: `session-${Date.now()}`,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--path=')) {
      options.path = arg.split('=')[1];
    } else if (arg === '-p' && args[i + 1]) {
      options.path = args[++i];
    } else if (arg.startsWith('--secret=')) {
      options.secret = arg.split('=')[1];
    } else if (arg === '-s' && args[i + 1]) {
      options.secret = args[++i];
    } else if (arg.startsWith('--ttl=')) {
      options.ttl = parseInt(arg.split('=')[1], 10);
    } else if (arg === '-t' && args[i + 1]) {
      options.ttl = parseInt(args[++i], 10);
    } else if (arg.startsWith('--ip=')) {
      options.ip = arg.split('=')[1];
    } else if (arg.startsWith('--asn=')) {
      options.asn = parseInt(arg.split('=')[1], 10);
    } else if (arg.startsWith('--sid=')) {
      options.sid = arg.split('=')[1];
    }
  }

  return options;
}

function base64UrlEncode(str) {
  return Buffer.from(str)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function generateToken(payload, secret) {
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = crypto
    .createHmac('sha256', secret)
    .update(encodedPayload)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  return `${encodedPayload}.${signature}`;
}

function main() {
  const options = parseArgs();
  const now = Math.floor(Date.now() / 1000);
  const exp = now + options.ttl;

  const payload = {
    path: options.path,
    exp: exp,
    sid: options.sid,
  };

  if (options.ip) payload.ip = options.ip;
  if (options.asn) payload.asn = options.asn;

  const token = generateToken(payload, options.secret);

  console.log('\n======================================================');
  console.log('   High-Throughput Edge Media Streaming Router');
  console.log('          HMAC Token Generator CLI');
  console.log('======================================================\n');
  console.log('Payload Config:');
  console.log(`  Path:       ${payload.path}`);
  console.log(`  Issued At:  ${new Date(now * 1000).toISOString()}`);
  console.log(`  Expires At: ${new Date(exp * 1000).toISOString()} (in ${options.ttl}s)`);
  if (payload.ip) console.log(`  Locked IP:  ${payload.ip}`);
  if (payload.asn) console.log(`  Locked ASN: ${payload.asn}`);
  console.log(`  Session ID: ${payload.sid}`);
  console.log('\nGenerated Token:');
  console.log(`  ${token}`);
  console.log('\nPlayback URL Example:');
  const separator = options.path.includes('?') ? '&' : '?';
  console.log(`  https://media.yourdomain.com${options.path}${separator}token=${token}`);
  console.log('\nCurl Test:');
  console.log(`  curl -i "https://media.yourdomain.com${options.path}${separator}token=${token}"`);
  console.log('======================================================\n');
}

main();
