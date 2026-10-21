import Foundation

/// Each request has its own redirect budget and bounded response buffer; no storage queue is held.
final class LogbookFetch: NSObject, URLSessionDataDelegate {
    typealias SessionFactory = (URLSessionConfiguration, URLSessionDelegate, OperationQueue?) -> URLSession
    private let makeSession: SessionFactory
    init(makeSession: @escaping SessionFactory = { URLSession(configuration: $0, delegate: $1, delegateQueue: $2) }) {
        self.makeSession = makeSession
        super.init()
    }
    private var session: URLSession?
    private var completion: ((Result<LogbookJSON, Error>) -> Void)?
    private var bytes = Data()
    private var response: HTTPURLResponse?
    private var redirects = 0
    private func trusted(_ url: URL) -> Bool {
        guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return false }
        return components.scheme == "https" && ["dice-api.weizaima.com", "log.weizaima.com"].contains(components.host ?? "") && components.user == nil && components.password == nil && components.port == nil
    }
    func start(_ url: URL, completion: @escaping (Result<LogbookJSON, Error>) -> Void) {
        guard trusted(url), url.host == "dice-api.weizaima.com", url.path == "/dice/api/load_data" else { completion(.failure(LogbookFailure("不支持此日志请求。"))); return }
        self.completion = completion
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 15; configuration.timeoutIntervalForResource = 60
        session = makeSession(configuration, self, nil)
        var request = URLRequest(url: url); request.setValue("application/json", forHTTPHeaderField: "Accept")
        session!.dataTask(with: request).resume()
    }
    private func finish(_ result: Result<LogbookJSON, Error>) {
        guard let completion else { return }
        self.completion = nil; self.session?.invalidateAndCancel(); self.session = nil
        completion(result)
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        redirects += 1
        guard redirects <= 3, let url = request.url, trusted(url) else { completionHandler(nil); finish(.failure(LogbookFailure("拒绝不受信任或过多的日志跳转。"))); return }
        completionHandler(request)
    }
    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse, completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        guard let response = response as? HTTPURLResponse, response.expectedContentLength <= Int64(logbookMaximumBytes) else { completionHandler(.cancel); finish(.failure(LogbookFailure("日志响应无效或超过 64 MB。"))); return }
        self.response = response; completionHandler(.allow)
    }
    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        guard bytes.count + data.count <= logbookMaximumBytes else { finish(.failure(LogbookFailure("日志超过 64 MB。"))); return }
        bytes.append(data)
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        if let error { finish(.failure(error)); return }
        guard let response, let url = response.url, let text = String(data: bytes, encoding: .utf8) else { finish(.failure(LogbookFailure("日志响应不是有效 UTF-8。"))); return }
        finish(.success(["status": response.statusCode, "url": url.absoluteString, "text": text]))
    }
}
