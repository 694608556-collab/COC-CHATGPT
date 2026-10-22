import Foundation

/// Reuses transport connections while keeping each task's response, limit and redirect budget isolated.
final class LogbookFetch: NSObject, URLSessionDataDelegate {
    typealias SessionFactory = (URLSessionConfiguration, URLSessionDelegate, OperationQueue?) -> URLSession
    private final class Pending {
        let completion: (Result<LogbookJSON, Error>) -> Void
        var bytes = Data()
        var response: HTTPURLResponse?
        var redirects = 0
        init(_ completion: @escaping (Result<LogbookJSON, Error>) -> Void) { self.completion = completion }
    }
    private let makeSession: SessionFactory
    private let lock = NSLock()
    private let callbacks: OperationQueue = {
        let queue = OperationQueue()
        queue.name = "coc.logbook.fetch-callbacks"
        queue.maxConcurrentOperationCount = 1
        queue.qualityOfService = .userInitiated
        return queue
    }()
    private var session: URLSession?
    private var pending: [Int: Pending] = [:]
    private var closed = false
    init(makeSession: @escaping SessionFactory = { URLSession(configuration: $0, delegate: $1, delegateQueue: $2) }) {
        self.makeSession = makeSession
        super.init()
    }
    private func trusted(_ url: URL) -> Bool {
        guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return false }
        return components.scheme == "https" && ["dice-api.weizaima.com", "log.weizaima.com"].contains(components.host ?? "") && components.user == nil && components.password == nil && components.port == nil
    }
    func start(_ url: URL, completion: @escaping (Result<LogbookJSON, Error>) -> Void) {
        guard trusted(url), url.host == "dice-api.weizaima.com", url.path == "/dice/api/load_data" else { completion(.failure(LogbookFailure("不支持此日志请求。"))); return }
        lock.lock()
        guard !closed else { lock.unlock(); completion(.failure(LogbookFailure("日志请求通道已关闭。"))); return }
        if session == nil {
            let configuration = URLSessionConfiguration.ephemeral
            configuration.timeoutIntervalForRequest = 15; configuration.timeoutIntervalForResource = 60
            // Share connections only; never share cached responses, cookies or credentials across checks.
            configuration.urlCache = nil; configuration.urlCredentialStorage = nil
            configuration.httpCookieStorage = nil; configuration.httpShouldSetCookies = false
            session = makeSession(configuration, self, callbacks)
        }
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData)
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        let task = session!.dataTask(with: request)
        pending[task.taskIdentifier] = Pending(completion)
        lock.unlock()
        task.resume()
    }
    /// Explicit plugin teardown breaks URLSession's strong reference to its delegate.
    func close() {
        lock.lock()
        closed = true
        let current = session; session = nil
        let abandoned = Array(pending.values); pending.removeAll()
        lock.unlock()
        current?.invalidateAndCancel()
        for request in abandoned { request.completion(.failure(LogbookFailure("日志请求通道已关闭。"))) }
    }
    private func fail(_ task: URLSessionTask, _ message: String) {
        lock.lock(); let request = pending.removeValue(forKey: task.taskIdentifier); lock.unlock()
        task.cancel()
        request?.completion(.failure(LogbookFailure(message)))
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        lock.lock()
        guard let state = pending[task.taskIdentifier] else { lock.unlock(); completionHandler(nil); return }
        state.redirects += 1
        let allowed = state.redirects <= 3 && request.url.map(trusted) == true
        lock.unlock()
        if allowed { completionHandler(request) }
        else { completionHandler(nil); fail(task, "拒绝不受信任或过多的日志跳转。") }
    }
    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse, completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        guard let response = response as? HTTPURLResponse,
              let url = response.url, trusted(url) else {
            completionHandler(.cancel); fail(dataTask, "日志响应或来源无效。"); return
        }
        lock.lock()
        let state = pending[dataTask.taskIdentifier]; state?.response = response
        lock.unlock()
        completionHandler(state == nil ? .cancel : .allow)
    }
    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        lock.lock()
        guard let state = pending[dataTask.taskIdentifier] else { lock.unlock(); return }
        state.bytes.append(data)
        lock.unlock()
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        lock.lock(); let state = pending.removeValue(forKey: task.taskIdentifier); lock.unlock()
        guard let state else { return }
        if let error { state.completion(.failure(error)); return }
        guard let response = state.response, let url = response.url, let text = String(data: state.bytes, encoding: .utf8) else { state.completion(.failure(LogbookFailure("日志响应不是有效 UTF-8。"))); return }
        state.completion(.success(["status": response.statusCode, "url": url.absoluteString, "text": text]))
    }
}
