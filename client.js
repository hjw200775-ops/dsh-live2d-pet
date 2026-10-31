window.__ModuleLoader__.load({
  id: 'dsh-deepseek-live2d',
  factory: () => ({
    inject: [],
    apply(ctx) {
      ctx.effect(() => {
        const abort = new AbortController();
        let frame, active = true, moving;
        let overlayReady=false;
        const root = document.createElement('div');
        root.id = 'dsh-deepseek-live2d';
        root.style.cssText = 'position:fixed;right:24px;bottom:24px;width:min(340px,90vw);height:min(490px,80vh);z-index:1000;pointer-events:auto';
        const bar = document.createElement('div');
        bar.style.cssText = 'height:26px;display:flex;justify-content:flex-end;gap:4px';
        const handle = document.createElement('button'); handle.textContent = '移动'; handle.title = '拖动此按钮移动整个桌宠区域';
        const toggle = document.createElement('button'); toggle.textContent = '收起';
        for (const button of [handle, toggle]) button.style.cssText = 'background:#152435e8;color:#eaf7ff;border:1px solid #53677d;border-radius:7px;font:12px sans-serif;cursor:pointer';
        handle.style.touchAction = 'none';
        bar.append(handle, toggle);
        const panel = document.createElement('div'); panel.style.cssText = 'height:calc(100% - 26px)';
        const clampPosition = () => {
          const r = root.getBoundingClientRect();
          root.style.left = Math.max(0, Math.min(r.left, innerWidth - r.width)) + 'px';
          root.style.top = Math.max(0, Math.min(r.top, innerHeight - r.height)) + 'px';
          root.style.right = root.style.bottom = 'auto';
        };
        const savePosition=()=>{if(overlayReady&&frame){const r=root.getBoundingClientRect();frame.contentWindow.postMessage({type:'dsh-live2d/overlay',overlay:{left:r.left,top:r.top}},new URL(frame.src).origin);}};
        const onMessage=e=>{
          if(!frame||e.source!==frame.contentWindow||e.origin!==new URL(frame.src).origin||e.data?.type!=='dsh-live2d/ready')return;
          const p=e.data.overlay;
          if(p&&Number.isFinite(p.left)&&Number.isFinite(p.top)){root.style.left=p.left+'px';root.style.top=p.top+'px';root.style.right=root.style.bottom='auto';clampPosition();}
          overlayReady=true;
        };
        window.addEventListener('message',onMessage);
        handle.addEventListener('pointerdown', e => { if (e.button !== 0) return; const r = root.getBoundingClientRect(); moving = {id:e.pointerId,x:e.clientX,y:e.clientY,left:r.left,top:r.top}; handle.setPointerCapture(e.pointerId); });
        handle.addEventListener('pointermove', e => { if (!moving || moving.id !== e.pointerId) return; root.style.left = moving.left + e.clientX - moving.x + 'px'; root.style.top = moving.top + e.clientY - moving.y + 'px'; root.style.right = root.style.bottom = 'auto'; clampPosition(); });
        for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) handle.addEventListener(event, () => { if(moving)savePosition();moving=null; });
        toggle.addEventListener('click', () => {
          active = !active; panel.hidden = !active; handle.hidden = !active;
          root.style.height = active ? 'min(490px,80vh)' : '26px';
          root.style.width = active ? 'min(340px,90vw)' : '92px';
          toggle.textContent = active ? '收起' : 'DeepSeek酱';
          if (frame) frame.contentWindow.postMessage({ type:'dsh-live2d/visibility', visible:active }, new URL(frame.src).origin);
          clampPosition();
        });
        window.addEventListener('resize', clampPosition);
        const status = document.createElement('div');
        status.style.cssText = 'font:13px sans-serif;padding:12px;background:#202735;color:white;border-radius:10px';
        status.textContent = 'DeepSeek-chan 加载中…';
        panel.append(status); root.append(bar, panel); document.body.append(root);
        // Client entries can mount before the asynchronous host plugin has
        // re-registered its route after enable/reload. Wait for that lifecycle.
        const delay = () => new Promise((resolve, reject) => {
          const done = () => {
            clearTimeout(timer); abort.signal.removeEventListener('abort', done);
            if (abort.signal.aborted) reject(abort.signal.reason); else resolve();
          };
          const timer = setTimeout(done, 400);
          abort.signal.addEventListener('abort', done, { once: true });
        });
        const bootstrap = async () => {
          for (let attempt = 0; attempt < 40; attempt++) {
            try {
              const r = await fetch('/deepseek-live2d/bootstrap', { signal: abort.signal, cache: 'no-store' });
              if (!r.ok) { const error = new Error(`宿主 HTTP ${r.status}`); error.terminal = r.status !== 404 && r.status < 500; throw error; }
              return await r.json();
            } catch (e) {
              if (abort.signal.aborted || e.terminal || attempt === 39) throw e;
              status.textContent = 'DeepSeek-chan 等待宿主就绪…';
              await delay();
            }
          }
        };
        bootstrap()
          .then(data => {
            if (abort.signal.aborted) return;
            if (data.overlay === false) { root.remove(); return; }
            const url = new URL(data.url);
            if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1') throw new Error('无效的本地渲染地址');
            frame = document.createElement('iframe');
            frame.title = 'DeepSeek-chan Live2D';
            frame.src = url.href;
            // Keep the embedding element and child on the same scheme. Chromium
            // otherwise inserts an opaque canvas between dark DSH and this page.
            frame.style.cssText = 'width:100%;height:100%;border:0;background:transparent;color-scheme:normal';
            frame.setAttribute('sandbox', 'allow-scripts allow-same-origin');
            frame.addEventListener('load', () => frame.contentWindow.postMessage({type:'dsh-live2d/visibility', visible:active}, url.origin));
            panel.replaceChildren(frame);
          }).catch(e => { if (!abort.signal.aborted) status.textContent = `DeepSeek-chan：${e.message}`; });
        return () => { savePosition();abort.abort();window.removeEventListener('message',onMessage);window.removeEventListener('resize',clampPosition);root.remove(); };
      });
    }
  })
});
