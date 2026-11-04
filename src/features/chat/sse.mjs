/**
 * 极简 SSE 编解码。
 *
 * 浏览器端不能直接用 EventSource（它只支持 GET），所以服务端写 SSE 文本、
 * 客户端用 fetch + ReadableStream 读取后再用这里的 parser 还原事件。
 * parser 必须能处理：跨网络块的事件、CRLF/LF/CR 三种换行、多行 data、注释与结束标记。
 */

/** 把一帧编码成 SSE 文本。data 会被 JSON 序列化成单行，避免多行 data 的歧义。 */
export function encodeSseFrame({ event, data, id }) {
  let out = '';
  if (id !== undefined) out += `id: ${id}\n`;
  if (event) out += `event: ${event}\n`;
  out += `data: ${typeof data === 'string' ? data : JSON.stringify(data)}\n\n`;
  return out;
}

/**
 * 增量解析 SSE。push() 可以喂任意切分的字符串；end() 收尾未闭合的一行。
 * 每个完整事件回调一次 onFrame({ event, data, id })，data 为原始字符串。
 */
export function createSseParser({ onFrame } = {}) {
  let buffer = '';
  let dataLines = [];
  let eventName = '';
  let lastId;

  const dispatch = () => {
    if (dataLines.length === 0) return;
    const data = dataLines.join('\n');
    if (data === '[DONE]') {
      dataLines = [];
      eventName = '';
      return;
    }
    try { onFrame?.({ event: eventName || 'message', data, id: lastId }); } finally {
      dataLines = [];
      eventName = '';
    }
  };

  const handleLine = line => {
    if (line === '') { dispatch(); return; }
    if (line.startsWith(':')) return; // 注释/keepalive
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'data') dataLines.push(value);
    else if (field === 'event') eventName = value;
    else if (field === 'id') lastId = value;
  };

  return {
    push(chunk) {
      buffer += chunk;
      for (;;) {
        const match = buffer.match(/\r\n|\n|\r/);
        if (!match) return;
        // 末尾单独的 \r 可能只是 CRLF 的前半截：等下一块确认，避免把一行提前切断。
        if (match[0] === '\r' && match.index === buffer.length - 1) return;
        const index = match.index;
        const separatorLength = match[0].length;
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + separatorLength);
        handleLine(line);
      }
    },
    end() {
      // 收尾时末尾的 \r 按行结束处理（不会再等下一块了）。
      if (buffer.endsWith('\r')) { handleLine(buffer.slice(0, -1)); buffer = ''; }
      else if (buffer) { handleLine(buffer); buffer = ''; }
      if (dataLines.length) dispatch();
    },
  };
}

/** 把 UTF-8 字节流解码成文本并喂给 parser；处理多字节字符被网络块切断的情况。 */
export function createSseDecoder({ onFrame } = {}) {
  const parser = createSseParser({ onFrame });
  const decoder = new TextDecoder('utf-8');
  return {
    push(bytes) { parser.push(decoder.decode(bytes, { stream: true })); },
    end() { parser.push(decoder.decode()); parser.end(); },
  };
}
