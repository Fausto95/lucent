import {expect,test} from 'vite-plus/test';
import {compile,T,type LibraryModule} from '../src/index.ts';
import {generateSwift} from '../../backend-swift/src/index.ts';
import {generateKotlin} from '../../backend-kotlin/src/index.ts';
const library:LibraryModule={source:'',views:{Badge:{props:{title:T.string},required:['title'],children:'none',swift:{template:'Text({{prop:title}}).bold()',imports:['SwiftUI']},kotlin:{template:'Text(text = {{prop:title}})',imports:['androidx.compose.material3.Text']}}}};
const options={fileName:'badge.lucent.tsx',libraries:{'@lucent-lang/widgets':library}};
test('compiles a package native view without a built-in primitive',()=>{
 const result=compile('import {Badge} from "@lucent-lang/widgets"; import type {NativeView} from "@lucent-lang/ui"; export function Demo():NativeView{return <Badge title="Hello"/>;}',options);
 expect(result.diagnostics).toEqual([]);expect(result.module).not.toBeNull();
 expect(generateSwift(result.module!).code).toContain('Text("Hello").bold()');
 expect(generateKotlin(result.module!).code).toContain('Text(text = "Hello")');
});
test('checks package view props before native emission',()=>{
 expect(compile('import {Badge} from "@lucent-lang/widgets"; import type {NativeView} from "@lucent-lang/ui"; export function Demo():NativeView{return <Badge title={42}/>;}',options).module).toBeNull();
});
test('rejects invalid package templates before native emission',()=>{
 const broken=structuredClone(library);broken.views!.Badge!.swift.template='Text({{prop:missing}})';
 expect(compile('import {Badge} from "@lucent-lang/widgets"; import type {NativeView} from "@lucent-lang/ui"; export function Demo():NativeView{return <Badge title="Hello"/>;}',{...options,libraries:{'@lucent-lang/widgets':broken}}).module).toBeNull();
});
