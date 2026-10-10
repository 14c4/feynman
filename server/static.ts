import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { gzipSync } from 'node:zlib';
import type { IncomingMessage, ServerResponse } from 'node:http';

/*
 * Serves the built Vite frontend (`dist/`) from the API process, so the app and `/api` share one
 * origin in production. Unknown page routes fall back to index.html for client-side routing;
 * a missing file with an extension (e.g. an old /assets/*.js) is a real 404.
 */

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.webmanifest': 'application/manifest+json',
  '.wasm': 'application/wasm', '.map': 'application/json; charset=utf-8', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
};
const COMPRESSIBLE = new Set(['.html', '.js', '.mjs', '.css', '.json', '.svg', '.txt', '.webmanifest', '.map']);

/** Headers applied to every page and asset response. */
export const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
  // Camera and microphone are used only by this origin, and only after the learner opts in.
  'Permissions-Policy': 'camera=(self), microphone=(self), geolocation=()',
};

interface Cached { body: Buffer; gzip?: Buffer; type: string }

export function createStaticHandler(root: string) {
  const base = resolve(root);
  const cache = new Map<string, Cached>();
  const load = (file: string): Cached => {
    const hit = cache.get(file); if (hit) return hit;
    const ext = extname(file).toLowerCase(); const body = readFileSync(file);
    const entry: Cached = { body, type: TYPES[ext] ?? 'application/octet-stream', gzip: COMPRESSIBLE.has(ext) && body.length > 1024 ? gzipSync(body) : undefined };
    cache.set(file, entry); return entry;
  };
  const isFile = (file: string) => { try { return statSync(file).isFile(); } catch { return false; } };

  /** Returns false when the request is not a page or asset request (so the caller can 404 it). */
  return function serveStatic(req: IncomingMessage, res: ServerResponse): boolean {
    if (req.method !== 'GET' && req.method !== 'HEAD') return false;
    let pathname: string;
    try { pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname); } catch { return false; }
    if (pathname.includes('\0')) return false;
    let file = resolve(join(base, normalize(pathname)));
    if (file !== base && !file.startsWith(base + sep)) return false;
    const hasExtension = extname(pathname) !== '';
    if (!isFile(file)) {
      if (hasExtension) return false;
      file = join(base, 'index.html');
      if (!isFile(file)) return false;
    }
    const entry = load(file);
    const html = entry.type.startsWith('text/html');
    const gzip = entry.gzip && /\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''));
    const body = gzip ? entry.gzip! : entry.body;
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      'Content-Type': entry.type,
      'Content-Length': body.length,
      // Vite fingerprints everything under /assets; pages must revalidate so new deploys load.
      'Cache-Control': html ? 'no-cache' : pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'public, max-age=3600',
      Vary: 'Accept-Encoding',
      ...(gzip ? { 'Content-Encoding': 'gzip' } : {}),
    });
    res.end(req.method === 'HEAD' ? undefined : body);
    return true;
  };
}

export const hasBuild = (root: string) => existsSync(join(root, 'index.html'));
