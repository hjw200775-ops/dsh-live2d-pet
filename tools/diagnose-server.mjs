import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectModel } from '../src/model.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const outDir = path.join(root, 'qa');
const configPath = process.argv[2] || 'C:\\Users\\huang\\.dsh\\live2d\\config.json';
const config = JSON.parse(await readFile(configPath, 'utf8'));
const inspected = await inspectModel(config.modelFile);
const fallbackPkg = 'C:/Users/huang/Documents/Codex/2026-10-30/referenced-chatgpt-conversation-this-is-an-4/outputs/dsh-deepseek-live2d/package.json';
const require = createRequire(existsSync(path.join(root, 'node_modules/pixi.js/package.json')) ? path.join(root, 'package.json') : fallbackPkg);
const pixi = path.resolve(path.dirname(require.resolve('pixi.js')), '../browser/pixi.min.js');
const live2d = path.join(path.dirname(require.resolve('pixi-live2d-display')), 'cubism4.min.js');
const staticFiles = new Map([
  ['diagnose.html', path.join(root, 'tools/diagnose.html')],
  ['cubism-color.js', path.join(root, 'renderer/cubism-color.js')],
  ['core.js', config.coreFile],
  ['pixi.js', pixi],
  ['live2d.js', live2d],
]);

await mkdir(outDir, { recursive: true });
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (req.method === 'POST' && url.pathname === '/report') {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const saved = [];
      for (const shot of body.shots || []) {
        const name = String(shot.name || 'shot').replace(/[^a-z0-9._-]+/gi, '_');
        const file = path.join(outDir, `${name}.png`);
        await writeFile(file, Buffer.from(String(shot.png).replace(/^data:image\/png;base64,/, ''), 'base64'));
        saved.push(file);
      }
      const reportFile = path.join(outDir, 'diagnose-report.json');
      await writeFile(reportFile, JSON.stringify({ ...body, shots: (body.shots || []).map(s => s.name) }, null, 2));
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: true, reportFile, saved }));
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return; }
    const key = decodeURIComponent(url.pathname.replace(/^\//, ''));
    let file = staticFiles.get(key);
    let type = 'application/octet-stream';
    if (key === '' || key === 'diagnose.html') { file = staticFiles.get('diagnose.html'); type = 'text/html; charset=utf-8'; }
    else if (key === 'core.js' || key === 'pixi.js' || key === 'live2d.js') type = 'text/javascript; charset=utf-8';
    else if (key === 'model/model.model3.json') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify(inspected.model));
      return;
    } else if (key.startsWith('model/')) {
      file = inspected.allowed.get(key.slice(6));
      type = key.endsWith('.png') ? 'image/png' : key.endsWith('.json') ? 'application/json; charset=utf-8' : 'application/octet-stream';
    }
    if (!file) { res.writeHead(404).end('not found'); return; }
    const bytes = await readFile(file);
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' }).end(req.method === 'HEAD' ? undefined : bytes);
  } catch (error) {
    res.writeHead(500).end(String(error && error.stack || error));
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const address = `http://127.0.0.1:${server.address().port}/diagnose.html`;
console.log(JSON.stringify({ url: address, mocVersion: inspected.report.mocVersion, textures: inspected.report.textures, outDir }));
