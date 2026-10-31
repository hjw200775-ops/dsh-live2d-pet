import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ASSET,
  MODEL_SHA256,
  TAG,
  buildUrl,
  parseArgs,
  sha256Hex,
} from '../scripts/fetch-model.mjs';

test('模型下载地址指向本仓库的 release 附件', () => {
  const url = buildUrl();
  assert.match(url, /^https:\/\/github\.com\/hjw200775-ops\/dsh-live2d-pet-\/releases\/download\//);
  assert.ok(url.includes(TAG));
  assert.ok(url.endsWith(encodeURIComponent(ASSET)));
});

test('内置的 sha256 是一个合法的 64 位十六进制串', () => {
  assert.match(MODEL_SHA256, /^[0-9a-f]{64}$/);
  assert.equal(sha256Hex(Buffer.from('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('参数解析支持 dest/tag/sha256/force，并拒绝未知参数', () => {
  const opts = parseArgs(['--dest', '/tmp/m', '--tag', 'v1', '--sha256', 'aa', '--force']);
  assert.equal(opts.dest, '/tmp/m');
  assert.equal(opts.tag, 'v1');
  assert.equal(opts.sha256, 'aa');
  assert.equal(opts.force, true);
  assert.throws(() => parseArgs(['--nope']), /未知参数/);
});
