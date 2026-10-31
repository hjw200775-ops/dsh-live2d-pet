#!/usr/bin/env node
/**
 * 从 GitHub Release 下载 DeepSeek-chan 模型包，校验 sha256 后解压。
 *
 *   npm run fetch-model -- --dest ./model
 *   node scripts/fetch-model.mjs --dest "C:\\Users\\me\\.dsh\\live2d" --force
 *
 * 说明：
 *  - 模型由 Kamiya Ryoko 发布并授权本仓库的 Release 附件分发，本脚本只做下载与校验；
 *  - Live2D Cubism Core 不包含在内，需要自行从 Live2D 官网获取；
 *  - 下载后请勿把模型提交进任何仓库。
 */
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const OWNER = 'hjw200775-ops';
export const REPO = 'dsh-live2d-pet-';
export const TAG = 'v0.6.1';
export const ASSET = 'DeepSeek-chan_model_for_dsh-live2d-pet_v1.zip';
export const MODEL_SHA256 = 'e661bad675bc1d29213b2906dde8a1e1069ee5b721e9c06a71b6e9317db892bc';
export const MODEL_ENTRY = path.join('DeepSeek-chan', '大肥鱼.model3.json');

export function buildUrl(tag = TAG, asset = ASSET) {
  return `https://github.com/${OWNER}/${REPO}/releases/download/${tag}/${encodeURIComponent(asset)}`;
}

export function sha256Hex(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

export function parseArgs(argv) {
  const out = { dest: './model', tag: TAG, force: false, sha256: MODEL_SHA256 };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dest') out.dest = argv[++i];
    else if (arg === '--tag') out.tag = argv[++i];
    else if (arg === '--sha256') out.sha256 = argv[++i];
    else if (arg === '--force') out.force = true;
    else if (arg === '--help' || arg === '-h') out.help = true;
    else throw new Error(`未知参数：${arg}`);
  }
  return out;
}

async function download(url) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`下载失败 HTTP ${res.status}：${url}`);
  const total = Number(res.headers.get('content-length') || 0);
  const chunks = [];
  let got = 0;
  for await (const chunk of res.body) {
    chunks.push(chunk);
    got += chunk.length;
    if (total) process.stdout.write(`\r  下载中 ${(got / 1048576).toFixed(1)} / ${(total / 1048576).toFixed(1)} MB`);
  }
  if (total) process.stdout.write('\n');
  return Buffer.concat(chunks);
}

function extract(zip, dest) {
  const attempts = process.platform === 'win32'
    ? [['tar', ['-xf', zip, '-C', dest]]]
    : [['unzip', ['-oq', zip, '-d', dest]], ['tar', ['-xf', zip, '-C', dest]]];
  const errors = [];
  for (const [cmd, args] of attempts) {
    const r = spawnSync(cmd, args, { stdio: 'inherit' });
    if (!r.error && r.status === 0) return;
    errors.push(`${cmd}: ${r.error?.message || `exit ${r.status}`}`);
  }
  throw new Error(`解压失败（${errors.join('; ')}）。可手动解压：${zip}`);
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log('用法: node scripts/fetch-model.mjs --dest <目录> [--tag v0.6.1] [--force]');
    return 0;
  }

  const dest = path.resolve(args.dest);
  const entry = path.join(dest, MODEL_ENTRY);
  const url = buildUrl(args.tag);

  console.log(`模型包：${ASSET}`);
  console.log(`来源  ：${url}`);
  console.log(`目标  ：${dest}`);

  try {
    const existing = await readFile(entry);
    if (existing.length > 0 && !args.force) {
      console.log(`\n目标已存在：${entry}\n如需覆盖请加 --force`);
      return 0;
    }
  } catch { /* 不存在，继续 */ }

  console.log('\n下载中…');
  const buffer = await download(url);

  const digest = sha256Hex(buffer);
  if (digest !== args.sha256.toLowerCase()) {
    throw new Error(`sha256 校验失败\n  期望 ${args.sha256}\n  实际 ${digest}`);
  }
  console.log(`sha256 校验通过：${digest}`);

  const tmp = path.join(dest, '.model-download.zip');
  await mkdir(dest, { recursive: true });
  await writeFile(tmp, buffer);
  try {
    extract(tmp, dest);
  } finally {
    await rm(tmp, { force: true });
  }

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
