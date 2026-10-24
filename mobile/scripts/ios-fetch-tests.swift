import Foundation

/// Public in-memory responses only; requests never leave URLProtocol or reach a log server.
final class PublicFetchProtocol: URLProtocol {
    static let boundedGate = DispatchSemaphore(value: 0)
    private let lock = NSLock()
    private var stopped = false
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        let url = request.url!
        let query = URLComponents(url: url, resolvingAgainstBaseURL: false)!.queryItems ?? []
        let key = query.first(where: { $0.name == "key" })?.value ?? "public"
        let delay = key.contains("slow") ? 0.08 : key.contains("medium") ? 0.02 : 0
        DispatchQueue.global().asyncAfter(deadline: .now() + delay) { [self] in
            if key.contains("bounded") { _ = Self.boundedGate.wait(timeout: .now() + 5) }
            lock.lock(); let active = !stopped; lock.unlock()
            guard active else { return }
            if key.contains("network-error") { client?.urlProtocol(self, didFailWithError: URLError(.timedOut)); return }
            if key.contains("redirect") {
                let step = Int(query.first(where: { $0.name == "step" })?.value ?? "0")!
                let count = key.contains("excessive") ? 4 : 3
                if step < count || key.contains("foreign") {
                    var target = URLComponents(url: url, resolvingAgainstBaseURL: false)!
                    target.queryItems = [URLQueryItem(name: "key", value: key), URLQueryItem(name: "step", value: String(step + 1))]
                    if key.contains("foreign") { target.host = "example.invalid" }
                    let response = HTTPURLResponse(url: url, statusCode: 302, httpVersion: "HTTP/1.1", headerFields: ["Location": target.url!.absoluteString])!
                    client?.urlProtocol(self, wasRedirectedTo: URLRequest(url: target.url!), redirectResponse: response)
                    return
                }
            }
            let body = key.contains("invalid-utf8") ? Data([0xff]) : Data(key.utf8)
            let length = key.contains("oversized-header") ? 65 * 1024 * 1024 : body.count
            let status = key.contains("missing") ? 404 : 200
            let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: ["Content-Length": String(length)])!
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            if key.contains("oversized-body") {
                let chunk = Data(repeating: 65, count: 16 * 1024 * 1024)
                for _ in 0..<4 { client?.urlProtocol(self, didLoad: chunk) }
                client?.urlProtocol(self, didLoad: Data([65]))
            } else { client?.urlProtocol(self, didLoad: body) }
            client?.urlProtocolDidFinishLoading(self)
        }
    }
    override func stopLoading() { lock.lock(); stopped = true; lock.unlock() }
}

