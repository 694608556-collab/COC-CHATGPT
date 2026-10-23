import Foundation
import CryptoKit

extension IOSNativeChecks {
    /// Exercise the actual C/Swift ABI and the read-only native snapshot boundary.
    static func searchProjectionChecks(root: URL, fixture: LogbookJSON) throws {
        let MiB = 1024 * 1024, budget = 256 * 1024 * 1024
        try require(LogbookBackupProof.hex(Data()) == "", "empty hexadecimal encoding")
        try require(LogbookBackupProof.hex((0...255).map { UInt8($0) }) == "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f202122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f404142434445464748494a4b4c4d4e4f505152535455565758595a5b5c5d5e5f606162636465666768696a6b6c6d6e6f707172737475767778797a7b7c7d7e7f808182838485868788898a8b8c8d8e8f909192939495969798999a9b9c9d9e9fa0a1a2a3a4a5a6a7a8a9aaabacadaeafb0b1b2b3b4b5b6b7b8b9babbbcbdbebfc0c1c2c3c4c5c6c7c8c9cacbcccdcecfd0d1d2d3d4d5d6d7d8d9dadbdcdddedfe0e1e2e3e4e5e6e7e8e9eaebecedeeeff0f1f2f3f4f5f6f7f8f9fafbfcfdfeff", "every hexadecimal byte and leading zero matches independent reference")
        var hostReads = 0
        try require(LogbookSearchMemory.available(process: 0, simulator: false, host: { hostReads += 1; return 123456 }) == 0 && hostReads == 0, "real-device zero headroom never borrows host memory")
        try require(LogbookSearchMemory.available(process: 4321, simulator: true, host: { hostReads += 1; return 0 }) == 4321 && hostReads == 0, "positive process headroom is used directly")
        try require(LogbookSearchMemory.available(process: 0, simulator: true, host: { 123456 }) == 123456, "simulator without jetsam uses actual advisory host pages")
        try require(LogbookSearchMemory.available(process: 0, simulator: true, host: { 0 }) == 0, "failed host memory probe retains complete fallback")
        try require(LogbookSearchMemory.available(process: UInt64.max, simulator: false) == Int.max, "memory arithmetic cannot overflow Int")
        print("iOS search host advisory memory=\(LogbookSearchMemory.available(process: 0, simulator: true)) physicalPhone=false")
        let log = #"{"parserVersion":1,"messages":[{"id":"public","order":1,"timestamp":"2026-10-23T12:00:00Z","displayName":"Reader","text":"完整😀END","type":"message","isDiceCommand":false,"isOffTopic":true,"images":[{"url":"https://example.invalid/public.png","alt":"full"}],"raw":{"tail":[9007199254740993,null,"END"]}}]}"#
        let original = Data((#"{"unknown":{"rawContent":"not the selected member"},"rawContent":"# + log + #", "manualContent":"full END"}"#).utf8)
        let originalHash = SHA256.hash(data: original)
        guard let projected = try LogbookBackupJSON.searchBody(original, budget: budget) else { throw LogbookFailure("Public search body did not project") }
        let decoded = try LogbookBackupJSON.object(projected)
        let raw = decoded["rawContent"] as! LogbookJSON, messages = raw["messages"] as! [[Any]]
        try require(messages.count == 1 && messages[0].count == 7, "actual C/Swift searchable tuple ABI")
        try require(messages[0][0] as? String == "2026-10-23T12:00:00Z" && messages[0][1] as? String == "Reader" && messages[0][2] is NSNull && messages[0][3] as? String == "完整😀END", "all searchable timestamp/name/platform/text fields")
        try require(messages[0][4] as? Bool == false && messages[0][5] as? Bool == true && messages[0][6] as? Bool == true, "dice/off-topic/image filters retain meaning")
        try require(decoded["manualContent"] as? String == "full END" && (decoded["unknown"] as? LogbookJSON)?["rawContent"] as? String == "not the selected member", "manual and unrelated original spans are unchanged")
        try require(SHA256.hash(data: original) == originalHash, "native projection never mutates original bytes")
        try require(try LogbookBackupJSON.searchBody(original, budget: original.count) == nil, "resident budget requests complete fallback")
        for invalid in [#"{"rawContent":{"parserVersion":1,"messages":[]},"tail":{"x":1,"\u0078":2}}"#,
                        #"{"rawContent":{"parserVersion":1,"messages":[{}]}}"#,
                        #"{"manualContent":"first","manualContent":"second"}"#,
                        #"{"manualContent":"full"} true"#] {
            try require(try LogbookBackupJSON.searchBody(Data(invalid.utf8), budget: budget) == nil, "every unknown byte, key and original message field is validated")
        }
        try require(try LogbookBackupJSON.searchBody(Data([123,34,120,34,58,34,192,175,34,125]), budget: budget) == nil, "malformed UTF8 cannot obtain a projection")
        let manual = Data(#"{"manualContent":"完整\uD83D\uDE00END"}"#.utf8)
        try require(try LogbookBackupJSON.searchBody(manual, budget: budget) == manual, "manual-only raw spelling remains exact")

        let store = try LogbookStore(url: root.appendingPathComponent("search-readonly.sqlite"))
        // Force nonzero-index Data slices across many transfer boundaries in
        // both raw and manual bodies. Ordinary backup supplies the byte oracle.
        var sourceFixture = fixture, sourceRows = fixture["records"] as! [LogbookJSON]
        let largeText = String(repeating: "完整😀\nEND ", count: 100000)
        var largeLog = sourceRows[0]["rawContent"] as! LogbookJSON
        var largeMessages = largeLog["messages"] as! [LogbookJSON]
        largeMessages[0]["text"] = largeText; largeLog["messages"] = largeMessages
        sourceRows[0]["rawContent"] = largeLog
        guard let manualIndex = sourceRows.firstIndex(where: { $0["sourceType"] as? String == "manual" }) else { throw LogbookFailure("Public manual fixture required") }
        sourceRows[manualIndex]["manualContent"] = largeText
        sourceFixture["records"] = sourceRows
        _ = try store.replace(sourceFixture, expected: 0)
        let before = try logbookData(store.fullSnapshot()!), revision = try store.revision()
        let ids = (fixture["records"] as! [LogbookJSON]).map { $0["id"] as! String }
        let directory = root.appendingPathComponent("search-private")
        let owner = try LogbookBackupSession(directory: directory, expected: revision, bookmark: Data(), restoring: false, includeArchives: false, searching: true, available: { 1024 * MiB })
        let timing = LogbookSearchTiming()
        let proofs = try owner.captureSearch(timing: timing, readBufferBytes: 1024 * 1024) { original, projection in
            try store.writeSearchProjection(expected: revision, maximumBytes: owner.sourceBudget, selected: ids, memoryBudget: budget, timing: timing, original: original, sink: projection)
        }
        try require(["readBodyMs", "kernelMs", "writeMs", "sealOriginalMs", "sealProjectionMs"].allSatisfy { timing.values[$0].map { $0.isFinite && $0 >= 0 } == true }, "optional phase metrics are finite and content-free")
        let originalURL = try owner.file("source"), projectionURL = try owner.file("search")
        var reference = Data()
        try store.writeBackup(expected: revision, maximumBytes: owner.sourceBudget, selected: ids, validateRecords: false) { reference.append($0) }
        let originalBytes = try Data(contentsOf: originalURL)
        let marker = Data(",\"snapshot\":".utf8)
        guard let referenceStart = reference.range(of: marker)?.upperBound, let originalStart = originalBytes.range(of: marker)?.upperBound else { throw LogbookFailure("Public canonical envelope required") }
        try require(originalBytes.suffix(from: originalStart) == reference.suffix(from: referenceStart), "segmented search original is byte-exact with the complete ordinary backup, across all body boundaries")
        let envelope = try LogbookBackupJSON.object(Data(contentsOf: originalURL))
        try require(try logbookData(envelope["snapshot"] as! LogbookJSON) == before, "complete original snapshot ledger retains every body and field")
        let sourceProof = try LogbookBackupSession.fileProof(originalURL, maximumBytes: proofs.original.bytes)
        let projectionProof = try LogbookBackupSession.fileProof(projectionURL, maximumBytes: proofs.projection.bytes)
        try require(sourceProof.sha256 == proofs.original.sha256 && projectionProof.sha256 == proofs.projection.sha256, "both native immutable files match complete independent readback proofs")
        let projectedEnvelope = try LogbookBackupJSON.object(Data(contentsOf: projectionURL))
        let originalRows = (envelope["snapshot"] as! LogbookJSON)["records"] as! [LogbookJSON]
        let projectedRows = (projectedEnvelope["snapshot"] as! LogbookJSON)["records"] as! [LogbookJSON]
        try require(projectedRows.count == ids.count, "every selected native record appears")
        for (index, row) in originalRows.enumerated() {
            let hint = projectedRows[index]
            var originalMeta = row, projectedMeta = hint
            originalMeta.removeValue(forKey: "rawContent"); projectedMeta.removeValue(forKey: "rawContent")
            try require(try logbookData(originalMeta) == logbookData(projectedMeta), "all record metadata and complete manual content retain order and associations")
            if let log = row["rawContent"] as? LogbookJSON {
                let originalMessages = log["messages"] as! [LogbookJSON]
                let compact = (hint["rawContent"] as! LogbookJSON)["messages"] as! [[Any]]
                try require(compact.count == originalMessages.count, "no native source message is truncated")
                for (at, message) in originalMessages.enumerated() {
                    let expected: [Any] = [message["timestamp"] ?? NSNull(), message["displayName"]!, message["platformAccount"] ?? NSNull(), message["text"]!, message["isDiceCommand"]!, message["isOffTopic"]!, !(message["images"] as! [Any]).isEmpty]
                    try require(try logbookData(compact[at]) == logbookData(expected), "every original searchable field in every native message")
                }
            }
        }
        try rejects("search projection cannot obtain output/write authority") { _ = try owner.beginOutput() }
        try rejects("search projection cannot become a restore candidate") { try owner.previewRestore(candidate: proofs.projection, selected: []) }
        try require(try store.revision() == revision && logbookData(store.fullSnapshot()!) == before, "search leaves all business bytes and CAS revision unchanged")
        try owner.close()
        try require(!FileManager.default.fileExists(atPath: originalURL.path) && !FileManager.default.fileExists(atPath: projectionURL.path), "search cleanup removes only its two private files")
        let failureDirectory = root.appendingPathComponent("search-readback-failure")
        let damaged = try LogbookBackupSession(directory: failureDirectory, expected: revision, bookmark: Data(), restoring: false, includeArchives: false, searching: true, available: {1024 * MiB})
        let failedTiming = LogbookSearchTiming(), input = Data("{\"v\":\"A\"}".utf8)
        var tampered = false
        try rejects("concurrent readback still rejects a changed original input hash") {
            _ = try damaged.captureSearch(timing: failedTiming, readBufferBytes: MiB) { original, projection in
                try original(input); try projection(Data("{\"projection\":true}".utf8))
                guard let files = FileManager.default.enumerator(at: failureDirectory, includingPropertiesForKeys: [.isRegularFileKey]) else { throw LogbookFailure("Public readback directory required") }
                for case let file as URL in files {
                    if (try? Data(contentsOf: file)) == input {
                        try Data("{\"v\":\"B\"}".utf8).write(to: file)
                        tampered = true; break
                    }
                }
            }
        }
        try require(tampered && failedTiming.values["sealOriginalMs"] != nil && failedTiming.values["sealProjectionMs"] != nil, "both complete readbacks join before a failed source can be cleaned up")
        try damaged.close()
        try require(try store.revision() == revision && logbookData(store.fullSnapshot()!) == before, "readback failure cannot mutate business data or revision")
        let unsupported = try LogbookBackupSession(directory: directory, expected: revision, bookmark: Data(), restoring: false, includeArchives: false, searching: true, available: {1024 * MiB})
        try rejects("zero acceleration budget requests complete fallback") {
            _ = try unsupported.captureSearch { original, projection in
                try store.writeSearchProjection(expected: revision, maximumBytes: unsupported.sourceBudget, selected: ids, memoryBudget: 0, original: original, sink: projection)
            }
        }
        try unsupported.close()
        let fallback = try LogbookBackupSession(directory: directory, expected: revision, bookmark: Data(), restoring: false, includeArchives: false, searching: true, available: {1024 * MiB})
        _ = try fallback.captureJSON { try store.writeBackup(expected: revision, maximumBytes: fallback.sourceBudget, selected: ids, validateRecords: false, sink: $0) }
        let full = try LogbookBackupJSON.object(Data(contentsOf: fallback.file("source")))
        try require(try logbookData(full["snapshot"] as! LogbookJSON) == before, "complete legacy fallback has no new content quota or skipped body")
        try fallback.close()
        print("iOS native search projection: complete C/Swift fields, original ledger, read-only authority and fallback passed; physicalPhone=false")
    }
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
