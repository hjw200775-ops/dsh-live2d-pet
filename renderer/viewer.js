import { attachMotionPolicy } from './runtime/motion-policy.mjs';
import { hitDrawableList } from './runtime/model-hit.mjs';
import { createGestureRecognizer } from './runtime/gesture.mjs';
import { formatBalance } from './runtime/balance.mjs';
import { OUTFIT_CONTROLS, FACE_CONTROLS, MOTION_CONTROLS, composeTargets, defaultWardrobe, normalizeWardrobe } from './runtime/wardrobe.mjs';
import { createFramePace } from './runtime/frame-pace.mjs';
import { hostExitDecision } from './runtime/host-exit.mjs';
import { clickMotionGroups, clickMotionWait, idleVarietyGroups } from './runtime/click-motion.mjs';
import { breathValue } from './runtime/breathing.mjs';
import { createGaze } from './runtime/gaze.mjs';
import { createLookFollower, lookParameters, lookTarget, inFollowRange, normalizeMouseFollow } from './runtime/look.mjs';
import { createIdleMotion } from './runtime/idle-motion.mjs';
import { createBlink } from './runtime/blink.mjs';
import { attachNaturalOverlay } from './runtime/natural-overlay.mjs';
import { defaultInteractionPreferences, sanitizeInteractionPreferences, pickBubble, parseBubbleText, formatBubbleText, doubleClickFallbackKind, shouldFireFeedback } from './features/interaction-preferences.mjs';
import { defaultChatPreferences, sanitizeChatPreferences, CHAT_LIMITS } from './features/chat/config.mjs';
import { createSseParser } from './features/chat/sse.mjs';
(async () => {
  const status=document.getElementById('status'),canvas=document.getElementById('canvas'),badge=document.getElementById('activity');
  let app,model,observer,raf=0,saveTimer,hideTimer,paceTimer=0,hostExitTimer=0,eventSource,telemetryTimer,disposed=false,paused=false,externallyHidden=false,preferencesLoaded=false;
  let preferences={version:1,model:{zoom:1,x:0,y:0}},interaction=defaultInteractionPreferences(),chat=defaultChatPreferences(),zoom=1,x=0,y=0,frames=0,desiredMode='idle',appliedMode='idle',expression='',motion='Idle';
  const saveState=document.getElementById('save-state');
  let saveStateTimer;
  let chatAbort=null;
  const bubbleEl=document.getElementById('bubble');
  let chatBubbleTimer;
  // 对话气泡：streaming 期间保持显示（sticky），结束后 2.5 秒自动隐藏，避免长期挡住模型。
  const showChatBubble=(text,sticky=false)=>{
    bubbleEl.textContent=text;bubbleEl.hidden=false;
    clearTimeout(chatBubbleTimer);
    if(!sticky)chatBubbleTimer=setTimeout(()=>{bubbleEl.hidden=true;},2500);
  };
  const cleanups=[],labels={idle:'待机',thinking:'思考中',answering:'回答中',error:'出错了'};
  const on=(el,type,fn,opts)=>{el.addEventListener(type,fn,opts);cleanups.push(()=>el.removeEventListener(type,fn,opts));};
  function fail(e){status.hidden=false;status.classList.add('error');status.textContent=`桌宠没能启动\n\n${e.message||e}`;}
  // 只有服务端真的回了 2xx 才显示“已保存”；失败必须留在面板上，不能让用户以为存住了。
  const paintSaveState=(ok,text)=>{
    if(!saveState)return;
    clearTimeout(saveStateTimer);
    saveState.hidden=false;
    saveState.textContent=text;
    saveState.classList.toggle('error',!ok);
    if(ok)saveStateTimer=setTimeout(()=>{saveState.hidden=true;},1600);
  };
  const persist=()=>{
    if(!preferencesLoaded)return Promise.resolve();
    clearTimeout(saveTimer);preferences.model={zoom,x,y};
    return fetch('preferences.json',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(preferences),keepalive:true})
      .then(async r=>{
        if(r.ok){paintSaveState(true,'设置已保存');return;}
        let detail='';
        try{const body=await r.json();if(body?.error==='payload-too-large')detail=`（超过 ${Math.round(Number(body.limit||0)/1024)} KB 上限）`;}catch{/* 错误体不是 JSON 时忽略 */ }
        throw new Error(r.status===413?`设置太大，没有保存成功${detail}`:`设置没有保存成功（HTTP ${r.status}）${detail}`);
      })
      .catch(e=>{paintSaveState(false,`未保存：${e.message}`);if(!disposed){status.hidden=false;status.textContent=e.message;}});
  };
  const scheduleSave=()=>{clearTimeout(saveTimer);saveTimer=setTimeout(persist,150);};
  on(window,'message',e=>{
    if(e.source!==parent)return;
    if(e.data?.type==='dsh-live2d/visibility')externallyHidden=!e.data.visible;
    if(e.data?.type==='dsh-live2d/overlay'){
      const p=e.data.overlay;
      if(p&&Number.isFinite(p.left)&&Number.isFinite(p.top)){preferences.overlay={left:p.left,top:p.top};scheduleSave();}
    }
  });
  const dispose=()=>{
    if(disposed)return;void persist();disposed=true;chatAbort?.abort();clearTimeout(chatBubbleTimer);
    cancelAnimationFrame(raf);clearTimeout(saveTimer);clearTimeout(hideTimer);clearTimeout(paceTimer);clearTimeout(hostExitTimer);clearInterval(telemetryTimer);observer?.disconnect();eventSource?.close();cleanups.splice(0).forEach(f=>f());
    app?.destroy(false,{children:true,texture:true,baseTexture:true});
  };
  on(window,'pagehide',dispose);on(window,'error',e=>{if(!disposed)fail(e.error||e.message);});
  try {
    const report=await fetch('status.json').then(r=>r.json());if(!report.ok)throw new Error(report.error);
    preferences=await fetch('preferences.json').then(r=>{if(!r.ok)throw new Error('位置存档读取失败');return r.json();});
    preferencesLoaded=true;
    interaction=sanitizeInteractionPreferences(preferences.interaction);
    chat=sanitizeChatPreferences(preferences.chat);
    ({zoom=1,x=0,y=0}=preferences.model||{});
    parent.postMessage({type:'dsh-live2d/ready',overlay:preferences.overlay},'*');
    const script=src=>new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=src;s.onload=resolve;s.onerror=()=>reject(new Error(`无法加载 ${src}`));document.head.append(s);});
    await script('core.js');await script('pixi.js');await script('live2d.js');await script('cubism-color.js');
    const core=window.Live2DCubismCore;
    if(!core||core.Version.csmGetLatestMocVersion()<report.mocVersion)throw new Error(`Cubism Core 太旧：MOC ${report.mocVersion}`);
    app=new PIXI.Application({view:canvas,backgroundAlpha:0,antialias:true,autoStart:false,resolution:Math.min(devicePixelRatio||1,2),autoDensity:true});
    model=await PIXI.live2d.Live2DModel.from(new URL('model/model.model3.json',location.href).href,{autoUpdate:false,autoInteract:false,motionPreload:'ALL'});
    if(disposed){model.destroy();return;}
    app.stage.addChild(model);model.anchor.set(.5,.5);
    const nativeW=model.width,nativeH=model.height;
    const desktopApi=window.dshDesktop||null;
    let mouseFollow=normalizeMouseFollow();
    const notePointer=(pointerX,pointerY,now)=>{
      const rect=document.getElementById('pet').getBoundingClientRect();
      if(inFollowRange(pointerX,pointerY,rect,mouseFollow))look.setTarget(lookTarget(pointerX,pointerY,rect,mouseFollow),now);
      else look.release();
    };
    // 由本层提供可变周期呼吸，去掉 SDK 同一通道的固定正弦，避免相加后顶到上限。
    const sdkBreath=model.internalModel.breath;
    if(sdkBreath?.getParameters&&sdkBreath?.setParameters){
      sdkBreath.setParameters(sdkBreath.getParameters().filter(parameter=>parameter.parameterId!=='ParamBreath'));
    }
    const layout=()=>{
      const b=document.getElementById('pet').getBoundingClientRect();app.renderer.resize(Math.max(1,b.width),Math.max(1,b.height));
      const shownZoom=desktopApi?1:zoom,shownX=desktopApi?0:x,shownY=desktopApi?0:y;
      model.scale.set(Math.min(b.width/nativeW,b.height/nativeH)*.92*shownZoom);model.position.set(b.width/2+shownX,b.height/2+shownY);
    };
    observer=new ResizeObserver(layout);observer.observe(document.getElementById('pet'));layout();
    // 只读调试钩子：排查"长期偏头"这类问题时能直接读参数值，不影响渲染
    window.__dshParams=ids=>{
      const out={};
      try{
        const core=model.internalModel.coreModel;
        for(const id of ids||[])out[id]=core.getParameterValueById(id);
      }catch{/* 模型没这个参数 */ }
      return out;
    };
    window.__dshGroups=()=>{
      try{
        const groups=model.internalModel.motionManager.groups||{};
        return {groups:Object.keys(groups), current:model.internalModel.motionManager.state?.currentGroup||null};
      }catch(error){return {error:String(error)};}
    };
    window.__dshPlayMotion=async group=>{
      try{return await model.motion(group,0,3);}catch(error){return 'ERR '+error.message;}
    };
    const setZoom=n=>{zoom=Math.min(3,Math.max(.25,n));layout();scheduleSave();};
    const scaleDesktop=factor=>{if(desktopApi)desktopApi.scaleBy(factor);else setZoom(zoom*factor);};
    let wardrobe=defaultWardrobe(),motionLocked=false,gestureLock=false,gestureSerial=0;
    let playClickMotions=async()=>{};
    const paintPressed=()=>{
      for(const button of document.querySelectorAll('#panel [data-key]')){
        const key=button.dataset.key,value=button.dataset.value;
        button.classList.toggle('on',value?wardrobe[key]===value:wardrobe[key]===true);
      }
    };
    const saveWardrobe=()=>{paintPressed();if(desktopApi?.setWardrobe)desktopApi.setWardrobe(wardrobe);};
    const fillChoices=(host,controls)=>{
      host.replaceChildren();
      for(const control of controls){
        if(control.kind==='choice'){
          const row=document.createElement('div');
          for(const [value,label] of control.options){
            const button=document.createElement('button');
            button.type='button';button.dataset.key=control.key;button.dataset.value=value;button.textContent=label;
            button.addEventListener('click',()=>{wardrobe={...wardrobe,[control.key]:value};saveWardrobe();});
            row.append(button);
          }
          host.append(control.label,row);
        }else{
          const button=document.createElement('button');
          button.type='button';button.dataset.key=control.key;button.textContent=control.label;
          button.addEventListener('click',()=>{wardrobe={...wardrobe,[control.key]:!wardrobe[control.key]};saveWardrobe();});
          host.append(button);
        }
      }
    };
    fillChoices(document.getElementById('outfit'),OUTFIT_CONTROLS);
    fillChoices(document.getElementById('faces'),FACE_CONTROLS);
    const motionHost=document.getElementById('motions');
    for(const [group,label] of MOTION_CONTROLS){
      const button=document.createElement('button');
      button.type='button';button.textContent=label;
      button.addEventListener('click',async()=>{
        motionLocked=true;
        const started=await model.motion(group,0,3);
        if(!started&&manager.state?.currentGroup!==group)status.hidden=false,status.textContent=`动作 ${label} 无法启动`;
      });
      motionHost.append(button);
    }
    // —— 互动反馈设置：只读写 interaction 配置，不触碰动作曲线与物理参数 ——
    const interactionUI={
      head:document.getElementById('interaction-head'),
      body:document.getElementById('interaction-body'),
      double:document.getElementById('interaction-double'),
      cooldown:document.getElementById('interaction-cooldown'),
      bubbleHead:document.getElementById('interaction-bubble-head'),
      bubbleBody:document.getElementById('interaction-bubble-body'),
      bubbleDouble:document.getElementById('interaction-bubble-double'),
      reset:document.getElementById('interaction-reset'),
    };
    const paintInteraction=()=>{
      if(!interactionUI.head)return;
      interactionUI.head.checked=interaction.enabled.head;
      interactionUI.body.checked=interaction.enabled.body;
      interactionUI.double.checked=interaction.enabled.double;
      interactionUI.cooldown.value=String(interaction.cooldownMs);
      interactionUI.bubbleHead.value=formatBubbleText(interaction.bubbles.head);
      interactionUI.bubbleBody.value=formatBubbleText(interaction.bubbles.body);
      interactionUI.bubbleDouble.value=formatBubbleText(interaction.bubbles.double);
    };
    const applyInteraction=patch=>{
      interaction=sanitizeInteractionPreferences(patch,interaction);
      preferences.interaction=interaction;
      paintInteraction();
      scheduleSave();
    };
    if(interactionUI.head){
      interactionUI.head.addEventListener('change',()=>applyInteraction({enabled:{head:interactionUI.head.checked}}));
      interactionUI.body.addEventListener('change',()=>applyInteraction({enabled:{body:interactionUI.body.checked}}));
      interactionUI.double.addEventListener('change',()=>applyInteraction({enabled:{double:interactionUI.double.checked}}));
      interactionUI.cooldown.addEventListener('change',()=>applyInteraction({cooldownMs:Number(interactionUI.cooldown.value)}));
      interactionUI.bubbleHead.addEventListener('change',()=>applyInteraction({bubbles:{head:parseBubbleText(interactionUI.bubbleHead.value)}}));
      interactionUI.bubbleBody.addEventListener('change',()=>applyInteraction({bubbles:{body:parseBubbleText(interactionUI.bubbleBody.value)}}));
      interactionUI.bubbleDouble.addEventListener('change',()=>applyInteraction({bubbles:{double:parseBubbleText(interactionUI.bubbleDouble.value)}}));
      interactionUI.reset.addEventListener('click',()=>applyInteraction(defaultInteractionPreferences()));
      paintInteraction();
      window.__dshInteraction=()=>({enabled:{...interaction.enabled},bubbles:{head:[...interaction.bubbles.head],body:[...interaction.bubbles.body],double:[...interaction.bubbles.double]},cooldownMs:interaction.cooldownMs});
    }
    // —— 对话（模拟）：本轮只走本地假模型；任何失败都不影响动画、装扮与点击反馈 ——
    const chatUI={
      enabled:document.getElementById('chat-enabled'),
      mode:document.getElementById('chat-mode'),
      input:document.getElementById('chat-input'),
      send:document.getElementById('chat-send'),
      stop:document.getElementById('chat-stop'),
      state:document.getElementById('chat-state'),
    };
    const setChatState=(text,isError=false)=>{if(!chatUI.state)return;chatUI.state.textContent=text;chatUI.state.classList.toggle('error',isError);};
    const paintChat=()=>{
      if(!chatUI.enabled)return;
      chatUI.enabled.checked=chat.enabled;
      chatUI.mode.value=chat.mode;
      const active=chat.enabled;
      chatUI.input.disabled=!active;chatUI.send.disabled=!active;
      chatUI.stop.disabled=!chatAbort;
      setChatState(active
        ?(chat.mode==='follow'?'模拟模式：跟随示例消息（未接入真实 AI）':'模拟模式：本地假模型回复（未接入真实 AI）')
        :'对话未启用；所有回复都是模拟内容');
    };
    const applyChat=patch=>{chat=sanitizeChatPreferences(patch,chat);preferences.chat=chat;paintChat();scheduleSave();};
    const stopChat=()=>{chatAbort?.abort();};
    const sendChat=async()=>{
      if(chatAbort||!chat.enabled)return;
      const text=chatUI.input.value.trim();
      if(!text){setChatState('先说点什么吧',true);return;}
      if([...text].length>CHAT_LIMITS.messageChars){setChatState(`最多 ${CHAT_LIMITS.messageChars} 个字`,true);return;}
      const controller=new AbortController();
      chatAbort=controller;
      let full='',deltas=0,ended=false,failure='',backend='simulated',degraded=false;
      const timeoutTimer=setTimeout(()=>{failure='timeout';controller.abort();},35000);
      chatUI.stop.disabled=false;chatUI.send.disabled=true;
      setChatState('模拟生成中…');
      showChatBubble('…',true);
      const parser=createSseParser({onFrame:({data})=>{
        let payload;try{payload=JSON.parse(data);}catch{return;}
        if(payload?.type==='meta'){
          backend=payload.backend||'simulated';degraded=payload.degraded===true;
          if(payload.simulated!==true)failure='unexpected-model';
          setChatState(degraded?'DSH 模型不可用，已降级为本地模拟':(backend==='host-llm'?'DSH 模型（本轮为模拟链路）':'本地模拟'));
          return;
        }
        if(payload?.type==='delta'&&typeof payload.text==='string'){full+=payload.text;deltas++;showChatBubble(full,true);return;}
        if(payload?.type==='end'){
          if(payload.reason==='ok')ended=true;
          else if(payload.reason==='aborted'){if(!failure)failure='aborted';}
          else failure=payload.reason||'bad-end';
          return;
        }
        if(payload?.type==='error'){failure=payload.code||'upstream-error';}
      }});
      try{
        const response=await fetch('chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text}),signal:controller.signal});
        if(!response.ok){const body=await response.json().catch(()=>({}));throw new Error(body.error||`HTTP ${response.status}`);}
        const reader=response.body?.getReader();
        if(!reader)throw new Error('no-stream');
        const decoder=new TextDecoder();
        for(;;){const {done,value}=await reader.read();if(done)break;parser.push(decoder.decode(value,{stream:true}));}
        parser.push(decoder.decode());parser.end();
        if(failure==='aborted')setChatState('已停止生成');
        else if(failure)setChatState(failure==='timeout'?'超时了，已停止':`生成失败：${failure}`,true);
        else if(!deltas)setChatState('没有收到内容（空流）',true);
        else if(!ended)setChatState('流意外结束（缺少结束事件）',true);
        else setChatState(`回复完成（${degraded?'已降级为本地模拟':backend==='host-llm'?'DSH 模型':'本地模拟'}）`);
      }catch(error){
        if(controller.signal.aborted&&failure!=='timeout')setChatState('已停止生成');
        else setChatState(failure==='timeout'?'超时了，已停止':`发送失败：${error.message}`,true);
      }finally{
        clearTimeout(timeoutTimer);chatAbort=null;
        chatUI.stop.disabled=true;chatUI.send.disabled=!chat.enabled;
        if(full)showChatBubble(full,false);else bubbleEl.hidden=true;
      }
    };
    if(chatUI.enabled){
      chatUI.enabled.addEventListener('change',()=>{if(!chatUI.enabled.checked)stopChat();applyChat({enabled:chatUI.enabled.checked});});
      chatUI.mode.addEventListener('change',()=>{stopChat();applyChat({mode:chatUI.mode.value});});
      chatUI.send.addEventListener('click',()=>{void sendChat();});
      chatUI.stop.addEventListener('click',stopChat);
      chatUI.input.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();void sendChat();}});
      window.__dshChat=()=>({enabled:chat.enabled,mode:chat.mode,busy:!!chatAbort,backend,degraded,config:{...chat}});
      paintChat();
    }    if(desktopApi?.getWardrobe)desktopApi.getWardrobe().then(saved=>{wardrobe=normalizeWardrobe(saved);paintPressed();}).catch(()=>{});
    paintPressed();
    let drag, windowDrag=false, lean=0, leanTarget=0;
    if(model.internalModel.renderer?.setClippingMaskBufferSize) model.internalModel.renderer.setClippingMaskBufferSize(2048);
    for(const texture of model.textures){
      texture.baseTexture.scaleMode=PIXI.SCALE_MODES.LINEAR;
      texture.baseTexture.mipmap=PIXI.MIPMAP_MODES.ON;
      texture.baseTexture.anisotropicLevel=16;
    }
    const refreshHitCache=()=>{
      if(!desktopApi)return [];
      const core=model.internalModel.coreModel, raw=core._model, list=[], count=core.getDrawableCount();
      for(let i=0;i<count;i++){
        if(raw.drawables.opacities[i]<0.08||!core.getDrawableDynamicFlagIsVisible(i))continue;
        const vertices=model.internalModel.getDrawableVertices(i);
        let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
        for(let p=0;p<vertices.length;p+=2){minX=Math.min(minX,vertices[p]);minY=Math.min(minY,vertices[p+1]);maxX=Math.max(maxX,vertices[p]);maxY=Math.max(maxY,vertices[p+1]);}
        const indexCount=raw.drawables.indexCounts[i];
        list.push({minX,minY,maxX,maxY,vertices,indices:Array.from(raw.drawables.indices[i]).slice(0,indexCount)});
      }
      return list;
    };
    let hitCache=[];
    const hitAt=(clientX,clientY)=>{
      const local=model.toModelPosition(new PIXI.Point(clientX,clientY),new PIXI.Point(),true);
      return hitDrawableList(local.x,local.y,hitCache);
    };
    let quitWithHost=false, seenHost=false, hostGoneAt=null, lastLinked=null;
    const hostButton=document.getElementById('quit-host');
    const paintHost=()=>{
      if(!hostButton)return;
      hostButton.classList.toggle('on',quitWithHost);
      hostButton.textContent=quitWithHost?'随 DSH 退出：开':'随 DSH 退出：关';
    };
    const noteHost=linked=>{
      const decision=hostExitDecision({quitWithHost,seenHost,connected:linked===true,pendingSince:hostGoneAt,now:Date.now()});
      seenHost=decision.seenHost;
      hostGoneAt=decision.pendingSince;
      clearTimeout(hostExitTimer);
      if(decision.quit)desktopApi?.quit();
      else if(decision.pendingSince!=null)hostExitTimer=setTimeout(()=>noteHost(false),Math.max(0,8000-(Date.now()-decision.pendingSince)));
    };
    if(desktopApi?.getQuitWithHost){
      desktopApi.getQuitWithHost().then(value=>{quitWithHost=value===true;paintHost();}).catch(()=>{});
      desktopApi.onQuitWithHost?.(value=>{quitWithHost=value===true;paintHost();if(!quitWithHost){clearTimeout(hostExitTimer);hostGoneAt=null;}else if(lastLinked===false)noteHost(false);});
    }
    if(desktopApi){
      hitCache=refreshHitCache();
      const hitTimer=setInterval(()=>{if(!windowDrag)hitCache=refreshHitCache();},250);
      cleanups.push(()=>clearInterval(hitTimer));
      const gestures=createGestureRecognizer({slop:5,holdMs:180,doubleMs:260});
      const bubble=document.getElementById('bubble'),panel=document.getElementById('panel');
      let clickTimer=0,bubbleTimer=0,lastReaction=0,nod=null,lastPointerX=0,pinned=true;
      const hoveredUi=target=>!!(target&&target.closest&&target.closest('#panel,#balance,button'));
      const regionAt=y=>{const rect=document.getElementById('pet').getBoundingClientRect();return (y-rect.top)/Math.max(1,rect.height)<.42?'head':'body';};
      const say=text=>{bubble.textContent=text;bubble.hidden=false;clearTimeout(bubbleTimer);bubbleTimer=setTimeout(()=>{bubble.hidden=true;},1100);};
      // 反馈开关、气泡文案与冷却全部来自 interaction 配置；默认值等价于 v0.7.3 的硬编码行为。
      const sayBubble=kind=>{const text=pickBubble(interaction.bubbles[kind]);if(text)say(text);};
      const react=(kind,point)=>{
        const now=performance.now();
        if(!shouldFireFeedback({kind,enabled:interaction.enabled,now,lastReaction,cooldownMs:interaction.cooldownMs}))return;
        lastReaction=now;
        if(kind==='head'){nod={start:now,duration:420,amp:-12};sayBubble('head');}
        else if(kind==='double'){nod={start:now,duration:520,amp:-16};sayBubble('double');}
        else {notePointer(point.x,point.y,now);sayBubble('body');}
        const groups=clickMotionGroups(kind,{mode:appliedMode,locked:motionLocked});
        if(groups)void playClickMotions(groups);
      };
      window.__dshHit=(x,y)=>hitAt(x,y);
      window.__dshDesktopReady=true;
      window.__nodOffset=now=>{if(!nod)return 0;const t=(now-nod.start)/nod.duration;if(t>=1){nod=null;return 0;}return Math.sin(t*Math.PI)*nod.amp;};
      window.__lean=()=>lean;
      on(window,'mousedown',e=>{
        if(e.button!==0||hoveredUi(e.target)||!hitAt(e.clientX,e.clientY))return;
        panel.hidden=true;
        const decision=gestures.pointerDown(e.clientX,e.clientY,performance.now());
        if(decision.type==='pending-double')clearTimeout(clickTimer);
      });
      on(window,'mousemove',e=>{
        if(windowDrag){
          const dt=Math.max(16,performance.now()-(window.__lastMove||performance.now()));
          leanTarget=Math.max(-10,Math.min(10,(e.clientX-lastPointerX)/dt*18));
          lastPointerX=e.clientX;window.__lastMove=performance.now();
          desktopApi.dragMove();return;
        }
        const decision=gestures.pointerMove(e.clientX,e.clientY);
        if(decision?.type==='drag-start'){
          clearTimeout(clickTimer);windowDrag=true;lastPointerX=e.clientX;desktopApi.setIgnore(false);desktopApi.dragStart({x:decision.x,y:decision.y});return;
        }
        desktopApi.setIgnore(!(hoveredUi(e.target)||hitAt(e.clientX,e.clientY)));
        // 鼠标跟随：记录软饱和目标，由眼球与头部的独立阻尼响应逼近。
        notePointer(e.clientX,e.clientY,performance.now());
      });
      on(window,'mouseup',e=>{
        if(windowDrag){windowDrag=false;leanTarget=0;gestures.pointerUp(e.clientX,e.clientY,performance.now());desktopApi.dragEnd();return;}
        const decision=gestures.pointerUp(e.clientX,e.clientY,performance.now());
        if(!decision)return;
        if(decision.type==='double-click'){
          const point={x:e.clientX,y:e.clientY};
          // 方案 C：双击反馈关闭时折叠成一次普通单击，区域按点击位置判定；开关与冷却仍由 react() 把关。
          react(doubleClickFallbackKind({doubleEnabled:interaction.enabled.double,region:regionAt(e.clientY)}),point);
        }
        if(decision.type==='click-arm'){
          const point={x:e.clientX,y:e.clientY};
          clearTimeout(clickTimer);
          clickTimer=setTimeout(()=>{const fired=gestures.expire(performance.now());if(fired?.type==='click')react(regionAt(point.y),point);},260);
        }
      });
      on(window,'contextmenu',e=>{
        if(!hitAt(e.clientX,e.clientY)&&!hoveredUi(e.target))return;
        e.preventDefault();
        panel.hidden=false;
        desktopApi.setIgnore(false);
      });
      // 透明点击穿透时也提供键盘入口，避免仅能通过鼠标打开设置。
      on(window,'keydown',e=>{
        if((e.shiftKey&&e.key==='F10')||e.key==='ContextMenu'){
          e.preventDefault();panel.hidden=false;desktopApi.setIgnore(false);
        }else if(e.key==='Escape'&&!panel.hidden){panel.hidden=true;}
      });
      on(panel,'click',e=>{
        const act=e.target?.dataset?.act;if(!act)return;
        if(act==='close'){panel.hidden=true;return;}
        if(act==='larger')scaleDesktop(1.15);
        if(act==='smaller')scaleDesktop(1/1.15);
        if(act==='reset'){zoom=1;x=y=0;desktopApi.resetScale();}
        if(act==='pin'){pinned=!pinned;desktopApi.setPinned(pinned);e.target.textContent=pinned?'取消置顶':'置顶';}
        if(act==='refresh')desktopApi.refreshBalance();
        if(act==='restore'){wardrobe=defaultWardrobe();saveWardrobe();}
        if(act==='auto'){motionLocked=false;activate(desiredMode);}
        if(act==='quit')desktopApi.quit();
        if(act==='host'){
          quitWithHost=!quitWithHost;
          paintHost();
          if(!quitWithHost){clearTimeout(hostExitTimer);hostGoneAt=null;}
          else if(lastLinked===false)noteHost(false);
          desktopApi.setQuitWithHost(quitWithHost);
        }
      });
      window.__life=now=>{
        // 鼠标跟随完全由 lookFollower 驱动，不再用内置 model.focus（那套是"方向满偏"）
        const busy=paused||appliedMode!=='idle'||motionLocked||gestureLock||windowDrag;
        if(busy)window.__idleStill=now;
        else if(!window.__idleStill)window.__idleStill=now;
        const groups=idleVarietyGroups(now-(window.__idleStill||now),{mode:appliedMode,locked:motionLocked||gestureLock,dragging:windowDrag,seed:window.__idleSeed||0});
        if(groups){window.__idleStill=now;window.__idleSeed=(window.__idleSeed||0)+1;void playClickMotions(groups);}
      };
    }
    if(!desktopApi){
      const hostButton=document.getElementById('quit-host');
      if(hostButton)hostButton.hidden=true;
      const panel=document.getElementById('panel');
      on(window,'contextmenu',e=>{e.preventDefault();panel.hidden=false;});
      on(panel,'click',e=>{
        const act=e.target?.dataset?.act;if(!act)return;
        if(act==='close'){panel.hidden=true;return;}
        if(act==='larger')scaleDesktop(1.15);
        if(act==='smaller')scaleDesktop(1/1.15);
        if(act==='reset'){zoom=1;x=y=0;layout();scheduleSave();}
        if(act==='restore'){wardrobe=defaultWardrobe();saveWardrobe();}
        if(act==='auto'){motionLocked=false;activate(desiredMode);}
      });
    }
    on(canvas,'pointerdown',e=>{if(desktopApi||e.button!==0)return;drag={id:e.pointerId,x:e.clientX,y:e.clientY,px:x,py:y};canvas.setPointerCapture(e.pointerId);});
    on(canvas,'pointermove',e=>{if(!drag||drag.id!==e.pointerId)return;x=drag.px+e.clientX-drag.x;y=drag.py+e.clientY-drag.y;layout();});
    const endDrag=()=>{if(drag)scheduleSave();drag=null;};
    for(const e of ['pointerup','pointercancel','lostpointercapture'])on(canvas,e,endDrag);
    on(canvas,'wheel',e=>{if(windowDrag||(e.buttons&1))return;e.preventDefault();scaleDesktop(Math.exp(-e.deltaY*.001));},{passive:false});
    on(document.getElementById('pause'),'click',e=>{paused=!paused;e.target.textContent=paused?'继续':'暂停';});
    const manager=model.internalModel.motionManager;
    attachMotionPolicy(manager);
    PIXI.live2d.config.preserveExpressionOnMotion=true;
    let chain=Promise.resolve(),epoch=0,handRaised=false,lastExpression='';
    const activate=(mode,options={})=>{
      if(!Object.hasOwn(labels,mode))return;desiredMode=mode;badge.textContent=labels[mode];const revision=++epoch;
      const playIntro=options.intro!==false;
      chain=chain.catch(fail).then(async()=>{
        if(disposed||revision!==epoch)return;
        appliedMode=mode;
        const group=mode==='answering'?'Answering':mode==='thinking'?'Thinking':handRaised?'Return':'Idle';
        const intro=playIntro&&mode==='error'?'Flinch':null;
        if(!motionLocked&&!gestureLock){
          if(intro){
            const started=await model.motion(intro,0,3);
            if(!started && manager.state?.currentGroup!==intro)throw new Error(`动作 ${intro} 无法启动`);
            await new Promise(resolve=>setTimeout(resolve,1000));
            if(disposed||revision!==epoch||motionLocked||gestureLock)return;
          }
          const started=await model.motion(group,0,3);
          if(!started && manager.state?.currentGroup!==group)throw new Error(`动作 ${group} 无法启动`);
        }
        handRaised=mode==='answering';
        if(revision!==epoch||disposed)return;
        motion=group;
        expression='';
      }).catch(fail);
    };
    playClickMotions=async groups=>{
      const serial=++gestureSerial;
      gestureLock=true;
      try{
        for(let index=0;index<groups.length;index++){
          if(serial!==gestureSerial||disposed)return;
          try{await model.motion(groups[index],0,3);}catch{/* The return clip still has to run. */}
          await new Promise(resolve=>setTimeout(resolve,clickMotionWait(groups[index],index)));
        }
      }finally{
        if(serial===gestureSerial&&!disposed){
          gestureLock=false;
          if(!motionLocked)activate(desiredMode,{intro:false});
        }
      }
    };
    const applyWardrobe=coreModel=>{
      for(const [id,value] of Object.entries(composeTargets(wardrobe,appliedMode))){
        try{coreModel.setParameterValueById(id,value);}catch{/* This model may not expose every catalog id. */}
      }
    };
    // Physics reads LeanInput and the skirt parameter before the mesh updates, so the targets have to be in place first.
    let frameLook={};
    const followEnabled=()=>!paused&&!windowDrag&&!motionLocked&&(appliedMode==='idle'||appliedMode==='thinking');
    attachNaturalOverlay(model.internalModel,()=>{
      const now=performance.now();
      const idleEnabled=appliedMode==='idle'&&!gestureLock&&!motionLocked&&!windowDrag&&!paused;
      const values=idleMotion.valueAt(now/1000,idleEnabled);
      const point=look.update(now);
      frameLook=followEnabled()?lookParameters(point):{};
      // 本模型由 AngleX/Y 经 physics 驱动 ParamAngleX/Y，不能在物理计算后只改输出。
      values.AngleX=(values.AngleX||0)+(frameLook.ParamAngleX||0);
      values.AngleY=(values.AngleY||0)+(frameLook.ParamAngleY||0);
      if(appliedMode==='idle'||appliedMode==='thinking')values.ParamBreath=breathValue(now/1000);
      return values;
    });
    model.internalModel.on('afterMotionUpdate',()=>{
      const coreModel=model.internalModel.coreModel;
      applyWardrobe(coreModel);
    });
    model.internalModel.on('beforeModelUpdate',()=>{
      const now=performance.now();
      const coreModel=model.internalModel.coreModel;
      if(appliedMode==='answering')coreModel.setParameterValueById('ParamMouthOpenY',.18+.32*(1+Math.sin(now*.017)));
      applyWardrobe(coreModel);
      // 空闲小动作不再禁用跟随；头部控制器已在物理之前叠加，这里只叠加眼珠。
      if(followEnabled()){
        for(const id of ['ParamEyeBallX','ParamEyeBallY']){
          coreModel.addParameterValueById(id,frameLook[id]||0);
        }
      }
      // 视线漂移：只在她没在表演时加，免得和动作抢眼珠
      if(appliedMode==='idle'&&!gestureLock&&!motionLocked&&!look.active){
        const g=gaze.valueAt(now/1000);
        try{
          coreModel.addParameterValueById('ParamEyeBallX',g.x);
          coreModel.addParameterValueById('ParamEyeBallY',g.y);
        }catch{/* 同上 */}
      }
      if(appliedMode==='thinking'){
        coreModel.setParameterValueById('key8',1);
        coreModel.setParameterValueById('Param140',(now%900)/900);
      }else window.__thinkAt=0;
      if(window.__nodOffset)coreModel.addParameterValueById('ParamAngleY',window.__nodOffset(now));
      if(desktopApi){
        lean+= (leanTarget-lean)*(1-Math.exp(-Math.min(50,now-(window.__leanAt||now))/140));
        window.__leanAt=now;
        if(!windowDrag)leanTarget=0;
        coreModel.addParameterValueById('ParamAngleZ',lean);
      }
      const open=blink.valueAt(now/1000,appliedMode!=='answering'&&!paused);
      if(open<1){
        coreModel.multiplyParameterValueById('ParamEyeLOpen',open);
        coreModel.multiplyParameterValueById('ParamEyeROpen',open);
      }
    });
    if(!report.idle)throw new Error('缺少 Idle 动作');
    const seed=Math.floor(Math.random()*4294967296);
    const idleMotion=createIdleMotion({seed});
    const blink=createBlink({seed:seed+1});
    const gaze=createGaze();
    const look=createLookFollower();
    const followButton=document.getElementById('mouse-follow'),followRange=document.getElementById('follow-range');
    const followNumber=document.getElementById('follow-radius-number'),followUnlimited=document.getElementById('follow-unlimited');
    let finiteRadius=mouseFollow.radius||1200;
    const paintFollow=()=>{
      followButton.textContent=mouseFollow.enabled?'鼠标跟随：开':'鼠标跟随：关';
      followButton.setAttribute('aria-pressed',String(mouseFollow.enabled));
      followButton.classList.toggle('on',mouseFollow.enabled);
      if(mouseFollow.radius)finiteRadius=mouseFollow.radius;
      followRange.value=String(finiteRadius);followNumber.value=String(finiteRadius);
      followUnlimited.checked=mouseFollow.radius===0;
      followRange.disabled=followNumber.disabled=followUnlimited.checked;
      document.getElementById('follow-radius-label').textContent=followUnlimited.checked?'全屏':String(finiteRadius);
      document.getElementById('follow-radius-unit').hidden=followUnlimited.checked;
    };
    const changeFollow=patch=>{
      mouseFollow=normalizeMouseFollow(patch,mouseFollow);paintFollow();
      if(!mouseFollow.enabled)look.release();
      desktopApi?.setMouseFollow?.(mouseFollow);
    };
    document.getElementById('follow-controls').hidden=!desktopApi;
    paintFollow();
    if(desktopApi?.getMouseFollow){
      const savedFollow=await desktopApi.getMouseFollow();
      mouseFollow=normalizeMouseFollow(savedFollow);paintFollow();
    }
    on(followButton,'click',()=>changeFollow({enabled:!mouseFollow.enabled}));
    on(followRange,'input',()=>{
      finiteRadius=Number(followRange.value);followNumber.value=followRange.value;
      document.getElementById('follow-radius-label').textContent=followRange.value;
    });
    on(followRange,'change',()=>changeFollow({radius:Number(followRange.value)}));
    on(followNumber,'change',()=>{
      if(followNumber.validity.valid)changeFollow({radius:Number(followNumber.value)});
      else paintFollow();
    });
    on(followUnlimited,'change',()=>changeFollow({radius:followUnlimited.checked?0:finiteRadius}));
    if(desktopApi?.onPointer){
      const unsubscribe=desktopApi.onPointer(point=>{
        if(disposed)return;
        const now=performance.now();
        if(point?.inside&&Number.isFinite(point.x)&&Number.isFinite(point.y)){
          notePointer(point.x,point.y,now);
          if(!windowDrag)desktopApi.setIgnore(!(document.elementFromPoint(point.x,point.y)?.closest('#panel,#balance,button')||hitAt(point.x,point.y)));
        }else if(point?.inside===false){
          look.release();
          if(!windowDrag&&document.getElementById('panel').hidden)desktopApi.setIgnore(true);
        }
      });
      if(typeof unsubscribe==='function')cleanups.push(unsubscribe);
    }
    activate('idle');
    eventSource=new EventSource('events');
    let balanceNotice='';
    const applyBalance=snapshot=>{
      const el=document.getElementById('balance');
      if(!el||!snapshot)return;
      el.hidden=false;el.textContent=formatBalance(snapshot);
      if(snapshot.low&&snapshot.noticeKey&&snapshot.noticeKey!==balanceNotice){
        balanceNotice=snapshot.noticeKey;
        const bubble=document.getElementById('bubble');
        if(bubble){bubble.textContent='余额偏低';bubble.hidden=false;setTimeout(()=>{if(bubble.textContent==='余额偏低')bubble.hidden=true;},1600);}
      }
      if(!snapshot.low)balanceNotice='';
    };
    eventSource.onmessage=e=>{try{const s=JSON.parse(e.data);applyBalance(s.balance);lastLinked=s.connected!==false;noteHost(lastLinked);if(s.connected===false){badge.textContent='未连接';badge.title='DSH 未连接，桌宠保持待机';if(desiredMode!=='idle')activate('idle');return;}if(s.mode!==desiredMode)activate(s.mode);else badge.textContent=labels[s.mode]||labels.idle;badge.title='跟随 DSH 实际回合状态';}catch(err){fail(err);}};
    eventSource.onerror=()=>{badge.title='宿主连接中断，正在重连';};
    on(canvas,'webglcontextlost',e=>{e.preventDefault();fail(new Error('WebGL 上下文丢失，请刷新'));});
    let then=performance.now(),lastPaceUi=0;status.textContent='已加载 · 状态联动已连接';
    const pace=createFramePace();
    const scheduleTick=wait=>{
      if(disposed)return;
      clearTimeout(paceTimer);
      cancelAnimationFrame(raf);
      if(document.hidden||externallyHidden||paused){paceTimer=setTimeout(()=>requestAnimationFrame(tick),200);return;}
      if(wait>8){paceTimer=setTimeout(()=>{raf=requestAnimationFrame(tick);},wait-4);return;}
      raf=requestAnimationFrame(tick);
    };
    const resumeDrawing=()=>{
      then=performance.now();
      if(!paused&&!disposed)scheduleTick(0);
    };
    if(desktopApi?.onResume)desktopApi.onResume(resumeDrawing);
    on(document,'visibilitychange',()=>{if(!document.hidden)resumeDrawing();});
    function tick(now){
      if(disposed)return;const dt=Math.min(50,now-then);then=now;
      window.__life?.(now);
      const active=!paused&&(appliedMode!=='idle'||windowDrag||look.moving);
      const decision=pace.consume(dt,active);
      if(decision.draw&&!paused&&!document.hidden&&!externallyHidden){model.update(decision.step);app.renderer.render(app.stage);frames++;pace.present(now);}
      if(now-lastPaceUi>1000){
        lastPaceUi=now;
        const stats=pace.snapshot(now);
        const el=document.getElementById('pace');
        const gear=paused?'暂停':(appliedMode!=='idle'||windowDrag)?'活动约 60 帧':'待机约 30 帧';
        if(el)el.textContent=stats.p95==null?`${gear} · 绘制间隔统计中`:`${gear} · 近 60 秒绘制 p95 ${Math.round(stats.p95)}ms`;
      }
      Object.assign(canvas.dataset,{frames:String(frames),idlePlaying:String(!manager.isFinished()),zoom:String(zoom),offset:JSON.stringify([x,y]),mode:appliedMode,expression,motion});
      scheduleTick(decision.wait);
    }
    raf=requestAnimationFrame(tick);hideTimer=setTimeout(()=>{if(!disposed&&frames>0)status.hidden=true;},2500);
    telemetryTimer=setInterval(()=>{if(!disposed)fetch('telemetry.json',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:appliedMode,frames,zoom,x,y,expression,motion})}).catch(()=>{});},750);
  }catch(e){fail(e);}
})();
