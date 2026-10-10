import { createServer } from 'node:http';
import { createPracticeHandler } from './routes.js';

const port = Number(process.env.PORT || 3001);
const host = process.env.HOST || '127.0.0.1';

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535.');
}

const server = createServer(createPracticeHandler());
server.on('error', (error) => {
  console.error('Backend failed to start:', error.message);
  process.exitCode = 1;
});
server.listen(port, host, () => {
  console.info(`feynman.ai API: http://${host}:${port}/api/health`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => server.close());
}