@main struct IOSFetchChecks {
    final class Counter {
        private let lock = NSLock()
        private var value = 0
        func increment() { lock.lock(); value += 1; lock.unlock() }
        var count: Int { lock.lock(); defer { lock.unlock() }; return value }
    }
    /// Public message-count workload. Measures native files/validation/commit on the CI Mac, not phone or network time.
    static func profileStorage() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("public-fetch-profile-" + UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let store = try LogbookStore(url: root.appendingPathComponent("public.sqlite"))
        var snapshot = LogbookStore.empty()
        snapshot["modules"] = (0..<3).map { i -> LogbookJSON in ["id": "public-module-\(i)", "name": "公开模组\(i)", "playStatus": "running", "kps": [String](), "pairs": [LogbookJSON](), "order": i, "collapsed": false, "createdAt": "2026-10-21", "updatedAt": "2026-10-21"] }
        let rows: [LogbookJSON] = (0..<114).map { i in ["id": "public-record-\(i)", "moduleId": "public-module-\(i < 78 ? 0 : i < 92 ? 1 : 2)", "name": "公开场次\(i)", "sequenceNo": i + 1, "sourceType": "online", "status": "pending", "dateSource": "none", "order": i, "createdAt": "2026-10-21", "updatedAt": "2026-10-21", "link": "https://log.weizaima.com/?key=public-profile-\(i)"] }
        snapshot["records"] = rows
        _ = try store.replace(snapshot, expected: 0)
        let batch = try LogbookFetchBatch(directory: root, store: store, ids: rows.map { $0["id"] as! String }, expected: 1, bookmark: Data())
        var encodeMs = 0.0, stageMs = 0.0, inputBytes = 0, chunks = 0
        for index in rows.indices {
            try autoreleasepool {
                let text = String(repeating: "公开正文", count: 12)
                let messages: [LogbookJSON] = (0..<(index < 15 ? 654 : 653)).map { i in ["id": "public-message-\(i)", "order": i, "displayName": "公开主持人", "text": text, "type": "text", "isDiceCommand": false, "isOffTopic": false, "images": [LogbookJSON](), "raw": ["content": text, "nickname": "公开主持人"]] }
                var row = rows[index]; row["status"] = "valid"; row["cacheSourceUrl"] = row["link"]
                row["rawContent"] = ["parserVersion": 1, "sourceUrl": row["link"]!, "messages": messages]
                var single = snapshot; single["records"] = [row]
                let start = ProcessInfo.processInfo.systemUptime
                let bytes = try logbookData(single)
                let encoded = ProcessInfo.processInfo.systemUptime
                let upload = try LogbookSnapshotUpload(directory: root, expected: 1, bytes: bytes.count, sha256: LogbookArchive.digest(bytes))
                for (part, offset) in stride(from: 0, to: bytes.count, by: 262144).enumerated() { try upload.append(index: part, base64: bytes.subdata(in: offset..<min(offset + 262144, bytes.count)).base64EncodedString()); chunks += 1 }
                try batch.stage(upload)
                encodeMs += (encoded - start) * 1000; stageMs += (ProcessInfo.processInfo.systemUptime - encoded) * 1000; inputBytes += bytes.count
            }
        }
        guard try store.revision() == 1 else { throw LogbookFailure("Profile published partial data") }
        let start = ProcessInfo.processInfo.systemUptime
        guard try store.finishFetch(batch).0 == 2 else { throw LogbookFailure("Profile revision failed") }
        let timing: LogbookJSON = ["environment": "CI Mac native only; excludes phone, WKWebView, Worker and network", "records": 114, "messages": 74457, "inputBytes": inputBytes, "chunks": chunks, "nativeInputEncodeMs": encodeMs, "nativeUploadAndStageMs": stageMs, "nativeCommitMs": (ProcessInfo.processInfo.systemUptime - start) * 1000]
        print("PUBLIC_FETCH_STORAGE " + (try logbookText(timing)))
    }
    static func main() throws {
        let sessions = Counter()
        let fetch = LogbookFetch { configuration, delegate, queue in
            precondition(configuration.httpMaximumConnectionsPerHost == 6)
            precondition(configuration.timeoutIntervalForRequest == 15 && configuration.timeoutIntervalForResource == 60)
            precondition(configuration.urlCache == nil && configuration.urlCredentialStorage == nil && configuration.httpCookieStorage == nil && !configuration.httpShouldSetCookies)
            sessions.increment()
            configuration.protocolClasses = [PublicFetchProtocol.self]
            return URLSession(configuration: configuration, delegate: delegate, delegateQueue: queue)
        }
        defer { fetch.close() }
        for index in 0..<114 {
            let ready = DispatchSemaphore(value: 0)
            var received: Result<LogbookJSON, Error>?
            fetch.start(URL(string: "https://dice-api.weizaima.com/dice/api/load_data?key=public-session-\(index)")!) { value in received = value; ready.signal() }
            guard ready.wait(timeout: .now() + 5) == .success, let received,
                  try received.get()["status"] as? Int == 200 else { throw LogbookFailure("Public request failed") }
        }
        print("PUBLIC_FETCH_SESSION_COUNT requests=114 sessions=\(sessions.count)")
        guard sessions.count == 1 else { throw LogbookFailure("114 requests must reuse one native session; observed \(sessions.count)") }
        func batch(_ keys: [String]) throws -> [Result<LogbookJSON, Error>] {
            let ready = DispatchGroup(), lock = NSLock()
            var results: [Int: Result<LogbookJSON, Error>] = [:]
            for (index, key) in keys.enumerated() {
                ready.enter()
                fetch.start(URL(string: "https://dice-api.weizaima.com/dice/api/load_data?key=\(key)")!) { value in
                    lock.lock(); precondition(results[index] == nil); results[index] = value; lock.unlock(); ready.leave()
                }
            }
            if keys.contains(where: { $0.contains("bounded") }) { for _ in keys { PublicFetchProtocol.boundedGate.signal() } }
            guard ready.wait(timeout: .now() + 10) == .success else { throw LogbookFailure("Public parallel requests timed out") }
            return keys.indices.map { results[$0]! }
        }
        func rejected(_ result: Result<LogbookJSON, Error>) -> Bool { if case .failure = result { return true }; return false }
        // All twelve submissions are pending before the delayed first result.
        // Six run and six wait; only the thirteenth must be rejected.
        let bounded = try batch((0..<13).map { "public-slow-bounded-\($0)" })
        guard bounded.prefix(12).allSatisfy({ !rejected($0) }), rejected(bounded[12]) else { throw LogbookFailure("Native pending request bound must be twelve") }
        let parallelKeys = ["public-slow-first", "public-fast-second", "public-medium-third"]
        let parallel = try batch(parallelKeys)
        for index in parallel.indices { guard try parallel[index].get()["text"] as? String == parallelKeys[index] else { throw LogbookFailure("Parallel response buffers crossed") } }
        let isolated = try batch(["public-network-error", "public-slow-unaffected", "public-missing"])
        guard rejected(isolated[0]), try isolated[1].get()["text"] as? String == "public-slow-unaffected", try isolated[2].get()["status"] as? Int == 404 else { throw LogbookFailure("One failure cancelled another task") }
        let redirect = try batch(["public-redirect-first", "public-redirect-second"])
        for result in redirect { guard try result.get()["status"] as? Int == 200 else { throw LogbookFailure("Redirect budgets crossed") } }
        let invalid = try batch(["public-redirect-excessive", "public-redirect-foreign", "public-invalid-utf8"])
        guard invalid.allSatisfy(rejected), try batch(["public-after-rejections"])[0].get()["status"] as? Int == 200, sessions.count == 1 else { throw LogbookFailure("Limits invalidated the shared transport") }
        let large = try batch(["public-oversized-header", "public-oversized-body"])
        guard try large[0].get()["text"] as? String == "public-oversized-header", let complete = try large[1].get()["text"] as? String,
              complete.utf8.count == 64 * 1024 * 1024 + 1, complete.first == "A", complete.last == "A" else { throw LogbookFailure("Large complete response was truncated or rejected") }
        for address in ["http://dice-api.weizaima.com/dice/api/load_data", "https://example.invalid/dice/api/load_data", "https://user:secret@dice-api.weizaima.com/dice/api/load_data", "https://dice-api.weizaima.com:443/dice/api/load_data", "https://dice-api.weizaima.com/other"] {
            var denied = false
            fetch.start(URL(string: address)!) { denied = rejected($0) }
            guard denied else { throw LogbookFailure("Untrusted initial request accepted") }
        }
        let closing = DispatchGroup(), completed = Counter()
        for _ in 0..<12 { closing.enter(); fetch.start(URL(string: "https://dice-api.weizaima.com/dice/api/load_data?key=public-slow-close")!) { result in precondition(rejected(result)); completed.increment(); closing.leave() } }
        fetch.close()
        guard closing.wait(timeout: .now() + 5) == .success, completed.count == 12, rejected(try batch(["public-after-close"])[0]), sessions.count == 1 else { throw LogbookFailure("Session teardown did not settle each task exactly once") }
        print("iOS native network: 114-request reuse, concurrent isolation, HTTP errors, redirects, UTF-8, complete response above64MiB, trust and teardown passed; no real network or phone tested.")
        try profileStorage()
    }
}
