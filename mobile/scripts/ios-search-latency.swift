import Foundation
import CryptoKit

/// Public differential harness for the exact native search-source producer.
/// It creates only its own temporary database and never receives phone input.
@main struct IOSSearchLatency {
    static func main() throws {
        let fixture = try logbookObject(String(contentsOfFile: CommandLine.arguments[1], encoding: .utf8))
        let label = CommandLine.arguments[2]
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("coc-public-search-latency-" + UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let store = try LogbookStore(url: root.appendingPathComponent("public.sqlite"), deviceSpace: false)
        var snapshot = fixture
        let sample = (fixture["records"] as! [LogbookJSON]).first { $0["rawContent"] != nil }!
        var raw = sample["rawContent"] as! LogbookJSON
        let message = (raw["messages"] as! [LogbookJSON])[0]
        raw["messages"] = (0..<650).map { i -> LogbookJSON in
            var value = message
            value["id"] = "public-message-\(i)"; value["order"] = i
            value["text"] = "PUBLIC_QUERY_NEEDLE " + String(repeating: "x", count: 370)
            return value
        }
        raw.removeValue(forKey: "sourceUrl")
        snapshot["records"] = (0..<114).map { i -> LogbookJSON in
            var row = sample
            row["id"] = "public-search-\(i)"; row["order"] = i; row["sequenceNo"] = i + 1
            row["link"] = "https://log.weizaima.com/?key=public-search-\(i)"
            row["cacheSourceUrl"] = row["link"]; row["rawContent"] = raw
            return row
        }
        let inputBytes = try logbookData(snapshot).count
        guard inputBytes < 60 * 1024 * 1024 else { throw LogbookFailure("Public comparison exceeds previous v50 library limit") }
        guard try store.replace(snapshot, expected: 0) == 1 else { throw LogbookFailure("Public setup revision") }
        let ids = (0..<38).map { "public-search-\($0)" }
        var timings: [LogbookJSON] = []
        for iteration in 0..<3 {
            let started = ProcessInfo.processInfo.systemUptime
            let metadata = try store.metadata()!
            let metadataEnd = ProcessInfo.processInfo.systemUptime
            guard (metadata["records"] as! [LogbookJSON]).count == 114 else { throw LogbookFailure("Public metadata incomplete") }
            let directory = root.appendingPathComponent("stage-\(iteration)")
            let owner = try LogbookBackupSession(directory: directory, expected: 1, bookmark: Data(), restoring: false, includeArchives: false, searching: true)
            let ownerEnd = ProcessInfo.processInfo.systemUptime
            let proof = try owner.captureJSON { write in
                try store.writeBackup(expected: 1, maximumBytes: owner.sourceBudget, selected: ids, sink: write)
            }
            let captureEnd = ProcessInfo.processInfo.systemUptime
            let data = try Data(contentsOf: owner.file("source"))
            let output = try logbookObject(String(decoding: data, as: UTF8.self))
            let restored = output["snapshot"] as! LogbookJSON
            let rows = restored["records"] as! [LogbookJSON]
            guard rows.count == 38, proof.bytes == data.count,
                  rows.allSatisfy({ ($0["rawContent"] as? LogbookJSON)?["messages"] as? [LogbookJSON] != nil }),
                  try rows.allSatisfy({ try logbookData($0["rawContent"]!) == logbookData(raw) }) else { throw LogbookFailure("Public search source content differs") }
            try owner.close()
            timings.append(["iteration": iteration, "metadataMs": (metadataEnd - started) * 1000,
                            "leaseMs": (ownerEnd - metadataEnd) * 1000,
                            "sourceCaptureMs": (captureEnd - ownerEnd) * 1000, "sourceBytes": proof.bytes])
        }
        let result: LogbookJSON = ["label": label, "environment": "macOS native Swift optimized public fixture; not iPhone",
                                  "libraryRecords": 114, "libraryBytes": inputBytes, "selectedRecords": 38,
                                  "messagesPerRecord": 650, "fullBodyEquality": true, "revisionUnchanged": try store.revision() == 1,
                                  "timings": timings]
        print("PUBLIC_SEARCH_LATENCY " + (try logbookText(result)))
    }
}
