import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';

// `npm start` passes --production so NODE_ENV need not be set on the host (setting it there would
// make `npm ci` skip the devDependencies the build needs). Set before the API modules load.
if (process.argv.includes('--production')) process.env.NODE_ENV ??= 'production';
const production = process.env.NODE_ENV === 'production';

const { createPracticeHandler } = await import('./routes.js');
const { createStaticHandler, hasBuild, SECURITY_HEADERS } = await import('./static.js');

const port = Number(process.env.PORT || 3001);
// Platforms such as Railway route traffic to the container's public interface, not loopback.
const host = process.env.HOST || (production ? '0.0.0.0' : '127.0.0.1');

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535.');
}

const api = createPracticeHandler();
const distDir = fileURLToPath(new URL('../dist/', import.meta.url));
const serveFrontend = process.env.SERVE_STATIC !== 'off' && hasBuild(distDir);
const serveStatic = serveFrontend ? createStaticHandler(distDir) : undefined;
if (production && !serveFrontend) console.warn('dist/index.html not found: serving the API only. Run `npm run build` before `npm start`.');

const server = createServer((req, res) => {
  const path = (req.url ?? '/').split('?')[0]!;
  if (path === '/api' || path.startsWith('/api/')) { void api(req, res); return; }
  if (serveStatic?.(req, res)) return;
  res.writeHead(404, { ...SECURITY_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not found');
});
// Grading and preparation can take over a minute; keep slow uploads from holding sockets forever.
server.requestTimeout = 5 * 60_000;
server.headersTimeout = 30_000;
server.keepAliveTimeout = 65_000;
server.on('error', (error) => {
  console.error('Backend failed to start:', error.message);
  process.exitCode = 1;
});
server.listen(port, host, () => {
  console.info(`feynman.ai ${production ? 'production' : 'development'} server on http://${host}:${port} (health: /api/health${serveFrontend ? ', frontend: /' : ''})`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close();
    // Give in-flight requests a moment, then drop idle keep-alive sockets so the process can exit.
    setTimeout(() => server.closeAllConnections(), 10_000).unref();
    server.closeIdleConnections();
  });
}
