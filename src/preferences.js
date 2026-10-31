import {readFile,writeFile,rename,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {randomBytes} from 'node:crypto';

export function sanitizePreferences(input, previous = {version:1,model:{zoom:1,x:0,y:0}}) {
  const result=structuredClone(previous);
  const finite=(n,min,max)=>typeof n==='number' && Number.isFinite(n) && n>=min && n<=max;
  if(input?.overlay && finite(input.overlay.left,0,100000) && finite(input.overlay.top,0,100000)) result.overlay={left:input.overlay.left,top:input.overlay.top};
  if(input?.model && finite(input.model.zoom,.25,3) && finite(input.model.x,-10000,10000) && finite(input.model.y,-10000,10000)) result.model={zoom:input.model.zoom,x:input.model.x,y:input.model.y};
  return result;
}
export async function createPreferences(file) {
  let value=sanitizePreferences({}), pending=Promise.resolve();
  if(file)try {value=sanitizePreferences(JSON.parse(await readFile(file,'utf8')));}catch(e){if(e.code!=='ENOENT')throw new Error('无法读取桌宠位置存档，请检查 preferences.json');}
  return {get:()=>structuredClone(value),async update(patch){
    value=sanitizePreferences(patch,value);const data=JSON.stringify(value,null,2);
    if(file) {
      const task=pending.catch(()=>{}).then(async()=>{
        await mkdir(path.dirname(file),{recursive:true});
        const temporary=`${file}.${randomBytes(6).toString('hex')}.tmp`;
        await writeFile(temporary,data,'utf8');await rename(temporary,file);
      });pending=task;await task;
    }
    return structuredClone(value);
  },flush:()=>pending};
}
