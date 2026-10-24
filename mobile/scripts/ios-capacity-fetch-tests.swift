import Foundation

extension IOSNativeChecks {
    static func capacityFetchChecks(root: URL, fixture: LogbookJSON) throws {
        let directory = root.appendingPathComponent("capacity-fetch")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        var free = 32 * 1024 * 1024 * 1024
        let store = try LogbookStore(url: directory.appendingPathComponent("db.sqlite"), deviceSpace: true, available: { free })
        let sample = (fixture["records"] as! [LogbookJSON]).first { $0["sourceType"] as? String == "online" && $0["rawContent"] != nil }!
        var data = fixture
        let rows = (0..<96).map { index -> LogbookJSON in
            var row = sample; row["id"] = "fetch-capacity-\(index)"; row["order"] = index
            for key in ["rawContent", "manualContent", "cacheSourceUrl", "fetchedAt"] { row.removeValue(forKey: key) }
            row["status"] = "pending"; return row
        }
        data["records"] = rows
        _ = try store.replace(data, expected: 0)
        var raw = sample["rawContent"] as! LogbookJSON
        var message = (raw["messages"] as! [LogbookJSON])[0]
        message["text"] = "公开批量😀\0" + String(repeating: "A", count: 1024 * 1024)
        message["raw"] = ["publicOpaque": "REPLACE_PUBLIC_LONG_INTEGER"]
        raw["messages"] = [message]
        let ids = rows.map { $0["id"] as! String }
        func batch(_ expected: Int) throws -> LogbookFetchBatch { try LogbookFetchBatch(directory: directory, store: store, ids: ids, expected: expected, bookmark: Data()) }
        func stage(_ batch: LogbookFetchBatch) throws {
            for index in 0..<96 {
                try autoreleasepool {
                    var row = rows[index]; row["status"] = "valid"; row["rawContent"] = raw; row["cacheSourceUrl"] = row["link"]
                    var single = data; single["records"] = [row]
                    let text = try logbookText(single).replacingOccurrences(of: "\"REPLACE_PUBLIC_LONG_INTEGER\"", with: "900719925474099312345")
                    let bytes = Data(text.utf8)
                    let upload = try LogbookSnapshotUpload(directory: directory, expected: batch.expected, bytes: bytes.count, sha256: LogbookArchive.digest(bytes))
                    for (part, start) in stride(from: 0, to: bytes.count, by: 262144).enumerated() { try upload.append(index: part, base64: bytes.subdata(in: start..<min(start + 262144, bytes.count)).base64EncodedString()) }
                    try batch.stage(upload)
                }
            }
        }
        let first = try batch(1); try stage(first)
        try require(first.stagedBytes > 96 * 1024 * 1024, "native batch staging exceeds 64MiB")
        try require(try store.revision() == 1 && store.deferredIDs().isEmpty, "large batch stays private until complete")
        try require(try store.finishFetch(first).0 == 2, "96MiB batch commits once")
        let original = try store.bodyText(ids[0])
        try require(original.contains("900719925474099312345"), "fetch retains original opaque long integer")
        let originalHash = LogbookArchive.digest(Data(original.utf8))
        let denied = try batch(2); try stage(denied); free = LogbookCapacity.minimumReserve
        try rejects("low space after complete batch staging") { _ = try store.finishFetch(denied) }
        free = 32 * 1024 * 1024 * 1024; try denied.close()
        try require(try store.revision() == 2 && LogbookArchive.digest(Data(store.bodyText(ids[0]).utf8)) == originalHash, "batch low-space failure keeps body and revision")
        // Simulate the original v1 schema, without altering any original cells.
        try store.execute("DROP TRIGGER record_size_insert"); try store.execute("DROP TRIGGER record_size_metadata"); try store.execute("DROP TRIGGER record_size_body")
        try store.execute("DROP TRIGGER record_size_delete"); try store.execute("DROP TRIGGER record_size_id"); try store.execute("DROP TABLE record_sizes"); try store.execute("PRAGMA user_version=1")
        let migrated = try LogbookStore(url: directory.appendingPathComponent("db.sqlite"), deviceSpace: true, available: { free })
        try require(try migrated.revision() == 2 && LogbookArchive.digest(Data(migrated.bodyText(ids[0]).utf8)) == originalHash, "v1 migration retains original complete body and revision")
        let source = try migrated.backupFile(expected: 2, directory: directory)
        try require(try LogbookArchive.fileProof(source, maximumBytes: 128 * 1024 * 1024).0 > 96 * 1024 * 1024, "migrated large library complete backup")
        print("PUBLIC_IOS_CAPACITY_FETCH records=96 nativeSQLite=true opaqueTokens=true lowSpaceRollback=true migrationV1=true physicalPhone=false")
    }
}

