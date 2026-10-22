import Foundation

extension IOSNativeChecks {
    static func backupStreamChecks(root: URL, fixture: LogbookJSON) throws {
        let MiB = 1024 * 1024
        let work = root.appendingPathComponent("backup-private")
        try FileManager.default.createDirectory(at: work, withIntermediateDirectories: true)
        for invalid in ["{\"a\":1,\"\\u0061\":2}", "{\"raw\":{\"x\":1,\"x\":2}}", "{'x':1}", "{x:1}", "[1,]", "{\"x\":01}", "null false"] {
            try rejects("strict backup JSON") { _ = try LogbookBackupJSON.object(Data(invalid.utf8)) }
        }
        _ = try LogbookBackupJSON.object(Data("{\"emoji😀\":[\"\\u0000\",true,null,-1.2e+3]}".utf8))
        let records = fixture["records"] as! [LogbookJSON]
        var metadata = fixture
        metadata["records"] = records.map { record -> LogbookJSON in var row = record; row.removeValue(forKey: "rawContent"); row.removeValue(forKey: "manualContent"); return row }
        var small = Data()
        for record in records { small.append(82); small.append(try logbookData(record)); small.append(10) }
        small.append(77); small.append(try logbookData(metadata)); small.append(10)
        let original = work.appendingPathComponent("public-candidate")
        try small.write(to: original, options: [.withoutOverwriting])
        let proof = try LogbookBackupSession.fileProof(original, maximumBytes: small.count)
        do {
            let input = try FileHandle(forReadingFrom: original); defer { try? input.close() }
            let result = try LogbookRestoreCandidate.inspect(input, proof: proof)
            try require(try logbookData(result.metadata) == logbookData(metadata), "native candidate complete metadata")
        }
        try rejects("native candidate hash mismatch") {
            let input = try FileHandle(forReadingFrom: original); defer { try? input.close() }
            _ = try LogbookRestoreCandidate.inspect(input, proof: LogbookBackupProof(bytes: proof.bytes, sha256: String(repeating: "0", count: 64)))
        }
        let truncated = work.appendingPathComponent("public-truncated")
        try Data(small.dropLast()).write(to: truncated, options: [.withoutOverwriting])
        try rejects("native candidate terminal newline missing") {
            let input = try FileHandle(forReadingFrom: truncated); defer { try? input.close() }
            _ = try LogbookRestoreCandidate.inspect(input, proof: LogbookBackupSession.fileProof(truncated, maximumBytes: small.count))
        }
        var available = 1024 * MiB
        let session = try LogbookBackupSession(directory: work, expected: 7, bookmark: Data("public-location".utf8), restoring: true, includeArchives: false, available: { available })
        do {
            let input = try FileHandle(forReadingFrom: original); defer { try? input.close() }
            _ = try session.capture("source", input: input)
        }
        try require(try session.beginOutput() > 64 * MiB, "native dynamic operation budget")
        for offset in stride(from: 0, to: small.count, by: 65536) { try session.append(key: "candidate", index: offset / 65536, chunk: small.subdata(in: offset..<min(offset + 65536, small.count))) }
        try session.verify("candidate", expected: proof)
        let empty = LogbookBackupProof(bytes: 0, sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855")
        try session.verify("zip:archives/empty.txt", expected: empty)
        try session.finish(keeping: ["source", "candidate", "zip:archives/empty.txt"])
        try session.requireReady()
        try rejects("sealed native candidate append") { try session.append(key: "candidate", index: 0, chunk: Data([1])) }
        try rejects("wrong native lease") { try session.require("other") }
        try session.close()
        let denied = try LogbookBackupSession(directory: work, expected: 7, bookmark: Data("public-location".utf8), restoring: true, includeArchives: false, available: { available })
        do { let input = try FileHandle(forReadingFrom: original); defer { try? input.close() }; _ = try denied.capture("source", input: input) }
        _ = try denied.beginOutput()
        try rejects("captured source cannot be replaced by bridge") { try denied.append(key: "source", index: 0, chunk: Data([1])) }
        try rejects("out-of-order candidate chunk") { try denied.append(key: "candidate", index: 1, chunk: Data([1])) }
        available = LogbookCapacity.minimumReserve
        try rejects("space falls during staging") { try denied.append(key: "candidate", index: 0, chunk: Data([1])) }
        try denied.close()
        // All public 1MiB bodies are generated lazily. This exercises the native
        // parser independently, not the database, picker or a physical phone.
        let count = 96, text = "公开😀\n\0" + String(repeating: "x", count: MiB)
        let large = work.appendingPathComponent("public-96MiB-candidate")
        try Data().write(to: large, options: [.withoutOverwriting])
        let output = try FileHandle(forWritingTo: large)
        var rows: [LogbookJSON] = []
        let started = ProcessInfo.processInfo.systemUptime
        do {
            for index in 0..<count {
                try autoreleasepool {
                    var record = records[0]; record["id"] = "scale-\(index)"; record["order"] = index; record["manualContent"] = "\(index):" + text + ":END-\(index)"
                    var row = record; row.removeValue(forKey: "rawContent"); row.removeValue(forKey: "manualContent"); rows.append(row)
                    try output.write(contentsOf: Data([82]) + logbookData(record) + Data([10]))
                }
            }
            var header = metadata; header["records"] = rows
            try output.write(contentsOf: Data([77]) + logbookData(header) + Data([10])); try output.synchronize(); try output.close()
        } catch { try? output.close(); throw error }
        let largeProof = try LogbookBackupSession.fileProof(large, maximumBytes: 128 * MiB)
        let input = try FileHandle(forReadingFrom: large); defer { try? input.close() }
        var seen = 0
        let result = try LogbookRestoreCandidate.inspect(input, proof: largeProof) { record, index in
            try require(index == seen && record["manualContent"] as? String == "\(index):" + text + ":END-\(index)", "every full native candidate body")
            seen += 1
        }
        try require(largeProof.bytes > 64 * MiB && seen == count && (result.metadata["records"] as! [LogbookJSON]).count == count, "native candidate above old whole-library limit")
        print("iOS native candidate stream: records=\(seen) bytes=\(largeProof.bytes) sha256=\(largeProof.sha256) seconds=\(ProcessInfo.processInfo.systemUptime-started) deviceAcceptance=false")
    }
}
