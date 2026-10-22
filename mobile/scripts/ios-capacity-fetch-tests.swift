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
        let original = try store.rows("SELECT body FROM records WHERE id=?", [ids[0]])[0][0]
        try require(original.contains("900719925474099312345"), "fetch retains original opaque long integer")
        let originalHash = LogbookArchive.digest(Data(original.utf8))
        let denied = try batch(2); try stage(denied); free = LogbookCapacity.minimumReserve
        try rejects("low space after complete batch staging") { _ = try store.finishFetch(denied) }
        free = 32 * 1024 * 1024 * 1024; try denied.close()
        try require(try store.revision() == 2 && LogbookArchive.digest(Data(store.rows("SELECT body FROM records WHERE id=?", [ids[0]])[0][0].utf8)) == originalHash, "batch low-space failure keeps body and revision")
        // Simulate the original v1 schema, without altering any original cells.
        try store.execute("DROP TRIGGER record_size_insert"); try store.execute("DROP TRIGGER record_size_metadata"); try store.execute("DROP TRIGGER record_size_body")
        try store.execute("DROP TRIGGER record_size_delete"); try store.execute("DROP TRIGGER record_size_id"); try store.execute("DROP TABLE record_sizes"); try store.execute("PRAGMA user_version=1")
        let migrated = try LogbookStore(url: directory.appendingPathComponent("db.sqlite"), deviceSpace: true, available: { free })
        try require(try migrated.revision() == 2 && LogbookArchive.digest(Data(migrated.rows("SELECT body FROM records WHERE id=?", [ids[0]])[0][0].utf8)) == originalHash, "v1 migration retains original complete body and revision")
        let source = try migrated.backupFile(expected: 2, directory: directory)
        try require(try LogbookArchive.fileProof(source, maximumBytes: 128 * 1024 * 1024).0 > 96 * 1024 * 1024, "migrated large library complete backup")
        print("PUBLIC_IOS_CAPACITY_FETCH records=96 nativeSQLite=true opaqueTokens=true lowSpaceRollback=true migrationV1=true physicalPhone=false")
    }
}
