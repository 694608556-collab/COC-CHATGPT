import {expect,test} from '@playwright/test'
import {searchSample} from '../src/dev/sample'
import {acceptAppConfirmations,expandModules} from './helpers'

test('逐场搜索只返回摘要，取消旧查询不覆盖新结果，连续阅读重取完整正文且不改原库',async({page})=>{
 test.setTimeout(60000)
 await acceptAppConfirmations(page);page.on('dialog',dialog=>dialog.accept())
 await page.route('**/app.js',async route=>{
  const response=await route.fetch(),source=await response.text(),declaration=/var (\w+) = createBrowserPort\(\);/
  expect(source).toMatch(declaration)
  await route.fulfill({response,body:source.replace(declaration,(line,browser)=>`${line}
    {
      const port=${browser}.port, overview=port.getOverview.bind(port), content=port.getRecordContent.bind(port);
      const probe=window.__bodyStreamProbe={searches:[],reads:[],files:{},writes:0,hold:false,release:null};
      port.getOverview=async()=>{const state=await overview();return sessionStorage.getItem('public-native-search')?{...state,backupStreamVersion:1,bodySearchStreamVersion:1}:state};
      port.getRecordContent=async input=>{probe.reads.push(input.ids);return content(input)};
      port.createSearchSource=async input=>{
        probe.searches.push(input.ids);const value=await content(input), bytes=new TextEncoder().encode(value.json);
        const sha=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
        const id='public-read-'+probe.searches.length;probe.files[id]=value.json;
        if(probe.hold)await new Promise(resolve=>{probe.release=resolve});
        return {id,revision:value.revision,source:{fileUri:location.origin+'/_capacitor_file_/'+id,bytes:bytes.length,sha256:sha}};
      };
      port.cancelBackupStage=async ({id})=>{delete probe.files[id]};
      for(const method of ['appendBackupStage','finishBackupPreview','commitBackupRestore','createBackupStream','finishBackupExport'])port[method]=async()=>{probe.writes++;throw Error('Readonly search must not write')};
    }`)})
 })
 await page.route('**/_capacitor_file_/public-read-*',async route=>{
  const id=new URL(route.request().url()).pathname.split('/').pop()!
  const json=await page.evaluate(id=>(window as any).__bodyStreamProbe.files[id],id)
  expect(typeof json).toBe('string')
  await route.fulfill({contentType:'application/json',body:json})
 })
 const sample=searchSample(),first=sample.records[0]!
 sample.modules=[sample.modules[0]!];sample.characters=[]
 sample.records=Array.from({length:3},(_,index)=>({...first,id:'public-stream-'+index,name:'只读场次'+index,moduleId:sample.modules[0]!.id,order:index,
  rawContent:{...first.rawContent!,messages:[{...first.rawContent!.messages[0]!,text:'NEEDLE '+index+' '+ 'A'.repeat(1024*1024)+' 完整结尾'+index}]}}))
 await page.goto('/')
 await page.getByRole('button',{name:'选择并确认保存位置'}).click()
 await page.getByRole('button',{name:'数据与设置',exact:true}).click()
 const chooser=page.waitForEvent('filechooser');await page.getByRole('button',{name:'选择备份并预览'}).click()
 await(await chooser).setFiles({name:'public-read-only.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(sample))})
 await page.getByRole('button',{name:'确认覆盖并导入'}).click()
 await expect(page.getByRole('status')).toContainText('导入完成')
 await page.evaluate(()=>sessionStorage.setItem('public-native-search','yes'));await page.reload();await expandModules(page)
 const search=page.getByRole('searchbox',{name:'搜索该模组所有场次正文'})
 await search.fill('needle')
 await expect(page.locator('.module-body-search [role="status"]')).toContainText('匹配 3 个场次')
 expect(await page.evaluate(()=>(window as any).__bodyStreamProbe.reads)).toEqual([])
 await page.locator('.search-result').first().click()
 await expect(page.locator('.messages')).toContainText('完整结尾0')
 await page.getByRole('button',{name:'返回上一页',exact:true}).click()
 await page.locator('.record-card').nth(1).click()
 await expect(page.locator('.messages')).toContainText('完整结尾1')
 await page.getByRole('button',{name:'返回上一页',exact:true}).click()
 await page.locator('.record-card').first().click()
 await expect(page.locator('.messages')).toContainText('完整结尾0')
 await page.getByRole('button',{name:'返回上一页',exact:true}).click()
 expect(await page.evaluate(()=>(window as any).__bodyStreamProbe.reads)).toEqual([['public-stream-0'],['public-stream-1'],['public-stream-0']])
 await page.evaluate(()=>{(window as any).__bodyStreamProbe.hold=true})
 await search.fill('not-present')
 await expect.poll(()=>page.evaluate(()=>typeof (window as any).__bodyStreamProbe.release)).toBe('function')
 await search.fill('needle')
 await page.evaluate(()=>{(window as any).__bodyStreamProbe.hold=false;(window as any).__bodyStreamProbe.release()})
 await expect(page.locator('.module-body-search [role="status"]')).toContainText('匹配 3 个场次')
 await expect.poll(()=>page.evaluate(()=>Object.keys((window as any).__bodyStreamProbe.files).length)).toBe(0)
 expect(await page.evaluate(()=>(window as any).__bodyStreamProbe.writes)).toBe(0)
})
