// Injected exclusively by the DEBUG + simulator launch hook. Never packaged in Release.
window.__cocSmokeTask = (async () => {
  let stage = 'public-fixture';
  const counts = { fetch: 0, staged: 0, commits: 0, wholeReads: 0, failed: 0 };
  const rounds = [];
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const check = (ok, message) => { if (!ok) throw new Error(message); };
  try {
    const native = window.Capacitor.nativePromise.bind(window.Capacitor);
    const initial = await native('Logbook', 'getOverview', {});
    const data = JSON.parse(initial.json);
    check(data.modules.length === 50 && data.records.length === 1050 && data.records.every(r => /^public-(record|manual)-\d+$/.test(r.id)), 'Refusing non-public dataset');
    await native('Logbook', 'selectArchive', { localFolder: true });
    // The app must observe the permission change through its normal foreground path.
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('focus'));
    for (let i=0;i<80 && ![...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='批量检测');i++) await sleep(250);
    window.Capacitor.nativePromise = async (plugin, method, args) => {
      if (plugin === 'Logbook') {
        if (['getState', 'getRecordContent', 'createExportSource'].includes(method)) counts.wholeReads++;
        if (method === 'stageFetchResult') counts.staged++;
        if (method === 'finishFetchBatch') counts.commits++;
        if (method === 'fetchLog') {
          counts.fetch++;
          const i = Number(new URL(args.url).searchParams.get('key').split('-').at(-1));
          const failed = i % 17 === 0;
          if (failed) counts.failed++;
          await sleep(1);
          return { url:'https://dice-api.weizaima.com/dice/api/load_data', status:failed?503:200,
            text:JSON.stringify({messages:[{nickname:'公开主持人',content:'PUBLIC RESULT '+i+' '+'B'.repeat(24000)+'中文😀末尾'}]}) };
        }
      }
      return native(plugin, method, args);
    };
    function button(text) { return [...document.querySelectorAll('button')].find(b => b.textContent.trim() === text); }
    for (let round=0; round<4; round++) {
      stage = 'round-'+(round+1); window.__cocSmokeStage=stage;
      check(button('批量检测'), 'Batch button missing'); button('批量检测').click(); await sleep(150);
      const boxes = [...document.querySelectorAll('.check-selector input[type=checkbox]')];
      check(boxes.length === 50, 'Expected 50 selectors');
      boxes.forEach((b,i) => { const wanted=round<3 || i===49; if (b.checked !== wanted) b.click(); });
      await sleep(100); check(button('开始检测') && !button('开始检测').disabled, 'Start disabled'); button('开始检测').click();
      for (let i=0; i<1200 && !button('检测完毕'); i++) {
        await sleep(250);
        const error=document.querySelector('.batch-check .warning-text')?.textContent;
        check(!error, error);
      }
      check(button('检测完毕'), 'Batch timeout');
      const expected = round<3 ? (round+1)*1000 : 3020;
      check(counts.fetch === expected && counts.staged === expected && counts.commits === round+1 && counts.wholeReads === 0, 'Bridge counts mismatch');
      const current=await native('Logbook','getOverview',{});
      check(current.revision === initial.revision+round+1 && current.deferredRecordIds.length === 1050, 'Revision/deferred mismatch');
      const saved=JSON.parse(current.json);
      check(saved.records.filter(r=>r.sourceType==='manual').length===50, 'Manual rows changed');
      rounds.push({round:round+1, scope:round<3?'all':'last-module', revision:current.revision, ...counts});
      button('检测完毕').click(); await sleep(150);
    }
    return {passed:true,stage:'complete',network:'generated public responses only',campaigns:50,online:1000,manual:50,rounds,counts};
  } catch(error) { return {passed:false,stage,error:String(error?.message||error),counts,rounds}; }
})();
window.__cocSmokeTask.then(result => { window.__cocSmokeResult = result; });
true;
