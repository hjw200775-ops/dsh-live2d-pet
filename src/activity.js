// Contracts verified against the installed dsh-agent-loop 0.2.0-rc.2.
import { cleanBalance } from './balance.mjs';
export function createActivity({errorHoldMs = 6000} = {}) {
  const agents = new Map(), listeners = new Set(), history = [];
  let timer, seq = 0, current = {mode:'idle',seq:0,event:'boot',at:Date.now(),activeCount:0};
  const snapshot = () => ({...current});
  const publish = event => {
    const values = [...agents.values()];
    const mode = values.some(x=>x.error) ? 'error' : values.some(x=>x.running && x.mode==='answering') ? 'answering' : values.some(x=>x.running) ? 'thinking' : 'idle';
    const activeCount = values.filter(x=>x.running).length;
    if(mode===current.mode && activeCount===current.activeCount) return;
    current={mode,activeCount,event,at:Date.now(),seq:++seq};
    history.push(snapshot()); if(history.length>80) history.shift();
    for(const fn of listeners) fn(snapshot());
  };
  const expire = () => {
    clearTimeout(timer);
    const now=Date.now(); let next=Infinity;
    for(const [id,s] of agents) {
      if(s.error && s.error<=now) s.error=0;
      if(!s.running && !s.error) agents.delete(id);
      else if(s.error) next=Math.min(next,s.error);
    }
    publish('error-expired');
    if(next<Infinity) timer=setTimeout(expire,Math.max(1,next-now));
  };
  function receive(event,p) {
    const id=p?.agent?.id;
    if(typeof id!=='string') return;
    const s=agents.get(id)||{running:false,mode:'thinking',error:0};
    if(event==='agent/status') {
      s.running=p.status==='running';
      if(s.running){s.mode='thinking';s.error=0;}
    } else if(event==='agent/error') { s.running=false;s.error=Date.now()+errorHoldMs; }
    else if(event==='agent/assistant-stream') {
      const f=p.frame;
      if(f?.type==='start'){s.running=true;s.mode='thinking';s.error=0;}
      if(f?.type==='chunk') {
        const c=f.chunk;
        if(c?.type==='reasoning-delta' || c?.type==='tool-call-delta'){s.running=true;s.mode='thinking';}
        if(c?.type==='text-delta' && c.text){s.running=true;s.mode='answering';}
        if(c?.type==='finish' && c.reason?.kind==='error'){s.error=Date.now()+errorHoldMs;s.running=false;}
        // A normal stream end is not a turn end: tool steps can follow it.
      }
    }
    agents.set(id,s);publish(event);expire();
  }
  return {receive,snapshot,history:()=>history.map(x=>({...x})),subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);},dispose(){clearTimeout(timer);listeners.clear();agents.clear();}};
}

// The desktop pet only accepts the reduced mode. It never sees prompt text.
export function createDesktopLink({staleMs=3000}={}) {
  const listeners=new Set();
  let timer,seq=0;
  let current={mode:'idle',connected:false,seq:0,event:'boot',at:Date.now(),activeCount:0,balance:null};
  let refresh=false;
  const publish=event=>{
    current={...current,event,at:Date.now(),seq:++seq};
    const snap={...current};
    for(const fn of listeners)fn(snap);
  };
  return {
    ingest(input){
      const mode=['idle','thinking','answering','error'].includes(input?.mode)?input.mode:'idle';
      const activeCount=Number.isFinite(Number(input?.activeCount))?Math.max(0,Math.min(99,Number(input.activeCount))):0;
      const balance=Object.hasOwn(input||{},'balance')?cleanBalance(input.balance):current.balance;
      clearTimeout(timer);
      current={mode,connected:true,activeCount,balance,seq,event:'link',at:Date.now()};
      timer=setTimeout(()=>{current={mode:'idle',connected:false,activeCount:0,balance:current.balance,seq,event:'disconnect',at:Date.now()};publish('disconnect');},staleMs);
      publish('link');
    },
    requestRefresh(){refresh=true;},
    takeRefresh(){const wanted=refresh;refresh=false;return wanted;},
    snapshot:()=>({...current}),
    history:()=>[],
    subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);},
    dispose(){clearTimeout(timer);listeners.clear();}
  };
}
