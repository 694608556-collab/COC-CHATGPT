import Capacitor
import UIKit

final class LogbookViewController: CAPBridgeViewController {
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
