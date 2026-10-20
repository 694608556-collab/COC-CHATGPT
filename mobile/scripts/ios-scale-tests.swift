import Foundation

enum IOSScaleChecks {
    static func run(root: URL, fixture: LogbookJSON) throws {
        let start = Date()
        let store = try LogbookStore(url: root.appendingPathComponent("scale.sqlite"))
        let sample = (fixture["records"] as! [LogbookJSON]).first { $0["rawContent"] != nil }!
        var data = LogbookStore.empty()
        let module = (fixture["modules"] as! [LogbookJSON])[0]
        data["modules"] = (0..<50).map { i -> LogbookJSON in
            var value = module; value["id"] = "public-module-\(i)"; value["name"] = "公开压力模组\(i)"; value["pairs"] = [LogbookJSON](); value["order"] = i; return value
        }
        let rows: [LogbookJSON] = (0..<1050).map { i in
            var value = sample
            value.removeValue(forKey: "rawContent"); value.removeValue(forKey: "cacheSourceUrl")
            value["id"] = i < 1000 ? "public-record-\(i)" : "public-manual-\(i - 1000)"
            value["moduleId"] = "public-module-\(i < 1000 ? i / 20 : i - 1000)"; value["order"] = i
            value["link"] = "https://log.weizaima.com/?key=public-\(i)"; value["status"] = "pending"
            value["dateSource"] = "none"; value.removeValue(forKey: "playDate")
            if i >= 1000 { value["sourceType"] = "manual"; value["status"] = "manual"; value.removeValue(forKey: "link"); value["manualContent"] = "手动正文\(i)\r\n\r\n中文😀" }
            return value
        }
        data["records"] = rows
        try IOSNativeChecks.require(try store.replace(data, expected: 0) == 1, "50 campaigns, 1000 online + 50 manual")
        var raw = sample["rawContent"] as! LogbookJSON
        var message = (raw["messages"] as! [LogbookJSON])[0]
        message["text"] = "公开旧正文😀" + String(repeating: "A", count: 48000)
        raw["messages"] = [message]; raw.removeValue(forKey: "sourceUrl")
        let oldBody = try logbookText(["rawContent": raw])
        for row in rows.prefix(1000) { try store.execute("UPDATE records SET body=? WHERE id=?", [oldBody, row["id"] as! String]) }
        let stageDirectory = root.appendingPathComponent("staging")
        try FileManager.default.createDirectory(at: stageDirectory, withIntermediateDirectories: true)
        func stage(_ record: LogbookJSON, _ batch: LogbookFetchBatch, corrupt: Bool = false) throws {
            var single = data; single["records"] = [record]
            let bytes = try logbookData(single)
            let upload = try LogbookSnapshotUpload(directory: stageDirectory, expected: batch.expected, bytes: bytes.count, sha256: corrupt ? String(repeating: "0", count: 64) : LogbookArchive.digest(bytes))
            for (index, offset) in stride(from: 0, to: bytes.count, by: 262144).enumerated() {
                try upload.append(index: index, base64: bytes.subdata(in: offset..<min(offset + 262144, bytes.count)).base64EncodedString())
            }
            try batch.stage(upload)
        }
        func result(_ i: Int, failed: Bool = false) -> LogbookJSON {
            var row = rows[i]
            row["status"] = failed ? "fetch_failed" : "valid"
            if failed { row["lastError"] = "公开网络失败" }
            else { row["rawContent"] = raw; row["cacheSourceUrl"] = row["link"] }
            return row
        }
        let ids = rows.prefix(1000).map { $0["id"] as! String }
        for round in 0..<3 {
            let batch = try LogbookFetchBatch(directory: stageDirectory, store: store, ids: ids, expected: round + 1, bookmark: Data())
            for i in 0..<1000 { try autoreleasepool { try stage(result(i, failed: i % 17 == 0), batch) } }
            try IOSNativeChecks.require(try store.revision() == round + 1, "staging never publishes partial results")
            try IOSNativeChecks.require(try store.finishFetch(batch).0 == round + 2, "1000 results commit exactly once")
            try IOSNativeChecks.require(try store.rows("SELECT body FROM records WHERE id=?", [ids[0]])[0][0] == oldBody, "failed fetch retains old body")
        }
        let untouched = try store.rows("SELECT body FROM records WHERE id=?", [ids[0]])[0][0]
        try store.execute("CREATE TRIGGER unselected_body BEFORE UPDATE OF body ON records WHEN OLD.id NOT IN ('public-record-999') BEGIN SELECT RAISE(ABORT,'unselected body write'); END")
        let selected = try LogbookFetchBatch(directory: stageDirectory, store: store, ids: [ids[999]], expected: 4, bookmark: Data())
        try stage(result(999), selected)
        try IOSNativeChecks.require(try store.finishFetch(selected).0 == 5, "last campaign target updates no unselected body")
        try store.execute("DROP TRIGGER unselected_body")
        let incomplete = try LogbookFetchBatch(directory: stageDirectory, store: store, ids: [ids[0]], expected: 5, bookmark: Data())
        try IOSNativeChecks.rejects("incomplete batch") { _ = try store.finishFetch(incomplete) }
        let corrupt = try LogbookFetchBatch(directory: stageDirectory, store: store, ids: [ids[0]], expected: 5, bookmark: Data())
        try IOSNativeChecks.rejects("upload hash") { try stage(result(0), corrupt, corrupt: true) }
        let tampered = try LogbookFetchBatch(directory: stageDirectory, store: store, ids: [ids[0]], expected: 5, bookmark: Data())
        try stage(result(0), tampered)
        let handle = try FileHandle(forWritingTo: tampered.url); try handle.write(contentsOf: Data("X".utf8)); try handle.close()
        try IOSNativeChecks.rejects("spool hash") { _ = try store.finishFetch(tampered) }
        try IOSNativeChecks.require(try store.revision() == 5 && store.rows("SELECT body FROM records WHERE id=?", [ids[0]])[0][0] == untouched, "hash failure preserves revision and body")
        let stale = try LogbookFetchBatch(directory: stageDirectory, store: store, ids: [ids[0]], expected: 5, bookmark: Data())
        try stage(result(0), stale)
        _ = try store.mutate(expected: 5) { $0["settings"] = data["settings"] }
        try IOSNativeChecks.rejects("CAS rejects staged old revision") { _ = try store.finishFetch(stale) }
        let over = try LogbookFetchBatch(directory: stageDirectory, store: store, ids: ids, expected: 6, bookmark: Data())
        var hugeRaw = raw; var hugeMessage = message; hugeMessage["text"] = String(repeating: "Z", count: 96000); hugeRaw["messages"] = [hugeMessage]
        try IOSNativeChecks.rejects("64 MiB staging cap") {
            for i in 0..<1000 { try autoreleasepool { var row = result(i); row["rawContent"] = hugeRaw; try stage(row, over) } }
        }
        try IOSNativeChecks.require(try store.revision() == 6, "capacity failure does not commit")
        let source = try store.backupFile(expected: 6, directory: root)
        let proof = try LogbookArchive.fileProof(source)
        try IOSNativeChecks.require(proof.0 > 48_000_000 && proof.0 < logbookMaximumBytes, "stream backup captures existing large bodies")
        let restored = try logbookObject(String(contentsOf: source, encoding: .utf8))["snapshot"] as! LogbookJSON
        try IOSNativeChecks.require((restored["records"] as! [LogbookJSON]).count == 1050, "streamed backup roundtrip complete")
        let reopened = try LogbookStore(url: root.appendingPathComponent("scale.sqlite"))
        try IOSNativeChecks.require(try reopened.revision() == 6 && reopened.deferredIDs().count == 1050, "restart retains all bodies and revision")
        try IOSNativeChecks.require(try reopened.rows("PRAGMA integrity_check")[0][0] == "ok", "large database integrity")
        print("iOS public scale: 50 campaigns / 1000 online + 50 manual; three atomic rounds, failure preservation, last target, CAS, hash, capacity rollback, streaming backup and restart passed in \(Date().timeIntervalSince(start)) seconds")
    }
}
