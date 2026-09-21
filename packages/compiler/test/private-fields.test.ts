import {expect,test} from 'vite-plus/test';
import {compile} from '../src/index.ts';
const source='export class Processor { private quality:number=1; constructor(value:number){this.quality=value;} process(bytes:Uint8Array):Uint8Array{return bytes;} value():number{return this.quality;} }';
test('keeps private native state while omitting bridge accessors',()=>{
 const r=compile(source,{fileName:'object.lucent.ts'});expect(r.diagnostics).toEqual([]);
 expect(r.module?.functions.some(f=>f.classOp?.member==='quality' && f.exported)).toBe(false);
 expect(r.module?.structs[0]?.fields.some(f=>f.name==='quality')).toBe(true);
});
test('rejects private state access from another function',()=>{
 expect(compile(source+' export function peek(p:Processor):number{return p.quality;}',{fileName:'object.lucent.ts'}).module).toBeNull();
});
