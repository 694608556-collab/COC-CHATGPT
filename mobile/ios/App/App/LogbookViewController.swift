import Capacitor
import UIKit
import WebKit

final class LogbookViewController: CAPBridgeViewController {
    #if DEBUG && targetEnvironment(simulator)
    private var nameTrace: PublicNameTrace?
    #endif
    #if DEBUG
    private var smokeStarted = false
    private var scaleMode: Bool {
        #if targetEnvironment(simulator)
        return ProcessInfo.processInfo.arguments.contains("--coc-ios-scale")
        #else
        return false
        #endif
    }
    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        if scaleMode, !smokeStarted {
            smokeStarted = true
            do {
                let script = try String(contentsOf: FileManager.default.temporaryDirectory.appendingPathComponent("ios-scale-webview.js"), encoding: .utf8)
                startSmokeWhenReady(script, deadline: Date().addingTimeInterval(60))
            } catch { writeSmokeResult(["passed": false, "stage": "public-scale-script", "error": error.localizedDescription]) }
            return
        }
        guard ProcessInfo.processInfo.arguments.contains("--coc-ios-smoke"), !smokeStarted else { return }
        smokeStarted = true
        DispatchQueue.main.asyncAfter(deadline: .now() + 3) {
            let script = """
            // Keep the pending diagnostic task rooted until WebKit receives its result.
            window.__cocSmokeTask = (async () => {
            let stage='startup'; window.__cocSmokeStage=stage;
            const info={href:location.href,secureContext:window.isSecureContext,hasCrypto:!!window.crypto,hasSubtle:!!window.crypto?.subtle};
            try {
            for(let i=0;i<120 && !document.querySelector('.app-header');i++) await new Promise(r=>setTimeout(r,250));
            if(!document.querySelector('.app-header')) throw new Error('Startup DOM timeout');
            stage='native-overview'; window.__cocSmokeStage=stage;
            const state=await window.Capacitor.nativePromise('Logbook','getOverview',{});
            if(state.revision!==0 || state.json!==null || state.archive.valid) throw new Error('Unexpected fresh native state');
            stage='packaged-worker'; window.__cocSmokeStage=stage;
            const empty={schemaVersion:2,exportedAt:new Date().toISOString(),modules:[],records:[],characters:[],settings:{theme:'light',filterPreset:{}}};
            async function workerJob(url,job) {
              return new Promise((resolve,reject)=>{
                const worker=new Worker(url);
                const timeout=setTimeout(()=>{worker.terminate();reject(new Error('Packaged worker timeout: '+url));},30000);
                worker.onerror=event=>{clearTimeout(timeout);worker.terminate();reject(new Error('Packaged worker failed: '+url+' '+event.message));};
                worker.onmessage=e=>{clearTimeout(timeout);worker.terminate();if(e.data.error)reject(new Error(e.data.error));else resolve(e.data.result);};
                worker.postMessage({id:1,job});
              });
            }
            const parsed=await workerJob('snapshot-worker.js',{type:'read',json:JSON.stringify(empty)});
            if(parsed?.snapshot?.schemaVersion!==2 || parsed.snapshot.records.length!==0) throw new Error('Snapshot worker output mismatch');
            stage='export-worker'; window.__cocSmokeStage=stage;
            const now=new Date().toISOString(), marker='COC_WORKER_PUBLIC_中文😀';
            const module={id:'smoke-module',name:'公开验证',playStatus:'running',kps:[],pairs:[],order:0,collapsed:false,createdAt:now,updatedAt:now};
            const record={id:'smoke-record',moduleId:module.id,name:'公开正文',sequenceNo:1,sourceType:'manual',status:'manual',dateSource:'none',manualContent:marker,order:0,createdAt:now,updatedAt:now};
            const exported=await workerJob('export-worker.js',{type:'export',module,records:[record],filters:{},format:'txt',combined:false});
            if(!exported?.bytes || !new TextDecoder().decode(exported.bytes).includes(marker)) throw new Error('Export worker output mismatch');
            stage='webcrypto'; window.__cocSmokeStage=stage;
            const hash=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode('abc')));
            if(Array.from(hash,b=>b.toString(16).padStart(2,'0')).join('')!=='ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad') throw new Error('WebCrypto mismatch');
            stage='fonts'; window.__cocSmokeStage=stage;
            await document.fonts.ready;
            if(!document.body.innerText.includes('选择并确认保存位置')) throw new Error('Native startup screen not ready: '+document.body.innerText);
            stage='ios-appearance'; window.__cocSmokeStage=stage;
            const header=document.querySelector('.app-header'), brand=header.querySelector('.app-brand');
            if(header.querySelector('.app-back') || !brand || Math.abs(brand.getBoundingClientRect().left-header.getBoundingClientRect().left-parseFloat(getComputedStyle(header).paddingLeft))>=1) throw new Error('iOS header back button or brand alignment mismatch');
            if(!document.querySelector('meta[name="viewport"]').content.includes('maximum-scale=1')) throw new Error('Missing iOS focus scale bound');
            document.documentElement.dataset.theme='dark';
            await new Promise(requestAnimationFrame);
            if(getComputedStyle(document.documentElement).colorScheme!=='dark') throw new Error('Native color scheme not dark');
            return {...info,stage:'complete',passed:true,nativeOverview:true,packagedWorker:true,exportWorker:true,webCrypto:true,fontsReady:document.fonts.status==='loaded',secureContext:window.isSecureContext,userAgent:navigator.userAgent,iosViewportPolicy:true,darkColorScheme:true};
            } catch(error) { return {...info,passed:false,stage,error:String(error?.message||error),stack:String(error?.stack||'')}; }
            })();
            window.__cocSmokeTask.then(result => { window.__cocSmokeResult = result; });
            true;
            """
            self.startSmokeWhenReady(script, deadline: Date().addingTimeInterval(60))
        }
    }

    /// Wait across the initial WKWebView navigation before creating a page-owned task.
    private func startSmokeWhenReady(_ script: String, deadline: Date) {
        webView?.evaluateJavaScript("!!document.querySelector('.app-header') && typeof window.Capacitor?.nativePromise === 'function'") { value, _ in
            if (value as? Bool) == true {
                // Only synchronous values cross the native evaluation boundary.
                self.webView?.evaluateJavaScript(script) { _, error in
                    if let error = error {
                        self.writeSmokeResult(["passed": false, "stage": "javascript-start", "error": error.localizedDescription])
                    } else {
                        self.pollSmokeResult(deadline: Date().addingTimeInterval(self.scaleMode ? 900 : 90))
                    }
                }
            } else if Date() >= deadline {
                self.writeSmokeResult(["passed": false, "stage": "page-readiness", "error": "Initial navigation did not expose the app and bridge within 60 seconds"])
            } else {
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) {
                    self.startSmokeWhenReady(script, deadline: deadline)
                }
            }
        }
    }

    /// Read a completed public diagnostic result; pending tasks have a bounded deadline.
    private func pollSmokeResult(deadline: Date) {
        webView?.evaluateJavaScript("({result:window.__cocSmokeResult ?? null,stage:window.__cocSmokeStage ?? 'missing',taskPresent:!!window.__cocSmokeTask,href:location.href})") { value, error in
            let progress = value as? LogbookJSON ?? [:]
            if let result = progress["result"] as? LogbookJSON {
                self.writeSmokeResult(result)
            } else if let error = error {
                self.writeSmokeResult(["passed": false, "stage": "javascript-poll", "error": error.localizedDescription])
            } else if Date() >= deadline {
                self.writeSmokeResult(["passed": false, "stage": "javascript-deadline", "error": "Diagnostic task did not settle within 90 seconds", "progress": progress])
            } else {
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) {
                    self.pollSmokeResult(deadline: deadline)
                }
            }
        }
    }

    /// Persist only public sample checks and native environment flags for CI.
    private func writeSmokeResult(_ result: LogbookJSON) {
        var output = result
        output["nativeSystemVersion"] = UIDevice.current.systemVersion
        output["appVersion"] = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "unknown"
        output["appBuild"] = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "unknown"
        if #available(iOS 26.0, *) {
            let hidden = webView?.scrollView.topEdgeEffect.isHidden == true && webView?.scrollView.bottomEdgeEffect.isHidden == true
            output["scrollEdgeEffectsHidden"] = hidden
            if !hidden { output["passed"] = false }
        }
        try? logbookData(output).write(to: FileManager.default.temporaryDirectory.appendingPathComponent(scaleMode ? "ios-scale-result.json" : "ios-smoke-result.json"), options: [.atomic])
    }
    #endif
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(LogbookPlugin())
        #if DEBUG && targetEnvironment(simulator)
        if ProcessInfo.processInfo.arguments.contains("--coc-picker-ui"),
           ProcessInfo.processInfo.arguments.contains("--coc-name-trace"), let webView = webView {
            let trace = PublicNameTrace()
            nameTrace = trace
            webView.configuration.userContentController.add(trace, name: "cocPublicNameTrace")
            webView.configuration.userContentController.addUserScript(WKUserScript(source: PublicNameTrace.script, injectionTime: .atDocumentStart, forMainFrameOnly: true))
            // capacitorDidLoad may follow the initial document-start callback.
            webView.evaluateJavaScript(PublicNameTrace.script, completionHandler: nil)
        }
        if ProcessInfo.processInfo.arguments.contains("--coc-ios-scale") {
            do {
                let directory = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true).appendingPathComponent("COCLogbook")
                _ = try LogbookArchive(directory: directory).chooseLocalDirectory()
            } catch { writeSmokeResult(["passed": false, "stage": "public-scale-directory", "error": error.localizedDescription]) }
        }
        if ProcessInfo.processInfo.arguments.contains("--coc-picker-ui"),
           let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first {
            // Public empty fixture exists only in the fresh CI simulator's container.
            try? FileManager.default.createDirectory(at: documents.appendingPathComponent("COC-Picker-Public-Test"), withIntermediateDirectories: true)
            if ProcessInfo.processInfo.arguments.contains("--coc-picker-ui-fresh") {
                UserDefaults.standard.removeObject(forKey: "coc.archive.bookmark")
                UserDefaults.standard.removeObject(forKey: "coc.archive.label")
            }
        }
        #endif
        let color = UIColor(red: 230 / 255, green: 232 / 255, blue: 236 / 255, alpha: 1)
        view.backgroundColor = color
        webView?.isOpaque = false
        webView?.backgroundColor = color
        webView?.scrollView.backgroundColor = color
        webView?.scrollView.contentInsetAdjustmentBehavior = .never
        // The opaque HTML header already owns the safe area. A second UIKit edge
        // material can paint a pale gradient over the app-selected dark theme.
        if #available(iOS 26.0, *) {
            webView?.scrollView.topEdgeEffect.isHidden = true
            webView?.scrollView.bottomEdgeEffect.isHidden = true
        }
    }
}

