import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSseDecoder, createSseParser, encodeSseFrame } from '../../src/features/chat/sse.mjs';

function collect() {
  const frames = [];
  const parser = createSseParser({ onFrame: frame => frames.push(frame) });
  return { frames, parser };
}

test('编码后能被解析回同一份 JSON 数据', () => {
  const text = encodeSseFrame({ event: 'delta', data: { type: 'delta', text: '你好，世界' } });
  const { frames, parser } = collect();
  parser.push(text);
  parser.end();
  assert.equal(frames.length, 1);
  assert.equal(frames[0].event, 'delta');
  assert.deepEqual(JSON.parse(frames[0].data), { type: 'delta', text: '你好，世界' });
});

test('跨任意字符串切分也能还原事件', () => {
  const stream = encodeSseFrame({ event: 'a', data: { n: 1 } }) + encodeSseFrame({ event: 'b', data: { n: 2 } });
  const { frames, parser } = collect();
  for (const char of stream) parser.push(char);
  parser.end();
  assert.deepEqual(frames.map(frame => frame.event), ['a', 'b']);
  assert.deepEqual(frames.map(frame => JSON.parse(frame.data).n), [1, 2]);
});

test('支持 CRLF / CR / LF 三种换行', () => {
  const variants = [
    'event: x\r\ndata: {"a":1}\r\n\r\n',
    'event: x\rdata: {"a":1}\r\r',
    'event: x\ndata: {"a":1}\n\n',
  ];
  for (const variant of variants) {
    const { frames, parser } = collect();
    parser.push(variant);
    parser.end();
    assert.equal(frames.length, 1, JSON.stringify(variant));
    assert.equal(JSON.parse(frames[0].data).a, 1);
  }
});

test('多行 data 用换行拼接，注释行被忽略，[DONE] 不产生事件', () => {
  const { frames, parser } = collect();
  parser.push(': keepalive\n\n');
  parser.push('event: multi\ndata: line1\ndata: line2\n\n');
  parser.push('data: [DONE]\n\n');
  parser.end();
  assert.equal(frames.length, 1);
  assert.equal(frames[0].data, 'line1\nline2');
  assert.equal(frames[0].event, 'multi');
});

test('最后一行没有空行时由 end() 补发', () => {
  const { frames, parser } = collect();
  parser.push('event: tail\ndata: {"z":9}\n');
  parser.end();
  assert.equal(frames.length, 1);
  assert.equal(JSON.parse(frames[0].data).z, 9);
});

test('UTF-8 多字节字符被网络块切断时不乱码', () => {
  const payload = encodeSseFrame({ event: 'delta', data: { text: '中文🙂' } });
  const bytes = new TextEncoder().encode(payload);
  const frames = [];
  const decoder = createSseDecoder({ onFrame: frame => frames.push(frame) });
  // 故意在“中”字的 3 个字节中间、以及 emoji 的 4 字节中间切开
  const cuts = [1, 2, 4, 7, bytes.length];
  let last = 0;
  for (const cut of cuts) {
    if (cut <= last) continue;
    decoder.push(bytes.subarray(last, cut));
    last = cut;
  }
  decoder.end();
  assert.equal(frames.length, 1);
  assert.equal(JSON.parse(frames[0].data).text, '中文🙂');
});

test('CRLF 被拆到两个网络块时不会提前分帧', () => {
  const stream = 'event: x\r\ndata: {"a":1}\r\n\r\n';
  for (let cut = 1; cut < stream.length; cut++) {
    const { frames, parser } = collect();
    parser.push(stream.slice(0, cut));
    parser.push(stream.slice(cut));
    parser.end();
    assert.equal(frames.length, 1, `cut=${cut} 产生了 ${frames.length} 帧`);
    assert.equal(JSON.parse(frames[0].data).a, 1);
  }
});

test('末尾只有 \\r 时等待下一块，end() 时按行结束处理', () => {
  const { frames, parser } = collect();
  parser.push('event: tail\r');
  assert.equal(frames.length, 0, '不应在只有 \\r 时提前分帧');
  parser.push('data: {"b":2}\r\r');
  parser.end();
  assert.equal(frames.length, 1);
  assert.equal(JSON.parse(frames[0].data).b, 2);

  const second = collect();
  second.parser.push('event: e\ndata: {"c":3}\n');
  second.parser.end();
  assert.equal(second.frames.length, 1);
});