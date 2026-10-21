import Foundation

/// Public in-memory responses only; requests never leave URLProtocol or reach a log server.
final class PublicFetchProtocol: URLProtocol {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        let url = request.url!
        let body = Data("{\"public\":\"\(url.lastPathComponent)\"}".utf8)
        let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: ["Content-Length": String(body.count)])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: body)
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

@main struct IOSFetchChecks {
    final class Counter {
        private let lock = NSLock()
        private var value = 0
        func increment() { lock.lock(); value += 1; lock.unlock() }
        var count: Int { lock.lock(); defer { lock.unlock() }; return value }
    }
    static func main() throws {
        let sessions = Counter()
        let fetch = LogbookFetch { configuration, delegate, queue in
            sessions.increment()
            configuration.protocolClasses = [PublicFetchProtocol.self]
            return URLSession(configuration: configuration, delegate: delegate, delegateQueue: queue)
        }
        for index in 0..<114 {
            let ready = DispatchSemaphore(value: 0)
            var received: Result<LogbookJSON, Error>?
            fetch.start(URL(string: "https://dice-api.weizaima.com/dice/api/load_data?key=public-session-\(index)")!) { value in received = value; ready.signal() }
            guard ready.wait(timeout: .now() + 5) == .success, let received,
                  try received.get()["status"] as? Int == 200 else { throw LogbookFailure("Public request failed") }
        }
        print("PUBLIC_FETCH_SESSION_COUNT requests=114 sessions=\(sessions.count)")
        guard sessions.count == 1 else { throw LogbookFailure("114 requests must reuse one native session; observed \(sessions.count)") }
        print("iOS native network: session reuse regression passed; no real network or phone tested.")
    }
}
