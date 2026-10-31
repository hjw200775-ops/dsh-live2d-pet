#!/usr/bin/env node
/**
 * 从 GitHub Release 下载 DeepSeek-chan 模型包，校验 sha256 后解压。
 *
 *   npx dsh-live2d-fetch-model --dest "$env:USERPROFILE\.dsh\live2d"
 *   node scripts/fetch-model.mjs --dest "D:\\live2d" --force
 *
 * 下载走 api.github.com 的资源接口（再重定向到对象存储），
 * 这样即使 github.com 的网页/下载域名被网络环境阻断也能用；失败时回退到直链。
 *
 * 说明：
 *  - 模型由 Kamiya Ryoko 发布并授权本仓库的 Release 附件分发，本脚本只做下载与校验；
 *  - Live2D Cubism Core 不包含在内，需要自行从 Live2D 官网获取；
 *  - 下载后请勿把模型提交进任何仓库。
 */
import { createHash } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const DEFAULT_DEST = path.join(homedir(), '.dsh', 'live2d');

export const OWNER = 'hjw200775-ops';
export const REPO = 'dsh-live2d-pet-';
export const TAG = 'v0.6.1';
export const ASSET = 'DeepSeek-chan_model_for_dsh-live2d-pet_v1.zip';
export const MODEL_SHA256 = 'e661bad675bc1d29213b2906dde8a1e1069ee5b721e9c06a71b6e9317db892bc';
export const MODEL_ENTRY = path.join('DeepSeek-chan', '大肥鱼.model3.json');

const UA = 'dsh-live2d-fetch-model (+https://github.com/hjw200775-ops/dsh-live2d-pet-)';

export function buildUrl(tag = TAG, asset = ASSET) {
  return `https://github.com/${OWNER}/${REPO}/releases/download/${tag}/${encodeURIComponent(asset)}`;
}

export function buildApiUrl(tag = TAG) {
  return `https://api.github.com/repos/${OWNER}/${REPO}/releases/tags/${encodeURIComponent(tag)}`;
}

export function sha256Hex(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

export function parseArgs(argv) {
  const out = { dest: DEFAULT_DEST, tag: TAG, force: false, sha256: MODEL_SHA256, via: 'auto', url: '' };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dest') out.dest = argv[++i];
    else if (arg === '--tag') out.tag = argv[++i];
    else if (arg === '--url') out.url = argv[++i];
    else if (arg === '--sha256') out.sha256 = argv[++i];
    else if (arg === '--via') out.via = argv[++i];
    else if (arg === '--force') out.force = true;
    else if (arg === '--help' || arg === '-h') out.help = true;
    else throw new Error(`未知参数：${arg}`);
  }
  if (!['auto', 'api', 'direct'].includes(out.via)) throw new Error('--via 只能是 auto / api / direct');
  return out;
}

function apiHeaders() {
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': UA };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return headers;
}

