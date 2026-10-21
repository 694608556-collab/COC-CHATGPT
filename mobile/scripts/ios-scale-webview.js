// Injected exclusively by the DEBUG + simulator launch hook. Never packaged in Release.
window.__cocSmokeTask = (async () => {
  let stage = 'public-fixture'
  const counts = { fetch: 0, staged: 0, commits: 0, wholeReads: 0, failed: 0 }
  const rounds = []
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  const check = (ok, message) => {
    if (!ok) throw new Error(message)
  }
  try {
    const native = window.Capacitor.nativePromise.bind(window.Capacitor)
    const initial = await native('Logbook', 'getOverview', {})
    const data = JSON.parse(initial.json)
    check(
      data.modules.length === 50 &&
        data.records.length === 1050 &&
        data.records.every((r) => /^public-(record|manual)-\d+$/.test(r.id)),
      'Refusing non-public dataset'
    )
    await native('Logbook', 'selectArchive', { localFolder: true })
    // The app must observe the permission change through its normal foreground path.
    document.dispatchEvent(new Event('visibilitychange'))
    window.dispatchEvent(new Event('focus'))
    for (
      let i = 0;
      i < 80 && ![...document.querySelectorAll('button')].some((b) => b.textContent.trim() === '批量检测');
      i++
    )
      await sleep(250)
    window.Capacitor.nativePromise = async (plugin, method, args) => {
      if (plugin === 'Logbook') {
        if (['getState', 'getRecordContent', 'createExportSource'].includes(method)) counts.wholeReads++
        if (method === 'stageFetchResult') counts.staged++
        if (method === 'finishFetchBatch') counts.commits++
        if (method === 'fetchLog') {
          counts.fetch++
          const i = Number(new URL(args.url).searchParams.get('key').split('-').at(-1))
          const failed = i % 17 === 0
          if (failed) counts.failed++
          await sleep(1)
          return {
            url: 'https://dice-api.weizaima.com/dice/api/load_data',
            status: failed ? 503 : 200,
            text: JSON.stringify({
              messages: [
                {
                  nickname: '公开主持人',
                  content: 'PUBLIC RESULT ' + i + ' ' + 'B'.repeat(24000) + '中文😀末尾'
                }
              ]
            })
          }
        }
      }
      return native(plugin, method, args)
    }
    function button(text) {
      return [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === text)
    }
    for (let round = 0; round < 4; round++) {
      stage = 'round-' + (round + 1)
      window.__cocSmokeStage = stage
      check(button('批量检测'), 'Batch button missing')
      button('批量检测').click()
      await sleep(150)
      const boxes = [...document.querySelectorAll('.check-selector input[type=checkbox]')]
      check(boxes.length === 50, 'Expected 50 selectors')
      boxes.forEach((b, i) => {
        const wanted = round < 3 || i === 49
        if (b.checked !== wanted) b.click()
      })
      await sleep(100)
      check(button('开始检测') && !button('开始检测').disabled, 'Start disabled')
      button('开始检测').click()
      for (let i = 0; i < 1200 && !button('检测完毕'); i++) {
        await sleep(250)
        const error = document.querySelector('.batch-check .warning-text')?.textContent
        check(!error, error)
      }
      check(button('检测完毕'), 'Batch timeout')
      const expected = round < 3 ? (round + 1) * 1000 : 3020
      check(
        counts.fetch === expected &&
          counts.staged === expected &&
          counts.commits === round + 1 &&
          counts.wholeReads === 0,
        'Bridge counts mismatch'
      )
      const current = await native('Logbook', 'getOverview', {})
      check(
        current.revision === initial.revision + round + 1 && current.deferredRecordIds.length === 1050,
        'Revision/deferred mismatch'
      )
      const saved = JSON.parse(current.json)
      check(saved.records.filter((r) => r.sourceType === 'manual').length === 50, 'Manual rows changed')
      rounds.push({
        round: round + 1,
        scope: round < 3 ? 'all' : 'last-module',
        revision: current.revision,
        ...counts
      })
      button('检测完毕').click()
      await sleep(150)
    }
    stage = 'table-confirm-profile'
    window.__cocSmokeStage = stage
    const tableTiming = []
    const metadata = JSON.parse((await native('Logbook', 'getOverview', {})).json)
    check(metadata.records.length === 1050 && metadata.modules.length === 50, 'Profile baseline changed')
    const candidate = structuredClone(metadata)
    const module = candidate.modules[0]
    for (let i = 0; i < 300; i++)
      candidate.modules.push({
        ...module,
        id: 'public-profile-module-' + i,
        name: '公开计时模组' + i,
        order: 50 + i,
        pairs: [],
        kps: []
      })
    const record = candidate.records.find((r) => r.sourceType === 'online')
    for (let i = 0; i < 6000; i++) {
      const value = {
        ...record,
        id: 'public-profile-record-' + i,
        moduleId: 'public-profile-module-' + Math.floor(i / 20),
        name: '公开计时场次' + i,
        order: i % 20,
        sequenceNo: (i % 20) + 1,
        status: 'pending',
        link: 'https://log.weizaima.com/?key=public-profile-' + i
      }
      delete value.fetchedAt
      delete value.cacheSourceUrl
      candidate.records.push(value)
    }
    let profileBaseline = metadata
    const profileWorker = new Worker('snapshot-worker.js')
    let profileId = 0
    async function measuredCommit(snapshot, revision, scenario) {
      check(
        snapshot.records.every((r) => r.rawContent === undefined),
        'Profile must not transport old bodies'
      )
      const started = performance.now()
      const prepared = await new Promise((resolve, reject) => {
        const id = ++profileId
        profileWorker.onmessage = (event) => {
          if (event.data.id !== id) return
          if (event.data.error) reject(new Error(event.data.error))
          else resolve(event.data.result)
        }
        profileWorker.onerror = () => reject(new Error('Profile Worker failed'))
        profileWorker.postMessage({ id, job: { type: 'prepare', snapshot, measure: true } })
      })
      const preparedAt = performance.now()
      // This diagnostic retains full Worker prepare for comparison. Production uses its preview lease.
      const delta = {
        protocolVersion: 1,
        initialSettings: prepared.snapshot.settings,
        modulesAdded: prepared.snapshot.modules.slice(profileBaseline.modules.length),
        moduleParticipants: [],
        charactersAdded: [],
        recordsAdded: prepared.snapshot.records.slice(profileBaseline.records.length),
        manualUpdates: prepared.snapshot.records
          .slice(0, profileBaseline.records.length)
          .filter((r) => r.manualContent !== undefined)
      }
      const json = JSON.stringify(delta)
      const inputBytes = new TextEncoder().encode(json).length
      const bridgeAt = performance.now()
      const result = await native('Logbook', 'commitTableDelta', {
        json,
        expectedRevision: revision,
        measure: true
      })
      const receivedAt = performance.now()
      for (const timing of [prepared.timing, result.timing]) {
        check(
          timing &&
            Number.isFinite(timing.totalMs) &&
            timing.totalMs >= 0 &&
            Object.values(timing.phasesMs).every((ms) => Number.isFinite(ms) && ms >= 0),
          'Missing or invalid timing'
        )
        check(
          Object.values(timing.phasesMs).reduce((a, b) => a + b, 0) <= timing.totalMs,
          'Overlapping timing slices'
        )
      }
      check(result.revision === revision + 1, 'Profile must commit once')
      const state = await native('Logbook', 'getOverview', {})
      const saved = JSON.parse(state.json)
      check(
        state.revision === result.revision && saved.records.length === 7050 && saved.modules.length === 350,
        'Incomplete profile save'
      )
      for (const old of metadata.records)
        check(
          JSON.stringify(saved.records.find((r) => r.id === old.id)) === JSON.stringify(old) ||
            (scenario === 'single-manual-update' &&
              old.id === snapshot.records.find((r) => r.manualContent !== undefined)?.id),
          'Old metadata changed'
        )
      if (scenario === 'single-manual-update') {
        const manual = snapshot.records.find((r) => r.manualContent !== undefined)
        const full = JSON.parse(
          (
            await native('Logbook', 'getRecordContent', {
              ids: [manual.id],
              expectedRevision: result.revision
            })
          ).json
        )
        check(
          full.records.length === 1 && full.records[0].manualContent === manual.manualContent,
          'Manual blank lines/Unicode changed'
        )
      }
      tableTiming.push({
        scenario,
        protocol: 'table-delta-v1',
        preparation: 'full Worker prepare plus diagnostic delta encoding; production uses preview lease',
        clock: 'webview-monotonic',
        fixture: 'after-3020-generated-public-fetch-results',
        modules: saved.modules.length,
        records: saved.records.length,
        inputBytes,
        diagnosticByteCountMs: bridgeAt - preparedAt,
        totalMs: receivedAt - started,
        prepareRoundTripMs: preparedAt - started,
        // Encoding for the diagnostic byte count is excluded from this bridge interval.
        bridgeRoundTripMs: receivedAt - bridgeAt,
        worker: prepared.timing,
        native: result.timing
      })
      profileBaseline = structuredClone(saved)
      return { saved, revision: result.revision }
    }
    try {
      const appended = await measuredCommit(candidate, initial.revision + 4, 'append-6000')
      const single = appended.saved
      const manual = single.records.find((r) => r.sourceType === 'manual')
      manual.manualContent = '公开计时首行\n\n公开计时末行😀'
      manual.updatedAt = new Date().toISOString()
      await measuredCommit(single, appended.revision, 'single-manual-update')
    } finally {
      profileWorker.terminate()
    }
    return {
      passed: true,
      stage: 'complete',
      network: 'generated public responses only',
      campaigns: 50,
      online: 1000,
      manual: 50,
      rounds,
      counts,
      tableTiming,
      countsScope: 'four fetch rounds; profile manual proof readback happens after timed confirmation',
      profileManualReadbacks: 1
    }
  } catch (error) {
    return { passed: false, stage, error: String(error?.message || error), counts, rounds }
  }
})()
window.__cocSmokeTask.then((result) => {
  window.__cocSmokeResult = result
})
true
