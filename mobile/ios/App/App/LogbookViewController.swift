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
            for(let i=0;i<40 && !document.querySelector('.app-header');i++) await new Promise(r=>setTimeout(r,250));
            const state=await window.Capacitor.nativePromise('Logbook','getOverview',{});
            if(state.revision!==0 || state.json!==null || state.archive.valid) throw new Error('Unexpected fresh native state');
            const hash=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode('abc')));
            if(Array.from(hash,b=>b.toString(16).padStart(2,'0')).join('')!=='ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad') throw new Error('WebCrypto mismatch');
            await document.fonts.ready;
            if(!document.body.innerText.includes('选择并确认保存位置')) throw new Error('Native startup screen not ready: '+document.body.innerText);
            return {passed:true,nativeOverview:true,webCrypto:true,fontsReady:document.fonts.status==='loaded',secureContext:window.isSecureContext,userAgent:navigator.userAgent};
            """
            self.webView?.callAsyncJavaScript(script, arguments: [:], in: nil, in: .page) { result in
                let output: LogbookJSON
                switch result { case .success(let value): output = value as? LogbookJSON ?? ["passed": false, "error": "Invalid smoke result"]
                case .failure(let error): output = ["passed": false, "error": error.localizedDescription] }
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
