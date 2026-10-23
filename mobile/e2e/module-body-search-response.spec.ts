import { expect, test } from '@playwright/test'
import { build } from 'esbuild'

test('模组搜索先绘制本地反馈再开始父级工作，首次和后续提交都保留完整结果', async ({ page }) => {
  const code = await build({
    stdin: {
      resolveDir: process.cwd(),
      loader: 'tsx',
      contents: `
        import React, {useState} from 'react';
        import {createRoot} from 'react-dom/client';
        import {ModuleBodySearch} from './src/MobileApp/components/Records/ModuleBodySearch';
        import {searchSample} from './src/dev/sample';
        const sample=searchSample(), records=[sample.records[0]];
        const probe=window.__responseProbe={submissions:[]};
        document.addEventListener('submit',()=>{
          const item={start:performance.now(),visible:0,dispatch:0,statusAtDispatch:''};
          probe.submissions.push(item);
          const observer=new MutationObserver(()=>{
            const status=document.querySelector('[role=status]');
            if(!status?.textContent.includes('正在'))return;
            observer.disconnect();
            requestAnimationFrame(()=>{item.visible=performance.now()-item.start});
          });
          observer.observe(document.getElementById('root'),{subtree:true,childList:true,characterData:true});
        },true);
        function App(){
          const [query,setQuery]=useState('first'),[submitted,setSubmitted]=useState(''),[result,setResult]=useState();
          return <ModuleBodySearch streaming ready={false} busy={false}
            moduleId={records[0].moduleId} moduleName="公开测试" records={records}
            preset={sample.settings.filterPreset} query={query} submittedQuery={submitted}
            onQuery={value=>{setQuery(value);setSubmitted('')}}
            onSearch={value=>{
              const item=probe.submissions[probe.submissions.length-1];
              item.dispatch=performance.now()-item.start;
              item.statusAtDispatch=document.querySelector('[role=status]')?.textContent || '';
              // Deterministic stand-in for the first large parent render. The
              // actual production component must paint before entering it.
              const until=performance.now()+180;while(performance.now()<until){}
              setSubmitted(value);
              setResult({query:value,revision:1,presetKey:'',hits:[{id:records[0].id,matches:1,excerpt:'完整结果 '+value}]});
            }} onRead={()=>{}} result={result}/>;
        }
        const root=createRoot(document.getElementById('root'));
        probe.unmount=()=>root.unmount();
        root.render(<App/>);
      `
    },
    bundle: true,
    write: false,
    format: 'iife',
    target: 'chrome69'
  })
  await page.route('**/body-search-response-test', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' })
  )
  await page.goto('/body-search-response-test')
  await page.addScriptTag({ content: code.outputFiles[0]!.text })
  const search = page.getByRole('searchbox', { name: '搜索该模组所有场次正文' })
  for (const query of ['first', 'second']) {
    await search.fill(query)
    await search.press('Enter')
    await expect(page.locator('.search-result')).toContainText('完整结果 ' + query)
  }
  const submissions = await page.evaluate(() => (window as any).__responseProbe.submissions)
  expect(submissions).toHaveLength(2)
  for (const submission of submissions) {
    expect(submission.statusAtDispatch).toContain('正在逐场搜索已保存正文')
    expect(submission.visible).toBeGreaterThan(0)
    expect(submission.visible).toBeLessThanOrEqual(100)
    expect(submission.dispatch).toBeGreaterThanOrEqual(submission.visible)
  }

  // Change the actual controlled input before the queued paint turn. This must
  // cancel the old search rather than publish a result for a cleared query.
  await page.evaluate(() => {
    document.querySelector('form')!.requestSubmit()
    const input = document.querySelector('input')!
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await expect(search).toHaveValue('')
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0))))
  expect(await page.evaluate(() => (window as any).__responseProbe.submissions[2].dispatch)).toBe(0)
  await expect(page.getByRole('status')).toHaveCount(0)

  // An unmounted module may not dispatch its formerly queued query either.
  await search.fill('unmount')
  await page.evaluate(() => {
    document.querySelector('form')!.requestSubmit()
    ;(window as any).__responseProbe.unmount()
  })
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0))))
  expect(await page.evaluate(() => (window as any).__responseProbe.submissions[3].dispatch)).toBe(0)
  await expect(search).toHaveCount(0)
})
