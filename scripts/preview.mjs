import { readFile } from 'node:fs/promises';
import { startViewer } from '../src/viewer-server.js';
const configPath = process.argv[2] || process.env.DSH_LIVE2D_CONFIG;
if (!configPath) throw new Error('Usage: node scripts/preview.mjs <absolute local.config.json path>');
const viewer = await startViewer(JSON.parse(await readFile(configPath, 'utf8')));
console.log(JSON.stringify({ url: viewer.url, report: viewer.report, error: viewer.error }));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await viewer.close(); process.exit(0); });
