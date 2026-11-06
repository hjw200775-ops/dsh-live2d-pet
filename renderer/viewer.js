import { thinkingHand, handReturn, handEntry, createThinkingFace, loadThinkingHandReturns } from './runtime/thinking-accents.mjs';
import { createThinkingMotion, thinkingPhase } from './runtime/thinking.mjs';
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
import { createHeadPat } from './runtime/head-pat.mjs';
(async () => {
  const status=document.getElementById('status'),canvas=document.getElementById('canvas'),badge=document.getElementById('activity');
  let app,model,observer,raf=0,saveTimer,hideTimer,paceTimer=0,hostExitTimer=0,eventSource,telemetryTimer,disposed=false,paused=false,externallyHidden=false,preferencesLoaded=false;
  let preferences={version:1,model:{zoom:1,x:0,y:0}},zoom=1,x=0,y=0,frames=0,desiredMode='idle',appliedMode='idle',expression='',motion='Idle',currentThinkingPhase='waiting';
  const cleanups=[],labels={idle:'待机',thinking:'思考中',answering:'回答中',error:'出错了'};
  let stopHeadPat=()=>{};
  const on=(el,type,fn,opts)=>{el.addEventListener(type,fn,opts);cleanups.push(()=>el.removeEventListener(type,fn,opts));};
  function fail(e){status.hidden=false;status.classList.add('error');status.textContent=`桌宠没能启动\n\n${e.message||e}`;}
  const persist=()=>{
    if(!preferencesLoaded)return Promise.resolve();
    clearTimeout(saveTimer);preferences.model={zoom,x,y};
    return fetch('preferences.json',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(preferences),keepalive:true}).then(r=>{if(!r.ok)throw new Error('位置存档写入失败');}).catch(e=>{if(!disposed){status.hidden=false;status.textContent=e.message;}});
  };
  const scheduleSave=()=>{clearTimeout(saveTimer);saveTimer=setTimeout(persist,150);};
  on(window,'message',e=>{
    if(e.source!==parent)return;
    if(e.data?.type==='dsh-live2d/visibility'){
      externallyHidden=!e.data.visible;
      if(externallyHidden)stopHeadPat();
    }
    if(e.data?.type==='dsh-live2d/overlay'){
      const p=e.data.overlay;
      if(p&&Number.isFinite(p.left)&&Number.isFinite(p.top)){preferences.overlay={left:p.left,top:p.top};scheduleSave();}
    }
  });
  const dispose=()=>{
    if(disposed)return;stopHeadPat();void persist();disposed=true;
    cancelAnimationFrame(raf);clearTimeout(saveTimer);clearTimeout(hideTimer);clearTimeout(paceTimer);clearTimeout(hostExitTimer);clearInterval(telemetryTimer);observer?.disconnect();eventSource?.close();cleanups.splice(0).forEach(f=>f());
    app?.destroy(false,{children:true,texture:true,baseTexture:true});
  };
  on(window,'pagehide',dispose);on(window,'error',e=>{if(!disposed)fail(e.error||e.message);});
  try {
    const report=await fetch('status.json').then(r=>r.json());if(!report.ok)throw new Error(report.error);
    preferences=await fetch('preferences.json').then(r=>{if(!r.ok)throw new Error('位置存档读取失败');return r.json();});
    preferencesLoaded=true;
    ({zoom=1,x=0,y=0}=preferences.model||{});
    parent.postMessage({type:'dsh-live2d/ready',overlay:preferences.overlay},'*');
    const script=src=>new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=src;s.onload=resolve;s.onerror=()=>reject(new Error(`无法加载 ${src}`));document.head.append(s);});
    await script('core.js');await script('pixi.js');await script('live2d.js');await script('cubism-color.js');
    const core=window.Live2DCubismCore;
    if(!core||core.Version.csmGetLatestMocVersion()<report.mocVersion)throw new Error(`Cubism Core 太旧：MOC ${report.mocVersion}`);
    app=new PIXI.Application({view:canvas,backgroundAlpha:0,antialias:true,autoStart:false,resolution:Math.min(devicePixelRatio||1,2),autoDensity:true});
    model=await PIXI.live2d.Live2DModel.from(new URL('model/model.model3.json',location.href).href,{autoUpdate:false,autoInteract:false,motionPreload:'ALL'});
    if(disposed){model.destroy();return;}
    const thinkingHandReturns=await loadThinkingHandReturns(new URL('model/model.model3.json',location.href));
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
        motionLocked=true;automaticHand='default';
        const started=await model.motion(group,0,3);
        if(!started&&manager.state?.currentGroup!==group)status.hidden=false,status.textContent=`动作 ${label} 无法启动`;
      });
      motionHost.append(button);
    }
    if(desktopApi?.getWardrobe)desktopApi.getWardrobe().then(saved=>{wardrobe=normalizeWardrobe(saved);paintPressed();}).catch(()=>{});
    paintPressed();
    let drag, windowDrag=false, lean=0, leanTarget=0;
    const headPat=createHeadPat();
    const patOverlay=document.getElementById('petpat');
    const paintHeadPat=now=>{
      const feedback=headPat.feedback(now);
      patOverlay.hidden=feedback.strength<=0;
      if(patOverlay.hidden)return;
      const bounds=model.getBounds();
      const width=Math.max(28,bounds.width*.30);
      const height=width*(patOverlay.naturalHeight||93)/(patOverlay.naturalWidth||105);
      patOverlay.style.width=width+'px';
      patOverlay.style.left=(bounds.x+bounds.width/2-width*.58)+'px';
      patOverlay.style.top=(bounds.y+bounds.height*.14-height*.86)+'px';
      patOverlay.style.opacity=String(feedback.strength);
    };
    window.__dshPat=()=>({
      phase:headPat.phase,stage:headPat.feedback(performance.now()).stage,visible:!patOverlay.hidden,
    });
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
    const panel=document.getElementById('panel');
    if(!desktopApi){
      for(const control of panel.querySelectorAll('[data-desktop-only]'))control.hidden=true;
    }
    const tabs=[...panel.querySelectorAll('[role=tab]')].filter(tab=>!tab.hidden);
    let pointerAt=null,lastIgnore;
    const setDesktopIgnore=ignore=>{
      if(!desktopApi||ignore===lastIgnore)return;
      lastIgnore=ignore;
      desktopApi.setIgnore(ignore);
    };
    const updatePassThrough=()=>{
      if(!desktopApi||windowDrag)return;
      const overUi=pointerAt&&document.elementFromPoint(pointerAt.x,pointerAt.y)?.closest('#panel,#balance,button');
      const overPet=pointerAt&&hitAt(pointerAt.x,pointerAt.y);
      setDesktopIgnore(panel.hidden&&!headPat.pressing&&!headPat.active&&!overUi&&!overPet);
    };
    const placePanel=(left,top)=>{
      if(panel.hidden)return;
      const pad=8;
      panel.style.left=Math.max(pad,Math.min(left,innerWidth-panel.offsetWidth-pad))+'px';
      panel.style.top=Math.max(pad,Math.min(top,innerHeight-panel.offsetHeight-pad))+'px';
    };
    const clampPanel=()=>placePanel(panel.offsetLeft,panel.offsetTop);
    const openPanelAt=(x,y)=>{
      stopHeadPat();
      panel.style.visibility='hidden';
      panel.hidden=false;
      const gap=10;
      const left=x+gap+panel.offsetWidth>innerWidth-8 ? x-panel.offsetWidth-gap : x+gap;
      placePanel(left,y+gap);
      panel.style.visibility='';
      updatePassThrough();
    };
    const closePanel=()=>{
      if(panel.hidden)return;
      panel.hidden=true;
      updatePassThrough();
    };
    const selectTab=selected=>{
      for(const tab of tabs){
        const active=tab===selected;
        tab.setAttribute('aria-selected',String(active));
        tab.tabIndex=active?0:-1;
        document.getElementById(tab.getAttribute('aria-controls')).hidden=!active;
      }
      clampPanel();
    };
    for(const [index,tab] of tabs.entries()){
      on(tab,'click',()=>selectTab(tab));
      on(tab,'keydown',event=>{
        let next;
        if(event.key==='ArrowRight')next=(index+1)%tabs.length;
        else if(event.key==='ArrowLeft')next=(index+tabs.length-1)%tabs.length;
        else if(event.key==='Home')next=0;
        else if(event.key==='End')next=tabs.length-1;
        else return;
        event.preventDefault();
        selectTab(tabs[next]);
        tabs[next].focus();
      });
    }
    const panelObserver=new ResizeObserver(clampPanel);
    panelObserver.observe(panel);
    cleanups.push(()=>panelObserver.disconnect());
    on(window,'resize',clampPanel);
    on(window,'mousemove',event=>{pointerAt={x:event.clientX,y:event.clientY};});
    on(window,'blur',()=>{pointerAt=null;stopHeadPat();closePanel();});
    on(window,'contextmenu',event=>{
      event.preventDefault();
      if(panel.contains(event.target))return;
      pointerAt={x:event.clientX,y:event.clientY};
      openPanelAt(pointerAt.x,pointerAt.y);
    });
    on(window,'mousedown',event=>{
      if(panel.hidden||event.button!==0||panel.contains(event.target))return;
      pointerAt={x:event.clientX,y:event.clientY};
      closePanel();
      event.stopPropagation();
    },true);
    on(window,'keydown',event=>{
      if((event.shiftKey&&event.key==='F10')||event.key==='ContextMenu'){
        event.preventDefault();
        const point=pointerAt||{x:innerWidth/2,y:innerHeight/2};
        openPanelAt(point.x,point.y);
        tabs.find(tab=>tab.getAttribute('aria-selected')==='true')?.focus();
      }else if(event.key==='Escape'){
        if(!panel.hidden||headPat.pressing||headPat.engaged)event.preventDefault();
        stopHeadPat();
        closePanel();
      }
    });
    if(desktopApi){
      hitCache=refreshHitCache();
      const hitTimer=setInterval(()=>{if(!windowDrag)hitCache=refreshHitCache();},250);
      cleanups.push(()=>clearInterval(hitTimer));
      const gestures=createGestureRecognizer({slop:5,holdMs:180,doubleMs:260});
      const bubble=document.getElementById('bubble');
      let clickTimer=0,bubbleTimer=0,lastReaction=0,nod=null,lastPointerX=0,pinned=true;
      let pointerId=null,patPointerId=null;
      const hoveredUi=target=>!!(target&&target.closest&&target.closest('#panel,#balance,button'));
      const regionAt=y=>{const rect=document.getElementById('pet').getBoundingClientRect();return (y-rect.top)/Math.max(1,rect.height)<.42?'head':'body';};
      const isHead=(x,y)=>regionAt(y)==='head'&&hitAt(x,y);
      const releasePatCapture=()=>{
        const id=patPointerId;
        patPointerId=null;
        if(id!==null&&canvas.hasPointerCapture(id))canvas.releasePointerCapture(id);
      };
      const releasePendingPat=()=>{
        headPat.end(performance.now());
        releasePatCapture();
        updatePassThrough();
      };
      stopHeadPat=(fade=false)=>{
        if(!headPat.pressing&&!headPat.engaged)return;
        if(fade)headPat.end(performance.now());
        else headPat.cancel();
        clearTimeout(clickTimer);
        gestures.cancel();
        releasePatCapture();
        if(!headPat.engaged)patOverlay.hidden=true;
        updatePassThrough();
      };
      on(canvas,'pointerdown',event=>{
        if(event.isPrimary&&event.button===0)pointerId=event.pointerId;
      });
      on(canvas,'pointerup',event=>{
        if(!event.isPrimary||event.button!==0)return;
        if(headPat.active)stopHeadPat(true);
        else if(headPat.pressing)releasePendingPat();
      });
      on(canvas,'pointercancel',()=>stopHeadPat());
      on(canvas,'lostpointercapture',()=>{
        if(headPat.pressing||headPat.active)stopHeadPat();
      });
      const say=text=>{bubble.textContent=text;bubble.hidden=false;clearTimeout(bubbleTimer);bubbleTimer=setTimeout(()=>{bubble.hidden=true;},1100);};
      const react=(kind,point)=>{
        const now=performance.now();
        if(kind!=='double'&&now-lastReaction<650)return;
        lastReaction=now;
        if(kind==='head'){nod={start:now,duration:420,amp:-12};say(['嗯？','在的','嘿嘿'][Math.floor(Math.random()*3)]);}
        else if(kind==='double'){nod={start:now,duration:520,amp:-16};say('嘿嘿！');}
        else notePointer(point.x,point.y,now);
        const groups=clickMotionGroups(kind,{mode:appliedMode,locked:motionLocked});
        if(groups)void playClickMotions(groups);
      };
      window.__dshHit=(x,y)=>hitAt(x,y);
      window.__dshDesktopReady=true;
      window.__nodOffset=now=>{if(!nod)return 0;const t=(now-nod.start)/nod.duration;if(t>=1){nod=null;return 0;}return Math.sin(t*Math.PI)*nod.amp;};
      window.__lean=()=>lean;
      on(window,'mousedown',e=>{
        const id=pointerId;
        pointerId=null;
        if(e.button!==0||!panel.hidden||headPat.engaged||hoveredUi(e.target)||!hitAt(e.clientX,e.clientY))return;
        const now=performance.now();
        const decision=gestures.pointerDown(e.clientX,e.clientY,now);
        if(decision.type==='pending-double')clearTimeout(clickTimer);
        if(appliedMode==='idle'&&!paused&&!gestureLock&&!motionLocked&&!windowDrag&&isHead(e.clientX,e.clientY)&&headPat.begin(now)){
          if(id!==null){
            canvas.setPointerCapture(id);
            patPointerId=id;
          }
          updatePassThrough();
        }
      });
      on(window,'mousemove',e=>{
        if(windowDrag){
          const dt=Math.max(16,performance.now()-(window.__lastMove||performance.now()));
          leanTarget=Math.max(-10,Math.min(10,(e.clientX-lastPointerX)/dt*18));
          lastPointerX=e.clientX;window.__lastMove=performance.now();
          desktopApi.dragMove();return;
        }
        if(headPat.active){
          if(!(e.buttons&1)||!isHead(e.clientX,e.clientY))stopHeadPat(true);
          return;
        }
        if(headPat.pressing&&!(e.buttons&1)){
          stopHeadPat();
          return;
        }
        const decision=(e.buttons&1)?gestures.pointerMove(e.clientX,e.clientY):null;
        if(decision?.type==='drag-start'){
          headPat.end(performance.now());
          releasePatCapture();
          clearTimeout(clickTimer);windowDrag=true;lastPointerX=e.clientX;setDesktopIgnore(false);desktopApi.dragStart({x:decision.x,y:decision.y});return;
        }
        if(headPat.pressing&&!isHead(e.clientX,e.clientY))stopHeadPat();
        updatePassThrough();
        // 鼠标跟随：记录软饱和目标，由眼球与头部的独立阻尼响应逼近。
        notePointer(e.clientX,e.clientY,performance.now());
      });
      on(window,'mouseup',e=>{
        if(e.button!==0)return;
        if(headPat.engaged){stopHeadPat(true);return;}
        if(headPat.pressing)releasePendingPat();
        if(windowDrag){windowDrag=false;leanTarget=0;gestures.pointerUp(e.clientX,e.clientY,performance.now());desktopApi.dragEnd();return;}
        const decision=gestures.pointerUp(e.clientX,e.clientY,performance.now());
        if(!decision)return;
        if(decision.type==='double-click')react('double',{x:e.clientX,y:e.clientY});
        if(decision.type==='click-arm'){
          const point={x:e.clientX,y:e.clientY};
          clearTimeout(clickTimer);
          clickTimer=setTimeout(()=>{const fired=gestures.expire(performance.now());if(fired?.type==='click')react(regionAt(point.y),point);},260);
        }
      });
      on(panel,'click',e=>{
        const act=e.target?.dataset?.act;if(!act)return;
        if(act==='close'){closePanel();return;}
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
        if((headPat.pressing||headPat.active)&&(paused||appliedMode!=='idle'||motionLocked||gestureLock||windowDrag))stopHeadPat();
        const wasPressing=headPat.pressing;
        headPat.tick(now);
        if(wasPressing&&headPat.active){
          clearTimeout(clickTimer);
          gestures.cancel();
          look.release();
        }
        paintHeadPat(now);
        // 鼠标跟随完全由 lookFollower 驱动，不再用内置 model.focus（那套是"方向满偏"）
        const busy=paused||appliedMode!=='idle'||motionLocked||gestureLock||windowDrag||headPat.pressing||headPat.engaged;
        if(busy)window.__idleStill=now;
        else if(!window.__idleStill)window.__idleStill=now;
        const groups=idleVarietyGroups(now-(window.__idleStill||now),{mode:appliedMode,locked:motionLocked||gestureLock||headPat.pressing||headPat.engaged,dragging:windowDrag,seed:window.__idleSeed||0});
        if(groups){window.__idleStill=now;window.__idleSeed=(window.__idleSeed||0)+1;void playClickMotions(groups);}
      };
    }
    if(!desktopApi){
      on(panel,'click',e=>{
        const act=e.target?.dataset?.act;if(!act)return;
        if(act==='close'){closePanel();return;}
        if(act==='larger')scaleDesktop(1.15);
        if(act==='smaller')scaleDesktop(1/1.15);
        if(act==='reset'){zoom=1;x=y=0;layout();scheduleSave();}
        if(act==='restore'){wardrobe=defaultWardrobe();saveWardrobe();}
        if(act==='auto'){motionLocked=false;activate(desiredMode);}
      });
    }
    on(canvas,'pointerdown',e=>{if(desktopApi||!panel.hidden||e.button!==0)return;drag={id:e.pointerId,x:e.clientX,y:e.clientY,px:x,py:y};canvas.setPointerCapture(e.pointerId);});
    on(canvas,'pointermove',e=>{if(!drag||drag.id!==e.pointerId)return;x=drag.px+e.clientX-drag.x;y=drag.py+e.clientY-drag.y;layout();});
    const endDrag=()=>{if(drag)scheduleSave();drag=null;};
    for(const e of ['pointerup','pointercancel','lostpointercapture'])on(canvas,e,endDrag);
    on(canvas,'wheel',e=>{if(windowDrag||(e.buttons&1))return;e.preventDefault();scaleDesktop(Math.exp(-e.deltaY*.001));},{passive:false});
    on(document.getElementById('pause'),'click',e=>{paused=!paused;e.target.textContent=paused?'继续':'暂停';});
    const manager=model.internalModel.motionManager;
    attachMotionPolicy(manager);
    PIXI.live2d.config.preserveExpressionOnMotion=true;
    let chain=Promise.resolve(),epoch=0,handRaised=false,lastExpression='',automaticHand='default',returningAutomaticHand=false;
    const activate=(mode,options={})=>{
      if(!Object.hasOwn(labels,mode))return;
      if(mode!=='idle')stopHeadPat();
      desiredMode=mode;badge.textContent=labels[mode];const revision=++epoch;
      const playIntro=options.intro!==false;
      chain=chain.catch(fail).then(async()=>{
        if(disposed||revision!==epoch)return;
        appliedMode=mode;
        const wantedHand=thinkingHand(mode,currentThinkingPhase);
        let group=mode==='answering'?'Answering':handRaised?'Return':'Idle';
        const intro=playIntro&&mode==='error'?'Flinch':null;
        if(!motionLocked&&!gestureLock){
          // Restore the outgoing automatic pose before changing hand families.
          // State changes invalidate stale transitions; user gestures always win.
          const outgoing=automaticHand!==wantedHand?handReturn(automaticHand):null;
          if(outgoing){
            automaticHand='default';returningAutomaticHand=true;
            await model.motion(outgoing,0,3);
            await new Promise(resolve=>setTimeout(resolve,1300));
            returningAutomaticHand=false;
            if(!motionLocked&&!gestureLock){
              for(const [id,value] of Object.entries(thinkingHandReturns))model.internalModel.coreModel.setParameterValueById(id,value);
            }
            if(disposed||revision!==epoch||motionLocked||gestureLock)return;
          }
          if(handRaised&&wantedHand!=='default'){
            await model.motion('Return',0,3);handRaised=false;
            await new Promise(resolve=>setTimeout(resolve,1100));
            if(disposed||revision!==epoch||motionLocked||gestureLock)return;
          }
          const entry=handEntry(wantedHand);
          if(entry)group=automaticHand===wantedHand?'Idle':entry;
          if(intro){
            const started=await model.motion(intro,0,3);
            if(!started && manager.state?.currentGroup!==intro)throw new Error(`动作 ${intro} 无法启动`);
            await new Promise(resolve=>setTimeout(resolve,1000));
            if(disposed||revision!==epoch||motionLocked||gestureLock)return;
          }
          const started=await model.motion(group,0,3);
          if(!started && manager.state?.currentGroup!==group)throw new Error(`动作 ${group} 无法启动`);
          automaticHand=wantedHand;
        }
        handRaised=mode==='answering';
        if(revision!==epoch||disposed)return;
        motion=group;
        expression='';
      }).catch(fail);
    };
    playClickMotions=async groups=>{
      const serial=++gestureSerial;
      gestureLock=true;automaticHand='default';
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
      for(const [id,value] of Object.entries(composeTargets(wardrobe,appliedMode==='thinking'?'idle':appliedMode))){
        try{coreModel.setParameterValueById(id,value);}catch{/* This model may not expose every catalog id. */}
      }
    };
    // Physics reads LeanInput and the skirt parameter before the mesh updates, so the targets have to be in place first.
    let frameLook={},frameThinking={},frameThinkingFace={};
    const followEnabled=()=>!paused&&!windowDrag&&!motionLocked&&!headPat.engaged&&(appliedMode==='idle'||appliedMode==='thinking');
    attachNaturalOverlay(model.internalModel,()=>{
      const now=performance.now();
      const idleEnabled=appliedMode==='idle'&&!gestureLock&&!motionLocked&&!windowDrag&&!paused&&!headPat.engaged;
      const point=look.update(now);
      const values=idleMotion.valueAt(now/1000,idleEnabled,{looking:look.active});
      const blocked=gestureLock||motionLocked||windowDrag||paused;
      const customFace=(wardrobe.eyes&&wardrobe.eyes!=='none')||wardrobe.sweat||wardrobe.darkFace||wardrobe.loadingFace||wardrobe.tears;
      frameThinkingFace=thinkingFace.valueAt(now/1000,appliedMode==='thinking'?currentThinkingPhase:null,blocked||customFace);
      frameThinking=thinkingMotion.valueAt(now/1000,appliedMode==='thinking'?currentThinkingPhase:null,{blocked,looking:look.active});
      for(const [id,value] of Object.entries(frameThinking)){
        if(!id.startsWith('ParamEye'))values[id]=(values[id]||0)+value;
      }
      frameLook=followEnabled()?lookParameters(point):{};
      // 本模型由 AngleX/Y 经 physics 驱动 ParamAngleX/Y，不能在物理计算后只改输出。
      values.AngleX=(values.AngleX||0)+(frameLook.ParamAngleX||0);
      values.AngleY=(values.AngleY||0)+(frameLook.ParamAngleY||0);
      const pat=headPat.feedback(now);
      values.AngleY+=pat.headY;
      values.AngleZ=(values.AngleZ||0)+pat.headZ;
      if(!blocked&&(appliedMode==='idle'||appliedMode==='thinking'))values.ParamBreath=breathValue(now/1000);
      return values;
    });
    model.internalModel.on('afterMotionUpdate',()=>{
      const coreModel=model.internalModel.coreModel;
      applyWardrobe(coreModel);
      if(!motionLocked&&!gestureLock&&!returningAutomaticHand&&automaticHand==='default'&&appliedMode!=='answering'){
        for(const [id,value] of Object.entries(thinkingHandReturns))coreModel.setParameterValueById(id,value);
      }
    });
    model.internalModel.on('beforeModelUpdate',()=>{
      const now=performance.now();
      const coreModel=model.internalModel.coreModel;
      if(appliedMode==='answering')coreModel.setParameterValueById('ParamMouthOpenY',.18+.32*(1+Math.sin(now*.017)));
      applyWardrobe(coreModel);
      // Expression accents live after saveParameters, and never overwrite saved choices.
      for(const [id,value] of Object.entries(frameThinkingFace)){
        if(!(id==='key7'&&wardrobe.blush))coreModel.addParameterValueById(id,value);
      }
      const pat=headPat.feedback(now);
      if(pat.blush>0&&!wardrobe.blush)coreModel.addParameterValueById('key7',pat.blush*.65);
      if(pat.eyeSmile>0&&(!wardrobe.eyes||wardrobe.eyes==='none')&&!wardrobe.loadingFace&&!wardrobe.tears){
        coreModel.addParameterValueById('EyeSmile',pat.eyeSmile);
        coreModel.addParameterValueById('LEyeSquint',pat.squint);
        coreModel.addParameterValueById('REyeSquint',pat.squint);
        coreModel.addParameterValueById('ParamMouthForm',pat.mouthForm);
      }
      // 空闲小动作不再禁用跟随；头部控制器已在物理之前叠加，这里只叠加眼珠。
      if(followEnabled()){
        for(const id of ['ParamEyeBallX','ParamEyeBallY']){
          coreModel.addParameterValueById(id,frameLook[id]||0);
        }
      }
      // 视线漂移：只在她没在表演时加，免得和动作抢眼珠
      if(appliedMode==='idle'&&!gestureLock&&!motionLocked&&!headPat.engaged&&!look.active){
        const g=gaze.valueAt(now/1000);
        try{
          coreModel.addParameterValueById('ParamEyeBallX',g.x);
          coreModel.addParameterValueById('ParamEyeBallY',g.y);
        }catch{/* 同上 */}
      }
      for(const id of ['ParamEyeBallX','ParamEyeBallY']){
        if(Object.hasOwn(frameThinking,id))coreModel.addParameterValueById(id,frameThinking[id]);
      }
      if(window.__nodOffset)coreModel.addParameterValueById('ParamAngleY',window.__nodOffset(now));
      if(desktopApi){
        lean+= (leanTarget-lean)*(1-Math.exp(-Math.min(50,now-(window.__leanAt||now))/140));
        window.__leanAt=now;
        if(!windowDrag)leanTarget=0;
        coreModel.addParameterValueById('ParamAngleZ',lean);
      }
      const open=blink.valueAt(now/1000,appliedMode!=='answering'&&!paused&&!gestureLock&&!motionLocked&&!windowDrag);
      if(open<1){
        coreModel.multiplyParameterValueById('ParamEyeLOpen',open);
        coreModel.multiplyParameterValueById('ParamEyeROpen',open);
      }
    });
    if(!report.idle)throw new Error('缺少 Idle 动作');
    const seed=Math.floor(Math.random()*4294967296);
    const idleMotion=createIdleMotion({seed});
    const thinkingFace=createThinkingFace({seed:seed+4});
    const thinkingMotion=createThinkingMotion({seed:seed+3});
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
          pointerAt={x:point.x,y:point.y};
          if(!headPat.engaged)notePointer(point.x,point.y,now);
          updatePassThrough();
        }else if(point?.inside===false){
          pointerAt=null;
          look.release();
          updatePassThrough();
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
    eventSource.onmessage=e=>{try{const s=JSON.parse(e.data);applyBalance(s.balance);const previousThinkingPhase=currentThinkingPhase;currentThinkingPhase=thinkingPhase(s.thinkingPhase);lastLinked=s.connected!==false;noteHost(lastLinked);if(s.connected===false){badge.textContent='未连接';badge.title='DSH 未连接，桌宠保持待机';if(desiredMode!=='idle')activate('idle');return;}if(s.mode!==desiredMode||(s.mode==='thinking'&&currentThinkingPhase!==previousThinkingPhase))activate(s.mode);else badge.textContent=labels[s.mode]||labels.idle;if(s.mode==='thinking')badge.textContent=({waiting:'等待响应',normal:'处理中',deep:'推理输出中'})[currentThinkingPhase];badge.title='跟随 DSH 实际回合状态';}catch(err){fail(err);}};
    eventSource.onerror=()=>{badge.title='宿主连接中断，正在重连';};
    let graphicsLost=false;
    on(canvas,'webglcontextlost',e=>{
      e.preventDefault();
      if(disposed||graphicsLost)return;
      stopHeadPat();
      graphicsLost=true;
      clearTimeout(hideTimer);
      if(!desktopApi?.recoverGraphics){
        fail(new Error('WebGL 上下文丢失，请刷新'));
        return;
      }
      status.hidden=false;
      status.textContent='图形上下文丢失，正在恢复…';
      const recoveryFailed=()=>{if(!disposed)fail(new Error('图形恢复失败，请退出并重新打开桌宠'));};
      desktopApi.recoverGraphics().then(scheduled=>{if(!scheduled)recoveryFailed();}).catch(recoveryFailed);
    });
    let then=performance.now(),lastPaceUi=0;status.textContent='已加载 · 状态联动已连接';
    const pace=createFramePace();
    const scheduleTick=wait=>{
      if(disposed||graphicsLost)return;
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
    on(document,'visibilitychange',()=>{if(document.hidden)stopHeadPat();else resumeDrawing();});
    function tick(now){
      if(disposed||graphicsLost)return;const dt=Math.min(50,now-then);then=now;
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
      Object.assign(canvas.dataset,{frames:String(frames),idlePlaying:String(!manager.isFinished()),zoom:String(zoom),offset:JSON.stringify([x,y]),mode:appliedMode,thinkingPhase:appliedMode==='thinking'?currentThinkingPhase:'',thinkingAccent:thinkingFace.snapshot().preset||'',expression,motion});
      scheduleTick(decision.wait);
    }
    raf=requestAnimationFrame(tick);hideTimer=setTimeout(()=>{if(!disposed&&frames>0)status.hidden=true;},2500);
    telemetryTimer=setInterval(()=>{if(!disposed)fetch('telemetry.json',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:appliedMode,frames,zoom,x,y,expression,motion})}).catch(()=>{});},750);
  }catch(e){fail(e);}
})();
