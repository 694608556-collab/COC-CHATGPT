import Capacitor
import UIKit
import WebKit

final class LogbookViewController: CAPBridgeViewController {
    #if DEBUG
    private var smokeStarted = false
    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        guard ProcessInfo.processInfo.arguments.contains("--coc-ios-smoke"), !smokeStarted else { return }
        smokeStarted = true
        DispatchQueue.main.asyncAfter(deadline: .now() + 3) {
            let script = """
            let stage='startup';
            const info={href:location.href,secureContext:window.isSecureContext,hasCrypto:!!window.crypto,hasSubtle:!!window.crypto?.subtle};
            try {
            for(let i=0;i<120 && !document.querySelector('.app-header');i++) await new Promise(r=>setTimeout(r,250));
            if(!document.querySelector('.app-header')) throw new Error('Startup DOM timeout');
            stage='native-overview';
            const state=await window.Capacitor.nativePromise('Logbook','getOverview',{});
            if(state.revision!==0 || state.json!==null || state.archive.valid) throw new Error('Unexpected fresh native state');
            stage='packaged-worker';
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
            stage='export-worker';
            const now=new Date().toISOString(), marker='COC_WORKER_PUBLIC_中文😀';
            const module={id:'smoke-module',name:'公开验证',playStatus:'running',kps:[],pairs:[],order:0,collapsed:false,createdAt:now,updatedAt:now};
            const record={id:'smoke-record',moduleId:module.id,name:'公开正文',sequenceNo:1,sourceType:'manual',status:'manual',dateSource:'none',manualContent:marker,order:0,createdAt:now,updatedAt:now};
            const exported=await workerJob('export-worker.js',{type:'export',module,records:[record],filters:{},format:'txt',combined:false});
            if(!exported?.bytes || !new TextDecoder().decode(exported.bytes).includes(marker)) throw new Error('Export worker output mismatch');
            stage='webcrypto';
            const hash=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode('abc')));
            if(Array.from(hash,b=>b.toString(16).padStart(2,'0')).join('')!=='ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad') throw new Error('WebCrypto mismatch');
            stage='fonts';
            await document.fonts.ready;
            if(!document.body.innerText.includes('选择并确认保存位置')) throw new Error('Native startup screen not ready: '+document.body.innerText);
            return {...info,stage:'complete',passed:true,nativeOverview:true,packagedWorker:true,exportWorker:true,webCrypto:true,fontsReady:document.fonts.status==='loaded',secureContext:window.isSecureContext,userAgent:navigator.userAgent};
            } catch(error) { return {...info,passed:false,stage,error:String(error?.message||error),stack:String(error?.stack||'')}; }
            """
            self.webView?.callAsyncJavaScript(script, arguments: [:], in: nil, in: .page) { result in
                let output: LogbookJSON
                switch result { case .success(let value): output = value as? LogbookJSON ?? ["passed": false, "error": "Invalid smoke result"]
                case .failure(let error):
                    let detail=error as NSError
                    output = ["passed": false, "stage": "javascript-evaluation", "error": detail.localizedDescription, "details": detail.userInfo.mapValues { String(describing: $0) }] }
                try? logbookData(output).write(to: FileManager.default.temporaryDirectory.appendingPathComponent("ios-smoke-result.json"), options: [.atomic])
            }
        }
    }
    #endif
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(LogbookPlugin())
        let color = UIColor(red: 230 / 255, green: 232 / 255, blue: 236 / 255, alpha: 1)
        view.backgroundColor = color
        webView?.isOpaque = false
        webView?.backgroundColor = color
        webView?.scrollView.backgroundColor = color
        webView?.scrollView.contentInsetAdjustmentBehavior = .never
    }
}