extension IOSNativeChecks {
    static func encodedUploadChecks(root: URL, fixture: LogbookJSON) throws {
        let directory = root.appendingPathComponent("encoded-upload")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let window = try logbookObject(String(contentsOfFile: "ios/build/upload-window.json", encoding: .utf8))
        let rawBytes = window["rawBytes"] as! Int
        let wire = Data(base64Encoded: window["base64"] as! String)!
        let raw = Data(repeating: 65, count: rawBytes)
        func upload(_ bytes: Int, _ hash: String = String(repeating: "0", count: 64)) throws -> LogbookSnapshotUpload {
            try LogbookSnapshotUpload(directory: directory, expected: 0, bytes: bytes, sha256: hash, available: { 32 * 1024 * 1024 * 1024 })
        }
        // 68MiB of complete original data plus identity tail. The transport
        // window is bounded, while total content remains unlimited.
        let large = try upload(rawBytes * 34 + 3)
        for index in 0..<34 { try large.appendEncoded(index: index, encoding: "zlib", rawBytes: rawBytes, base64: wire.base64EncodedString()) }
        try large.appendEncoded(index: 34, encoding: "identity", rawBytes: 3, base64: Data([0, 1, 2]).base64EncodedString())
        let data = try Data(contentsOf: large.url)
        var expected = Data(); for _ in 0..<34 { expected.append(raw) }; expected.append(contentsOf: [0, 1, 2])
        try require(data.count > 64 * 1024 * 1024 && data == expected, "encoded upload retains every byte above64MiB")
        try large.close()
        var single = fixture; single["records"] = [(fixture["records"] as! [LogbookJSON])[0]]
        let candidate = try logbookData(single)
        let valid = try upload(candidate.count, LogbookArchive.digest(candidate))
        for (index, start) in stride(from: 0, to: candidate.count, by: 262144).enumerated() {
            let part = candidate.subdata(in: start..<min(start + 262144, candidate.count))
            try valid.appendEncoded(index: index, encoding: "identity", rawBytes: part.count, base64: part.base64EncodedString())
        }
        try require(try logbookData(valid.snapshot()) == logbookData(single), "encoded upload keeps complete schema and hash validation")
        try valid.close()
        var corrupt = wire; corrupt[corrupt.count - 1] ^= 1
        var tail = wire; tail.append(0)
        var concat = wire; concat.append(wire)
        for (encoding, count, bytes, index) in [
            ("zlib", rawBytes, corrupt, 0), ("zlib", rawBytes, Data(wire.dropLast()), 0),
            ("zlib", rawBytes, tail, 0), ("zlib", rawBytes, concat, 0),
            ("zlib", rawBytes - 1, wire, 0), ("zlib", rawBytes + 1, wire, 0),
            ("zlib", 2 * 1024 * 1024 + 1, wire, 0), ("identity", rawBytes, wire, 0),
            ("unknown", rawBytes, wire, 0), ("zlib", rawBytes, wire, 1)] {
            let denied = try upload(rawBytes + 1)
            try rejects("encoded malformed stream, length, encoding or ordinal") { try denied.appendEncoded(index: index, encoding: encoding, rawBytes: count, base64: bytes.base64EncodedString()) }
            try require(!FileManager.default.fileExists(atPath: denied.url.path), "failed encoded upload deletes only private staging")
            try rejects("failed lease cannot resume") { try denied.append(index: 0, base64: Data([65]).base64EncodedString()) }
        }
        let wrongHash = try upload(candidate.count)
        for (index, start) in stride(from: 0, to: candidate.count, by: 262144).enumerated() {
            let part = candidate.subdata(in: start..<min(start + 262144, candidate.count))
            try wrongHash.appendEncoded(index: index, encoding: "identity", rawBytes: part.count, base64: part.base64EncodedString())
        }
        try rejects("encoded complete upload still requires full SHA256") { _ = try wrongHash.snapshot() }
        try wrongHash.close()
        print("PUBLIC_IOS_ENCODED_UPLOAD above64MiB=true corruption=true exactLength=true ordinal=true fullHash=true cleanup=true physicalPhone=false")
    }
}