#if DEBUG && targetEnvironment(simulator)
/// Public CI fixtures only: unavailable in Release and on physical devices.
private final class PublicNameTrace: NSObject, WKScriptMessageHandler {
    private let file = FileManager.default.temporaryDirectory.appendingPathComponent("ios-name-events.jsonl")
    private var observers: [NSObjectProtocol] = []
    override init() {
        super.init()
        append(["kind": "launch", "time": Date().timeIntervalSince1970])
        for name in [UIResponder.keyboardWillShowNotification, UIResponder.keyboardDidShowNotification, UIResponder.keyboardWillHideNotification, UIResponder.keyboardDidHideNotification] {
            observers.append(NotificationCenter.default.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
                self?.append(["kind": "keyboard", "event": name.rawValue, "time": Date().timeIntervalSince1970])
            })
        }
    }
    deinit { for observer in observers { NotificationCenter.default.removeObserver(observer) } }
    private func append(_ value: [String: Any]) {
        do {
            var bytes = try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
            bytes.append(10)
            if !FileManager.default.fileExists(atPath: file.path) { FileManager.default.createFile(atPath: file.path, contents: nil) }
            let handle = try FileHandle(forWritingTo: file)
            defer { try? handle.close() }
            try handle.seekToEnd(); try handle.write(contentsOf: bytes)
        } catch { NSLog("Public name trace write failed: %@", error.localizedDescription) }
    }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        if let value = message.body as? [String: Any] { append(value) }
    }
    static let script = #"""
    (() => {
      if (window.__cocPublicNameTrace) return;
      window.__cocPublicNameTrace = true;
      let sequence = 0;
      const text = value => ({value, codePoints: Array.from(value, c => c.codePointAt(0).toString(16))});
      const label = node => node?.labels?.[0]?.textContent || node?.getAttribute?.('aria-label') || '';
      const watched = node => node instanceof HTMLInputElement && /^(姓名|PC\d+)$/.test(label(node));
      const emit = data => window.webkit.messageHandlers.cocPublicNameTrace.postMessage(JSON.parse(JSON.stringify({sequence: ++sequence, time: Date.now(), monotonic: performance.now(), ...data})));
      const fields = () => Array.from(document.querySelectorAll('input')).filter(watched).map(node => ({label: label(node), ...text(node.value), focused: node === document.activeElement, start: node.selectionStart, end: node.selectionEnd}));
      function record(event, phase) {
        const option = event.target?.closest?.('.inline-name-options [role="option"]');
        if (!watched(event.target) && !option && !(event.type === 'submit')) return;
        emit({kind: 'dom', event: event.type, phase, label: label(event.target), option: option ? text(option.textContent) : null, inputType: event.inputType ?? null, data: event.data ?? null, composing: event.isComposing ?? null, trusted: event.isTrusted, fields: fields()});
        if (phase === 'capture' && ['click','input','compositionend','focusout','submit'].includes(event.type)) {
          queueMicrotask(() => emit({kind:'settled', event:event.type, phase:'microtask', fields:fields()}));
          requestAnimationFrame(() => emit({kind:'settled', event:event.type, phase:'frame', fields:fields()}));
        }
      }
      for (const type of ['pointerdown','pointerup','pointercancel','touchstart','touchend','mousedown','mouseup','click','beforeinput','input','change','compositionstart','compositionupdate','compositionend','focusin','focusout','keydown','keyup','submit']) {
        document.addEventListener(type, event => record(event,'capture'), true);
        document.addEventListener(type, event => record(event,'bubble'));
      }
      // Observe the original promise without replacing its result or scheduling.
      const timer = setInterval(() => {
        if (!window.Capacitor?.nativePromise) return;
        clearInterval(timer);
        const original = window.Capacitor.nativePromise;
        window.Capacitor.nativePromise = function(plugin, method, options, ...rest) {
          const interesting = plugin === 'Logbook' && ['commitModule','commitEntity','getOverview'].includes(method);
          const names = value => ({modules:(value.modules || []).map(m=>({id:m.id,pairs:(m.pairs||[]).map(p=>text(p.pc))})),characters:(value.characters||[]).map(c=>({id:c.id,name:text(c.basic?.name||'')}))});
          if (interesting) emit({kind:'bridge-request',method,revision:options?.expectedRevision, names:method === 'commitModule' ? names({modules:[options.value]}) : method === 'commitEntity' ? names({characters:options.edit?.kind === 'character' ? [options.edit.value] : []}) : null,fields:fields()});
          const result = original.call(this,plugin,method,options,...rest);
          if (interesting) result.then(value => {
            let saved=null;
            if(method==='getOverview' && value.json) { try { saved=names(JSON.parse(value.json)); } catch {} }
            emit({kind:'bridge-result',method,revision:value.revision,saved,fields:fields()});
          },error=>emit({kind:'bridge-error',method,error:String(error)}));
          return result;
        };
        emit({kind:'trace-ready'});
      },25);
    })();
    """#
}
#endif