/** 通过 API 找到资源条目，返回 { url, size }（url 是 API 资源地址，会重定向到对象存储）。 */
export async function resolveAsset(tag = TAG, asset = ASSET) {
  const res = await fetch(buildApiUrl(tag), {
    headers: apiHeaders(),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`GitHub API HTTP ${res.status}`);
  const data = await res.json();
  const found = (data.assets || []).find(item => item.name === asset);
  if (!found) throw new Error(`Release ${tag} 中没有 ${asset}`);
  return { url: found.url, size: found.size };
}

async function download(url, { accept = 'application/octet-stream', timeoutMs = 15 * 60 * 1000 } = {}) {
  const res = await fetch(url, {
    headers: { Accept: accept, 'User-Agent': UA },
    redirect: 'follow',
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`下载失败 HTTP ${res.status}`);
  const total = Number(res.headers.get('content-length') || 0);
  const chunks = [];
  let got = 0;
  for await (const chunk of res.body) {
    chunks.push(chunk);
    got += chunk.length;
    const pct = total ? ` ${((got / total) * 100).toFixed(1)}%` : '';
    process.stdout.write(`\r  下载中 ${(got / 1048576).toFixed(1)} MB${pct}   `);
  }
  process.stdout.write('\n');
  return Buffer.concat(chunks);
}

function decodeName(buf, flags) {
  if (flags & 0x800) return buf.toString('utf8');
  const utf8 = buf.toString('utf8');
  return utf8.includes('\uFFFD') ? buf.toString('latin1') : utf8;
}

/**
 * 自带 zip 解压：不依赖系统 tar/unzip，中文文件名在 Windows 上也正确。
 * 只支持 store(0) 与 deflate(8)，这两者是 npm 生态里 zip 的常规写法。
 */
export async function extractZip(buffer, dest) {
  let eocd = -1;
  const min = Math.max(0, buffer.length - 65557);
  for (let i = buffer.length - 22; i >= min; i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('不是有效的 zip（找不到目录结尾）');

  const count = buffer.readUInt16LE(eocd + 10);
  let p = buffer.readUInt32LE(eocd + 16);
  const entries = [];
  for (let i = 0; i < count; i++) {
    if (buffer.readUInt32LE(p) !== 0x02014b50) throw new Error('zip 目录损坏');
    const flags = buffer.readUInt16LE(p + 8);
    const method = buffer.readUInt16LE(p + 10);
    const csize = buffer.readUInt32LE(p + 20);
    const nlen = buffer.readUInt16LE(p + 28);
    const elen = buffer.readUInt16LE(p + 30);
    const clen = buffer.readUInt16LE(p + 32);
    const lho = buffer.readUInt32LE(p + 42);
    const name = decodeName(buffer.subarray(p + 46, p + 46 + nlen), flags);
    entries.push({ name, method, csize, lho });
    p += 46 + nlen + elen + clen;
  }

  let written = 0;
  for (const entry of entries) {
    const rel = entry.name.replace(/\\/g, '/');
    if (!rel || rel.endsWith('/')) continue;
    if (rel.startsWith('/') || rel.split('/').includes('..')) continue; // 防目录穿越
    const lho = entry.lho;
    if (buffer.readUInt32LE(lho) !== 0x04034b50) throw new Error(`zip 文件头损坏：${rel}`);
    const lnlen = buffer.readUInt16LE(lho + 26);
    const lelen = buffer.readUInt16LE(lho + 28);
    const start = lho + 30 + lnlen + lelen;
    const raw = buffer.subarray(start, start + entry.csize);
    let data;
    if (entry.method === 0) data = raw;
    else if (entry.method === 8) data = inflateRawSync(raw);
    else throw new Error(`不支持的压缩方式 ${entry.method}：${rel}`);

    const target = path.join(dest, ...rel.split('/'));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, data);
    written++;
  }
  return written;
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log('用法: dsh-live2d-fetch-model --dest <目录> [--tag v0.6.1] [--via auto|api|direct] [--force]');
    return 0;
  }

  const dest = path.resolve(args.dest);
  const entry = path.join(dest, MODEL_ENTRY);

  try {
    const existing = await readFile(entry);
    if (existing.length > 0 && !args.force) {
      console.log(`目标已存在：${entry}\n如需覆盖请加 --force`);
      return 0;
    }
  } catch { /* 不存在，继续 */ }

  console.log(`模型包：${ASSET}（tag ${args.tag}）`);
  console.log(`目标  ：${dest}`);

  let buffer;
  if (args.url) {
    console.log(`直连指定地址：${args.url}`);
    buffer = await download(args.url);
  } else if (args.via !== 'direct') {
    try {
      const asset = await resolveAsset(args.tag);
      console.log(`API 解析成功（${(asset.size / 1048576).toFixed(1)} MB），开始下载…`);
      buffer = await download(asset.url);
    } catch (error) {
      if (args.via === 'api') throw error;
      console.log(`API 通道不可用（${error.message}），回退直链…`);
    }
  }
  if (!buffer) {
    console.log(`直链：${buildUrl(args.tag)}`);
    buffer = await download(buildUrl(args.tag));
  }

  const digest = sha256Hex(buffer);
  if (digest !== args.sha256.toLowerCase()) {
    throw new Error(`sha256 校验失败\n  期望 ${args.sha256}\n  实际 ${digest}`);
  }
  console.log(`sha256 校验通过：${digest}`);

  await mkdir(dest, { recursive: true });
  const written = await extractZip(buffer, dest);
  console.log(`解压完成：${written} 个文件`);

  const check = await readFile(entry);
  console.log(`\n完成：${entry}（${(check.length / 1024 / 1024).toFixed(1)} MB）`);
  console.log('\n下一步：把 config.json 指向这个模型，并单独准备 Live2D Cubism Core：');
  console.log(JSON.stringify({
    modelFile: entry,
    coreFile: path.join('<core 目录>', 'live2dcubismcore.min.js'),
  }, null, 2));
  return 0;
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().catch(error => {
    console.error(`\n错误：${error.message}`);
    process.exit(1);
  });
}
