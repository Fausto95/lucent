import {expect,test} from 'vite-plus/test';
import {mkdtempSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {loadLucentConfig} from '../src/config.ts';
const config = (text:string, extension='ts') => {const root=mkdtempSync(join(tmpdir(),'lucent-config-'));writeFileSync(join(root,`lucent.config.${extension}`),text);return loadLucentConfig(root);};
test('reads declarative typed capability config without executing code',()=>{
 const c=config('import {defineNativeConfig} from "@lucent-lang/config"; export default defineNativeConfig({capabilities:{camera:{reason:"Scan a document"},location:{whenInUse:{reason:"Nearby places"}},network:true}});');
 expect(c.capabilities).toEqual(['camera','location','network']);
 expect(c.platformConfig.infoPlist).toMatchObject({NSCameraUsageDescription:'Scan a document',NSLocationWhenInUseUsageDescription:'Nearby places'});
 expect(c.platformConfig.androidPermissions).toContain('android.permission.CAMERA');
 expect(c.platformConfig.androidPermissions).toContain('android.permission.INTERNET');
});
test.each(['camera:{reason:""}','madeUp:true','camera:true'])('rejects invalid capabilities %s',value=>{
 expect(()=>config(`export default {capabilities:{${value}}};`)).toThrow();
});
test('rejects executable config expressions',()=>{
 expect(()=>config('export default process.exit(0);')).toThrow();
});
test('retains legacy capability allowlists',()=>{
 expect(config('{"capabilities":["clock"]}','json').capabilities).toEqual(['clock']);
});
