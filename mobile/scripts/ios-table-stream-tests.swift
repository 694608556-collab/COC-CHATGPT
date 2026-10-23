import Foundation
import CryptoKit

extension IOSNativeChecks {
    static func tableKernelChecks(root: URL) throws {
        let directory = root.appendingPathComponent("native-kernel-public")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let corpus = URL(fileURLWithPath: "ios/build/table-kernel-corpus", isDirectory: true)
        let manifest = try JSONSerialization.jsonObject(with: Data(contentsOf: corpus.appendingPathComponent("manifest.json"))) as! [LogbookJSON]
        try require(manifest.count >= 33, "complete native kernel public corpus retained")
        LogbookTableKernel.warmCode()
        for item in manifest {
            let name = item["name"] as! String, bytes = try Data(contentsOf: corpus.appendingPathComponent(name + ".xlsx"))
            let owner = try LogbookTableSession(directory: directory, expected: 7, bookmark: Data(), kind: "character-table", available: { 1024 * 1024 * 1024 }, deferStorage: true)
            try require(!FileManager.default.fileExists(atPath: owner.directory.path), "read-only owner creates no SQL/files before capture")
            let source = directory.appendingPathComponent("public-input.xlsx")
            try bytes.write(to: source)
            let input = try FileHandle(forReadingFrom: source)
            let captured = try owner.capture(input, name: "public.xlsx"); try input.close()
            try require(captured["bytes"] as? Int == bytes.count && captured["sha256"] as? String == LogbookArchive.digest(bytes), "capture proves every complete source byte")
            // A caller changing the picked file cannot alter the private EOF
            // snapshot. No application/source permission is cached or reused.
            try Data("replaced outside private owner".utf8).write(to: source)
            let kernel = try owner.inspectCoc7Kernel()
            try require((kernel != nil) == (item["native"] as! Bool), "native complete compatibility decision: " + name)
            if let kernel {
                let proof = kernel["source"] as! LogbookJSON
                try require(proof["sha256"] as? String == captured["sha256"] as? String && proof["bytes"] as? Int == bytes.count, "kernel bound to captured source")
                try require(!FileManager.default.fileExists(atPath: owner.directory.path), "supported snapshot remains read-only without disk index")
                try rejects("memory snapshot cannot append candidates") { try owner.append(key: "candidate", chunkIndex: 0, bytes: Data("T{}\n".utf8)) }
            } else {
                try require(try Data(contentsOf: owner.sourceURL) == bytes, "unsupported/oversize fallback preserves exact prefix and complete tail")
                try require(FileManager.default.fileExists(atPath: owner.directory.appendingPathComponent("index.sqlite").path), "fallback retains durable private index")
                let line = try logbookData([0, "完整共享字符串😀\r\n末尾"]) + Data([10])
                try owner.append(key: "strings", chunkIndex: 0, bytes: line)
                let value = try owner.readString(0, offset: 0)
                try require(Data(base64Encoded: value["base64"] as! String) == Data("完整共享字符串😀\r\n末尾".utf8), "full fallback staging remains usable")
            }
            try owner.close(); try rejects("closed read-only owner cannot replay") { try owner.require(owner.id) }
            try require(!FileManager.default.fileExists(atPath: owner.directory.path), "close removes only this owned stage")
            try FileManager.default.removeItem(at: source)
        }
    }

    static func tableRecordKernelChecks(root: URL, fixture: LogbookJSON) throws {
        let directory = root.appendingPathComponent("native-record-kernel-public")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let corpus = URL(fileURLWithPath: "ios/build/table-kernel-corpus", isDirectory: true)
        let manifest = try JSONSerialization.jsonObject(with: Data(contentsOf: corpus.appendingPathComponent("record-manifest.json"))) as! [LogbookJSON]
        try require(manifest.count >= 38 && manifest.contains { $0["native"] as? Bool == true } && manifest.contains { $0["full"] as? Bool == false }, "record kernel retains all 38 positive and invalid complete-input cases")
        let picked = directory.appendingPathComponent("public-picked.xlsx")
        for item in manifest {
            let name = item["name"] as! String
            let bytes = try Data(contentsOf: corpus.appendingPathComponent("record-" + name + ".xlsx"))
            let owner = try LogbookTableSession(directory: directory, expected: 7, bookmark: Data(), kind: "record-table", available: { 1024 * 1024 * 1024 }, deferStorage: true)
            try bytes.write(to: picked)
            let input = try FileHandle(forReadingFrom: picked)
            let captured = try owner.capture(input, name: "public.xlsx"); try input.close()
            try require(captured["bytes"] as? Int == bytes.count && captured["sha256"] as? String == LogbookArchive.digest(bytes), "record source proves full EOF/SHA: " + name)
            try require(try Data(contentsOf: owner.sourceURL) == bytes && FileManager.default.fileExists(atPath: owner.directory.appendingPathComponent("index.sqlite").path), "record acceleration always retains complete durable source and index")
            try Data("outside picked file replaced".utf8).write(to: picked)
            let kernel = try owner.inspectRecordsKernel()
            var supported = false
            if let kernel {
                let proof = kernel["source"] as! LogbookJSON, text = kernel["payloadJson"] as! String
                let payload = try JSONSerialization.jsonObject(with: Data(text.utf8)) as! LogbookJSON
                supported = payload["supported"] as? Bool == true
                try require(proof["bytes"] as? Int == bytes.count && proof["sha256"] as? String == captured["sha256"] as? String, "record projection is bound to original complete captured source")
                if supported { try require(payload["version"] as? Int == 1 && payload["projection"] as? String == "records" && payload["compact"] as? Bool == true, "record projection protocol preserves complete compact cells") }
            }
            try require(supported == (item["native"] as! Bool), "record native/full-fallback decision: " + name)
            // Both supported and unsupported inputs keep their original writable
            // private stage. The character-only RAM owner is never substituted.
            let string = "完整私有字符串😀\r\n\u{0000}末尾"
            try owner.append(key: "strings", chunkIndex: 0, bytes: logbookData([0, string]) + Data([10]))
            try require(Data(base64Encoded: try owner.readString(0, offset: 0)["base64"] as! String) == Data(string.utf8), "record kernel/fallback retains complete writable string stage")
            try owner.append(key: "candidate", chunkIndex: 0, bytes: Data("T{}\n".utf8))
            try owner.close()
            try require(!FileManager.default.fileExists(atPath: owner.directory.path), "record projection cleanup removes only owned private files")
        }

        // The bridge wrapper validates every UTF-8 byte but deliberately leaves
        // structural JSON parsing to the Worker. Exercise actual malloc ownership.
        func ownedCString(_ bytes: [UInt8]) -> UnsafeMutablePointer<CChar> {
            let pointer = malloc(bytes.count + 1)!.assumingMemoryBound(to: UInt8.self)
            for (index, value) in bytes.enumerated() { pointer[index] = value }
            pointer[bytes.count] = 0
            return UnsafeMutableRawPointer(pointer).assumingMemoryBound(to: CChar.self)
        }
        let opaque = "{\"version\":1,\"supported\":false,\"text\":\"完整😀\\u0000\\r\\n尾\"}"
        try require(try LogbookTableKernel.takeRecordsPayload(ownedCString(Array(opaque.utf8))) == opaque, "record bridge preserves whole UTF-8 JSON string without reserialization")
        try require(try LogbookTableKernel.takeRecordsPayload(nil) == nil, "record kernel allocation failure retains complete fallback")
        let invalidEncodings: [[UInt8]] = [[0xc0, 0xaf], [0xed, 0xa0, 0x80], [0xe2, 0x82]]
        for invalid in invalidEncodings {
            try rejects("invalid UTF-8 anywhere in record kernel output is rejected") { _ = try LogbookTableKernel.takeRecordsPayload(ownedCString(Array("{\"text\":\"".utf8) + invalid + Array("\"}".utf8))) }
        }

        let fullBytes = try Data(contentsOf: corpus.appendingPathComponent("record-complete-118-rows-334k-inline.xlsx"))
        let manual = try String(contentsOf: corpus.appendingPathComponent("record-complete-manual.txt"), encoding: .utf8)
        let expectedManual = String(repeating: "  公开完整正文😀\r\n\u{0000}", count: 13000) + "末行不可截断\r\n "
        try require(manual == expectedManual && Data(manual.utf8).count == 351021, "independent record corpus keeps every large Unicode/NUL/CRLF body byte")
        let constrained = try LogbookTableKernel.inspectRecords(fullBytes, available: 0)
        let constrainedValue = try constrained.map { try JSONSerialization.jsonObject(with: Data($0.utf8)) as! LogbookJSON }
        try require(constrainedValue == nil || constrainedValue?["supported"] as? Bool == false, "kernel resource shortage requests full fallback rather than partial records")
        let store = try LogbookStore(url: directory.appendingPathComponent("state.sqlite"), available: { 1024 * 1024 * 1024 })
        _ = try store.replace(fixture, expected: 0)
        let original = try logbookData(store.fullSnapshot()!), originalBodies = try store.rows("SELECT id,body FROM records ORDER BY position")
        let row: LogbookJSON = ["sheet": "公开场次", "moduleName": "Kernel完整公开模组", "sessionName": "Kernel完整正文", "link": "", "manualContent": manual, "kps": [String](), "pairs": [LogbookJSON]()]
        let candidate = Data([84]) + (try logbookData(["sheetOrder": 0, "rowOrder": 0, "value": row])) + Data([10])
        let proof = LogbookBackupProof(bytes: candidate.count, sha256: LogbookArchive.digest(candidate))
        func open(_ replacementBytes: Data? = nil, name: String = "public.xlsx") throws -> LogbookTableSession {
            try (replacementBytes ?? fullBytes).write(to: picked)
            let owner = try LogbookTableSession(directory: directory, expected: store.revision(), bookmark: Data("public".utf8), kind: "record-table", available: { 1024 * 1024 * 1024 })
            let input = try FileHandle(forReadingFrom: picked); defer { try? input.close() }
            _ = try owner.capture(input, name: name); return owner
        }
        func stage(_ owner: LogbookTableSession, _ expected: LogbookBackupProof? = nil) throws {
            for (part, start) in stride(from: 0, to: candidate.count, by: LogbookLimits.transferChunkBytes).enumerated() {
                try owner.append(key: "candidate", chunkIndex: part, bytes: candidate.subdata(in: start..<min(candidate.count, start + LogbookLimits.transferChunkBytes)))
            }
            _ = try owner.preview(expected ?? proof, store: store)
        }
        var changed = fullBytes; changed[changed.startIndex] ^= 1
        for replacement in [changed, Data(fullBytes.dropLast()), fullBytes + Data([0])] {
            let owner = try open(); try Data(replacement).write(to: owner.sourceURL)
            try rejects("changed source cannot produce a record kernel proof") { _ = try owner.inspectRecordsKernel() }
            try rejects("changed source remains noncommittable after kernel rejection") { try stage(owner) }
            try owner.close()
        }
        let afterProjection = try open(); _ = try afterProjection.inspectRecordsKernel()
        try changed.write(to: afterProjection.sourceURL)
        try rejects("source changed after projection cannot reach preview") { try stage(afterProjection) }; try afterProjection.close()
        let afterPreview = try open(); _ = try afterPreview.inspectRecordsKernel(); try stage(afterPreview)
        try changed.write(to: afterPreview.sourceURL)
        try rejects("source changed after record preview cannot commit") { try afterPreview.prepareCommit(store: store) }; try afterPreview.close()
        let badProof = try open(); _ = try badProof.inspectRecordsKernel()
        try rejects("record kernel does not authorize a bad candidate SHA") { try stage(badProof, LogbookBackupProof(bytes: candidate.count, sha256: String(repeating: "0", count: 64))) }; try badProof.close()
        try require(try store.revision() == 1 && logbookData(store.fullSnapshot()!) == original, "all record kernel corruption failures preserve full original store")

        let largeBytes = try Data(contentsOf: corpus.appendingPathComponent("source-cache-overflow-is-full-fallback.xlsx"))
        try require(largeBytes.count > 2 * 1024 * 1024, "public valid source crosses optional resident budget")
        let fallback = try open(largeBytes)
        try require(try fallback.inspectRecordsKernel() == nil && Data(contentsOf: fallback.sourceURL) == largeBytes, "resident source budget retains complete oversized source for full fallback")
        try fallback.append(key: "candidate", chunkIndex: 0, bytes: Data("T{}\n".utf8)); try fallback.close()
        let csv = try open(Data("公开完整CSV\n".utf8), name: "public.csv")
        try require(try csv.inspectRecordsKernel() == nil, "non-XLSX record formats preserve original complete parser"); try csv.close()

        let stale = try open(); _ = try stale.inspectRecordsKernel(); try stage(stale)
        _ = try store.mutate(expected: 1) { $0["exportedAt"] = "2099-01-01T00:00:00Z" }
        try rejects("record kernel projection never bypasses CAS") { try stale.prepareCommit(store: store) }; try stale.close()
        let beforeCommit = try logbookData(store.fullSnapshot()!)
        let revoked = try open(); _ = try revoked.inspectRecordsKernel(); try stage(revoked); try revoked.prepareCommit(store: store)
        var authorizations = 0
        try rejects("record kernel final authorization failure rolls back complete body") {
            _ = try store.importTableStream(revoked) { authorizations += 1; if authorizations == 2 { throw LogbookFailure("public revoked permission") } }
        }
        try revoked.close()
        try require(try store.revision() == 2 && logbookData(store.fullSnapshot()!) == beforeCommit, "record kernel revoked authorization preserves revision and all bodies")
        let rollback = try open(); _ = try rollback.inspectRecordsKernel(); try stage(rollback); try rollback.prepareCommit(store: store)
        try store.execute("CREATE TRIGGER record_kernel_fail BEFORE UPDATE ON state BEGIN SELECT RAISE(ABORT,'public rollback'); END")
        try rejects("record kernel SQL failure rolls back") { _ = try store.importTableStream(rollback) }
        try store.execute("DROP TRIGGER record_kernel_fail"); try rollback.close()
        try require(try store.revision() == 2 && logbookData(store.fullSnapshot()!) == beforeCommit, "record kernel SQL rollback preserves every original field")
        let success = try open(); _ = try success.inspectRecordsKernel(); try stage(success); try success.prepareCommit(store: store)
        try require(!FileManager.default.fileExists(atPath: success.directory.path), "kernel-backed commit removes private stages before publication")
        _ = try store.importTableStream(success); try success.close()
        let saved = try store.rows("SELECT id FROM records WHERE json_extract(metadata,'$.name')='Kernel完整正文'")
        try require(try saved.count == 1 && logbookObject(store.bodyText(saved[0][0]!))["manualContent"] as? String == manual, "record kernel writable owner commits the entire independent 334KiB body")
        try require(Array(try store.rows("SELECT id,body FROM records ORDER BY position").prefix(originalBodies.count)) == originalBodies, "record kernel commit preserves all previous raw bodies byte for byte")
        let reopened = try LogbookStore(url: directory.appendingPathComponent("state.sqlite"), available: { 1024 * 1024 * 1024 })
        try require(try reopened.revision() == 3 && logbookObject(reopened.bodyText(saved[0][0]!))["manualContent"] as? String == manual, "complete kernel-backed body and revision survive restart")
        print("PUBLIC_IOS_RECORD_KERNEL cases=\(manifest.count) fullSource=true strictUTF8=true full334KiBBody=true sourceCandidateSHA=true CAS=true authorizationRollback=true SQLRollback=true phone=false")
    }

    static func chunkStorageChecks(root: URL, fixture: LogbookJSON) throws {
        let MiB = 1024 * 1024, directory = root.appendingPathComponent("single-large-public")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        var free = 16 * 1024 * MiB
        let database = directory.appendingPathComponent("state.sqlite"), store = try LogbookStore(url: database, available: { free })
        var baseline = fixture, record = (fixture["records"] as! [LogbookJSON]).first { $0["sourceType"] as? String == "manual" }!
        record.removeValue(forKey: "rawContent"); record["manualContent"] = "before"
        baseline["records"] = [record]; _ = try store.replace(baseline, expected: 0)
        let id = record["id"] as! String
        let original = "{\"manualContent\":\"before\",\"rawContent\":{\"parserVersion\":1.000e0,\"messages\":[]}}"
        try store.execute("UPDATE records SET body=? WHERE id=?", [original, id])
        print("CHUNK_STAGE transactional v2 migration preserves inline tokens")
        // Simulate a v2 store and force migration failure after the new tables
        // and triggers are created. The schema and content must roll back too.
        try store.execute("DROP TABLE value_chunks"); try store.execute("DROP TABLE value_manifests")
        try store.execute("PRAGMA user_version=2")
        try store.execute("INSERT INTO record_sizes VALUES('public-invalid-ledger',1,1)")
        try rejects("v3 migration failure rolls back schema") { _ = try LogbookStore(url: database, available: { free }) }
        try require(try store.rows("PRAGMA user_version")[0][0] == "2" && store.rows("SELECT COUNT(*) FROM sqlite_master WHERE name='value_chunks'")[0][0] == "0" && store.rows("SELECT body FROM records WHERE id=?", [id])[0][0] == original, "failed migration keeps v2 schema and exact inline body")
        try store.execute("DELETE FROM record_sizes WHERE id='public-invalid-ledger'")
        let migrated = try LogbookStore(url: database, available: { free })
        try require(try migrated.rows("PRAGMA user_version")[0][0] == "3" && migrated.bodyText(id) == original && migrated.revision() == 1, "v2 migration changes no body and no revision")

        print("CHUNK_STAGE single65MiB manual table candidate and SST")
        let source = directory.appendingPathComponent("public.csv"); try Data("public".utf8).write(to: source)
        let table = try LogbookTableSession(directory: directory, expected: 1, bookmark: Data(), kind: "record-table", available: { free })
        let input = try FileHandle(forReadingFrom: source); _ = try table.capture(input, name: "public.csv"); try input.close()
        let large = "公开😀\0\r\n" + String(repeating: "X", count: 65 * MiB) + "完整尾"
        func append(_ data: Data, key: String) throws {
            for (part, start) in stride(from: 0, to: data.count, by: LogbookLimits.transferChunkBytes).enumerated() {
                try table.append(key: key, chunkIndex: part, bytes: data.subdata(in: start..<min(data.count, start + LogbookLimits.transferChunkBytes)))
            }
        }
        try append(logbookData([0, large]) + Data([10]), key: "strings")
        let utf8 = Data(large.utf8), offset = utf8.count - 11
        let tail = try table.readString(0, offset: offset)
        try require(tail["bytes"] as? Int == utf8.count && tail["done"] as? Bool == true && Data(base64Encoded: tail["base64"] as! String) == utf8.subdata(in: offset..<utf8.count), "single SST string above64MiB remains complete at byte offsets")
        let module = (fixture["modules"] as! [LogbookJSON]).first { $0["id"] as? String == record["moduleId"] as? String }!
        let row: LogbookJSON = ["sheet": "public", "moduleName": module["name"]!, "sessionName": record["name"]!, "link": record["link"] ?? "", "kps": [String](), "pairs": [LogbookJSON](), "manualContent": large]
        let candidate = Data([84]) + (try logbookData(["sheetOrder": 0, "rowOrder": 0, "value": row])) + Data([10])
        try append(candidate, key: "candidate")
        print("CHUNK_STAGE finishing SQLite table preview")
        let preview = try table.preview(LogbookBackupProof(bytes: candidate.count, sha256: LogbookArchive.digest(candidate)), store: migrated)
        try require(preview["updated"] as? Int == 1 && preview["added"] as? Int == 0, "single large manual import updates uniquely matched record")
        try require(try table.index.count("SELECT MAX(length(value)) FROM value_chunks") <= LogbookLimits.transferChunkBytes && table.index.count("SELECT MAX(length(value)) FROM frames") <= LogbookLimits.transferChunkBytes && table.index.count("SELECT MAX(length(manual)) FROM entities") <= LogbookLimits.transferChunkBytes, "table candidates manual and SST never need oversized SQLite cells")
        print("CHUNK_STAGE preview ready; preparing sequential commit spools")
        try table.prepareCommit(store: migrated)
        print("CHUNK_STAGE commit spools prepared and paths removed; committing")
        _ = try migrated.importTableStream(table); try table.close()
        let complete = try migrated.bodyText(id), completeHash = LogbookArchive.digest(Data(complete.utf8))
        try require(complete.contains("1.000e0") && (try logbookObject(complete))["manualContent"] as? String == large, "large manual update preserves complete Unicode NUL and exact old raw numeric tokens")
        try require(try migrated.rows("SELECT MAX(length(value)) FROM value_chunks")[0][0] == String(LogbookLimits.transferChunkBytes) && migrated.logicalBytes() > 65 * MiB, "production chunks bounded and logical usage complete")
        try rejects("record primary key cannot detach chunk references") { try migrated.execute("UPDATE records SET id='public-renamed' WHERE id=?", [id]) }
        try require(try LogbookArchive.digest(Data(migrated.bodyText(id).utf8)) == completeHash, "rejected identifier change preserves chunk body")
        let reopened = try LogbookStore(url: database, available: { free })
        try require(try reopened.revision() == 2 && LogbookArchive.digest(Data(reopened.bodyText(id).utf8)) == completeHash, "large single body reopens intact")

        print("CHUNK_STAGE complete backup restore upload and error rollback")
        let backup = try reopened.backupFile(expected: 2, directory: directory)
        let envelope = try logbookObject(String(contentsOf: backup, encoding: .utf8)), full = envelope["snapshot"] as! LogbookJSON
        try require((full["records"] as! [LogbookJSON])[0]["manualContent"] as? String == large, "single above64MiB backup contains complete body")
        let uploadBytes = try logbookData(full), upload = try LogbookSnapshotUpload(directory: directory, expected: 2, bytes: uploadBytes.count, sha256: LogbookArchive.digest(uploadBytes), available: { free })
        for (part, start) in stride(from: 0, to: uploadBytes.count, by: LogbookLimits.transferChunkBytes).enumerated() { try upload.append(index: part, base64: uploadBytes.subdata(in: start..<min(start + LogbookLimits.transferChunkBytes, uploadBytes.count)).base64EncodedString()) }
        _ = try upload.snapshot()
        try require((upload.recordJSON?.count ?? 0) > 65 * MiB, "single upload above64MiB remains complete"); try upload.close()
        var metadata = try reopened.metadata()!, restore = Data([82])
        restore.append(try logbookData((full["records"] as! [LogbookJSON])[0])); restore.append(10); restore.append(77); restore.append(try logbookData(metadata)); restore.append(10)
        let restoreFile = directory.appendingPathComponent("restore-candidate"); try restore.write(to: restoreFile)
        let restoreProof = LogbookBackupProof(bytes: restore.count, sha256: LogbookArchive.digest(restore))
        func restoreIntoStore(_ expected: Int) throws -> Int {
            let input = try FileHandle(forReadingFrom: restoreFile); defer { try? input.close() }
            let preview = try LogbookRestoreCandidate.inspect(input, proof: restoreProof); try input.seek(toOffset: 0)
            return try reopened.restoreCandidate(input, preview: preview, expected: expected, restoreSettings: true, authorize: {})
        }
        try reopened.execute("CREATE TRIGGER fail_large BEFORE UPDATE ON state BEGIN SELECT RAISE(ABORT,'public rollback'); END")
        try rejects("large restore SQL rollback") { _ = try restoreIntoStore(2) }
        try reopened.execute("DROP TRIGGER fail_large")
        try require(try reopened.revision() == 2 && LogbookArchive.digest(Data(reopened.bodyText(id).utf8)) == completeHash, "large restore rollback restores every chunk and proof")
        free = LogbookCapacity.minimumReserve
        try rejects("large content low disk rollback") { _ = try reopened.replace(full, expected: 2) }
        free = 16 * 1024 * MiB
        try require(try restoreIntoStore(2) == 3 && (reopened.fullSnapshot(selected: [id])!["records"] as! [LogbookJSON])[0]["manualContent"] as? String == large, "single full body restore and reopen paths no64MiB gate")
        try reopened.execute("BEGIN")
        try reopened.execute("DELETE FROM value_chunks WHERE key=? AND part=1", ["body:" + id])
        try rejects("missing chunk cannot masquerade as empty body") { _ = try reopened.bodyText(id) }
        try reopened.execute("ROLLBACK")
        // Metadata/root have the same chunk representation. Large labels are
        // resource-bound too, rather than inheriting SQLite's cell length cap.
        print("CHUNK_STAGE large metadata root and corruption rejection")
        var modules = metadata["modules"] as! [LogbookJSON]; modules[0]["name"] = large; metadata["modules"] = modules
        _ = try reopened.mutate(expected: 3) { try LogbookMutations.module(modules[0], data: &$0) }
        let final = try LogbookStore(url: database, available: { free })
        try require(try (final.metadata()!["modules"] as! [LogbookJSON])[0]["name"] as? String == large && final.rows("SELECT length(json) FROM state")[0][0] == String("@chunks:state".utf8.count), "large metadata root uses bounded cells and reopens intact")
        try final.execute("BEGIN"); try final.execute("DELETE FROM value_manifests WHERE key=?", ["body:" + id])
        try rejects("missing manifest cannot silently erase a body") { _ = try final.bodyText(id) }; try final.execute("ROLLBACK")
        try require(try final.rows("PRAGMA integrity_check")[0][0] == "ok", "chunked store SQLite integrity")
        print("PUBLIC_IOS_SINGLE_BODY bytes=\(utf8.count) chunkBytes=262144 v3MigrationRollback=true fullBody=true restoreRollback=true phone=false")
    }

    static func tablePreviewBatchChecks(root: URL, fixture: LogbookJSON) throws {
        let free = 32 * 1024 * 1024 * 1024
        let store = try LogbookStore(url: root.appendingPathComponent("table-preview-batch/state.sqlite"), available: { free })
        _ = try store.replace(fixture, expected: 0)
        let before = try logbookData(store.fullSnapshot()!), originals = try store.rows("SELECT id,body FROM records ORDER BY position")
        let source = root.appendingPathComponent("table-preview-batch-source.csv")
        try Data("public independent source".utf8).write(to: source)
        func owner(_ available: @escaping () throws -> Int = { 32 * 1024 * 1024 * 1024 }) throws -> LogbookTableSession {
            let value = try LogbookTableSession(directory: root.appendingPathComponent("table-preview-batch-stage"), expected: store.revision(), bookmark: Data("public".utf8), kind: "record-table", available: available)
            let input = try FileHandle(forReadingFrom: source); defer { try? input.close() }; _ = try value.capture(input, name: "public.csv"); return value
        }
        func row(_ module: String, _ name: String, _ link: String, _ manual: String? = nil) -> LogbookJSON {
            var result: LogbookJSON = ["sheet": "公开表", "moduleName": module, "sessionName": name, "link": link, "kps": ["公开KP"], "pairs": [LogbookJSON]()]
            if let manual { result["manualContent"] = manual }; return result
        }
        func frame(_ value: LogbookJSON, _ position: Int) throws -> Data {
            var bytes = Data([84]); bytes.append(try logbookData(["sheetOrder": 0, "rowOrder": position, "value": value])); bytes.append(10); return bytes
        }
        func send(_ bytes: Data, _ value: LogbookTableSession) throws -> LogbookBackupProof {
            for (index, start) in stride(from: 0, to: bytes.count, by: LogbookLimits.transferChunkBytes).enumerated() {
                try value.append(key: "candidate", chunkIndex: index, bytes: bytes.subdata(in: start..<min(bytes.count, start + LogbookLimits.transferChunkBytes)))
            }
            return LogbookBackupProof(bytes: bytes.count, sha256: LogbookArchive.digest(bytes))
        }
        let table = try owner(); defer { try? table.close() }
        var bytes = Data()
        for i in 0..<114 { bytes.append(try frame(row(i == 57 ? "公开B" : "公开A", "公开场\(i)", "https://log.weizaima.com/?key=batch-\(i)"), i)) }
        bytes.append(try frame(row("公开A", "完整手动", "", "首份正文😀\r\n\u{0000}尾"), 114))
        var duplicate = row("公开A", "重复来源", "https://log.weizaima.com/?key=batch-0")
        duplicate["kps"] = ["后到KP"]; duplicate["pairs"] = [["pc": "后到PC", "pl": "后到PL"]]
        bytes.append(try frame(duplicate, 115))
        let body = "最终完整正文😀\r\n\u{0000}末尾"
        bytes.append(try frame(row("公开A", "完整手动", "", body), 116))
        let result = try table.preview(send(bytes, table), store: store)
        try require(result["added"] as? Int == 115 && result["updated"] as? Int == 1 && result["skipped"] as? Int == 1, "batch reused and revisited modules preserve every addition/update/duplicate")
        try require(result["namesCount"] as? Int == 116 && (try table.page("names", offset: 100, limit: 100)["values"] as? [String])?.count == 16, "batch full preview tail retained")
        try require(try logbookData(store.fullSnapshot()!) == before, "batch preview does not write production")
        try table.prepareCommit(store: store); _ = try store.importTableStream(table); try table.close()
        let saved = try store.fullSnapshot()!, records = saved["records"] as! [LogbookJSON]
        try require(records.count == originals.count + 115 && Array(try store.rows("SELECT id,body FROM records ORDER BY position").prefix(originals.count)) == originals, "batch commit preserves every original body byte")
        for i in 0..<114 {
            let value = records[originals.count + i]
            try require(value["name"] as? String == "公开场\(i)" && value["link"] as? String == "https://log.weizaima.com/?key=batch-\(i)", "batch complete link and ordered name")
            let sequence = i == 57 ? 1 : i < 57 ? i + 1 : i
            try require(value["sequenceNo"] as? Int == sequence, "batch module-local sequence survives module revisit")
        }
        try require(records.last?["manualContent"] as? String == body && records.last?["sequenceNo"] as? Int == 114, "batch final manual Unicode/NUL body is complete")
        let module = (saved["modules"] as! [LogbookJSON]).first { $0["name"] as? String == "公开A" }!
        try require(module["kps"] as? [String] == ["公开KP", "后到KP"] && (module["pairs"] as? [LogbookJSON])?.first?["pc"] as? String == "后到PC", "duplicate rows still merge late participants")
        let after = try logbookData(saved), revision = try store.revision()
        for lowSpace in [false, true] {
            var available = free
            let rejected = try owner { available }; defer { try? rejected.close() }
            var candidate = Data()
            for i in 0..<115 { candidate.append(try frame(row("连续验证", "场\(i)", "https://log.weizaima.com/?key=validate-\(i)"), i)) }
            var invalid = row("连续验证", "重复", "https://log.weizaima.com/?key=validate-0")
            if !lowSpace { invalid["kps"] = [5] }
            candidate.append(try frame(invalid, 115)); let proof = try send(candidate, rejected)
            if lowSpace { available = LogbookCapacity.minimumReserve }
            try rejects("batch still rejects invalid duplicate participants or capacity loss") { _ = try rejected.preview(proof, store: store) }
            available = free; try rejected.close()
            try require(try store.revision() == revision && logbookData(store.fullSnapshot()!) == after, "failed batch preserves every production value and revision")
        }
        print("PUBLIC_IOS_TABLE_BATCH rows=115 moduleRevisit=true lateParticipants=true fullBody=true validationAndCapacityRollback=true phone=false")
    }

    static func tableStreamChecks(root: URL, fixture: LogbookJSON) throws {
        try tableRecordKernelChecks(root: root, fixture: fixture)
        try tablePreviewBatchChecks(root: root, fixture: fixture)
        let MiB = 1024 * 1024, free = { 8 * 1024 * 1024 * 1024 }
        let base = root.appendingPathComponent("table-tests"), source = root.appendingPathComponent("table-public.csv")
        try Data("模组名,场次名,手动保存内容\n公开夹具,第一场,完整正文\n".utf8).write(to: source)
        let store = try LogbookStore(url: root.appendingPathComponent("table-db/state.sqlite"), available: free)
        _ = try store.replace(fixture, expected: 0)
        let originalBodies = try store.rows("SELECT id,body FROM records ORDER BY position")
        let oldModule = (fixture["modules"] as! [LogbookJSON])[0]
        func owner(_ kind: String = "record-table") throws -> LogbookTableSession {
            let value = try LogbookTableSession(directory: base, expected: store.revision(), bookmark: Data("public-bookmark".utf8), kind: kind, available: free)
            let input = try FileHandle(forReadingFrom: source); defer { try? input.close() }
            _ = try value.capture(input, name: "公开.csv"); return value
        }
        func row(_ module: String, _ name: String, _ manual: String, link: String = "") -> LogbookJSON {
            ["sheet": "公开表格", "moduleName": module, "sessionName": name, "link": link, "manualContent": manual, "kps": ["KP"], "pairs": [["pc": "PC", "pl": "PL"]]]
        }
        func frame(_ value: LogbookJSON, sheet: Int = 0, row: Int = 0, prefix: String = "T", warnings: [String]? = nil) throws -> Data {
            var wrapper: LogbookJSON = ["sheetOrder": sheet, "rowOrder": row, "value": value]
            if let warnings { wrapper["warnings"] = warnings }
            var bytes = Data(prefix.utf8); bytes.append(try logbookData(wrapper)); bytes.append(10); return bytes
        }
        func append(_ bytes: Data, to session: LogbookTableSession, key: String = "candidate", next: inout Int) throws {
            for start in stride(from: 0, to: bytes.count, by: LogbookLimits.transferChunkBytes) {
                try session.append(key: key, chunkIndex: next, bytes: bytes.subdata(in: start..<min(bytes.count, start + LogbookLimits.transferChunkBytes))); next += 1
            }
        }
        func preview(_ bytes: Data, _ session: LogbookTableSession) throws -> LogbookJSON {
            var next = 0; try append(bytes, to: session, next: &next)
            return try session.preview(LogbookBackupProof(bytes: bytes.count, sha256: LogbookArchive.digest(bytes)), store: store)
        }
        // Out-of-order physical sheets must apply in workbook order. Repeated
        // manual rows update a newly added record, not create duplicate bodies.
        print("TABLE_STAGE ordered coalescing and unlink/commit")
        let ordered = try owner()
        var bytes = try frame(row("公开新团", "同名", "最终正文\n😀\u{0000}完整"), sheet: 2)
        bytes.append(try frame(row("公开新团", "同名", "第一份正文"), sheet: 0))
        bytes.append(try frame(row("公开新团", "同名", "中间正文"), sheet: 1))
        let result = try preview(bytes, ordered)
        try require(result["added"] as? Int == 1 && result["updated"] as? Int == 2, "table sorted coordinates and new manual coalescing")
        try require(try store.revision() == 1 && store.rows("SELECT id,body FROM records ORDER BY position") == originalBodies, "table preview never mutates production")
        try ordered.prepareCommit(store: store)
        try require(!FileManager.default.fileExists(atPath: ordered.directory.path), "table cleanup precedes publication")
        _ = try store.importTableStream(ordered); try ordered.close()
        let saved = try store.rows("SELECT body FROM records WHERE json_extract(metadata,'$.name')='同名'")
        try require(saved.count == 1 && logbookObject(saved[0][0])["manualContent"] as? String == "最终正文\n😀\u{0000}完整", "table final complete manual content")
        try require(Array(try store.rows("SELECT id,body FROM records ORDER BY position").prefix(originalBodies.count)) == originalBodies, "table import preserves every previous body byte")

        print("TABLE_STAGE duplicates, integrity, authorization and rollback")
        let duplicate = try owner()
        let link = "https://log.weizaima.com/?key=public-table"
        var links = try frame(row(oldModule["name"] as! String, "链接一", "", link: link))
        links.append(try frame(row(oldModule["name"] as! String, "链接二", "", link: link), row: 1))
        let duplicates = try preview(links, duplicate)
        try require(duplicates["added"] as? Int == 1 && duplicates["skipped"] as? Int == 1, "table duplicate links skip after first candidate")
        try duplicate.close()

        let invalid = try owner()
        try rejects("table rejects external URL") { _ = try preview(frame(row("公开", "坏链接", "", link: "https://example.com/?key=x")), invalid) }
        try invalid.close()
        let changedSource = try owner(); _ = try preview(frame(row("公开", "来源变化", "正文")), changedSource)
        try Data("changed".utf8).write(to: changedSource.sourceURL)
        try rejects("table source hash changes reject before publication") { try changedSource.prepareCommit(store: store) }; try changedSource.close()
        let changedIndex = try owner(); _ = try preview(frame(row("公开", "候选变化", "正文")), changedIndex)
        let tamper = try FileHandle(forWritingTo: changedIndex.directory.appendingPathComponent("index.sqlite"))
        try tamper.seekToEnd(); try tamper.write(contentsOf: Data([1])); try tamper.close()
        try rejects("table sealed index proof changes reject") { try changedIndex.prepareCommit(store: store) }; try changedIndex.close()
        let cleanupFailure = try owner(); _ = try preview(frame(row("公开", "清理失败", "正文")), cleanupFailure)
        let unexpectedFile = cleanupFailure.directory.appendingPathComponent("user-unowned-file")
        try Data("public keep".utf8).write(to: unexpectedFile)
        try rejects("table cleanup failure blocks commit") { try cleanupFailure.prepareCommit(store: store) }
        try require(FileManager.default.fileExists(atPath: unexpectedFile.path), "table cleanup preserves unowned file")
        try FileManager.default.removeItem(at: unexpectedFile); try cleanupFailure.close()
        let coordinates = try owner(); let repeated = try frame(row("公开", "重复坐标", "正文"))
        try rejects("table duplicate frame coordinates") { _ = try preview(repeated + repeated, coordinates) }; try coordinates.close()
        let unknown = try owner(); var unexpected = row("公开", "未知权限", "正文"); unexpected["rawContent"] = [:]
        try rejects("table row cannot restore arbitrary raw body") { _ = try preview(frame(unexpected), unknown) }; try unknown.close()

        let before = try store.rows("SELECT id,body FROM records ORDER BY position"), revision = try store.revision()
        let rollback = try owner(); _ = try preview(frame(row("回滚公开团", "事务", "必须回滚")), rollback)
        try rollback.prepareCommit(store: store)
        try store.execute("CREATE TRIGGER fail_table_root BEFORE UPDATE ON state BEGIN SELECT RAISE(ABORT,'public injected failure'); END")
        try rejects("table production SQLite failure rolls back") { _ = try store.importTableStream(rollback) }
        try rollback.close(); try store.execute("DROP TRIGGER fail_table_root")
        try require(try store.revision() == revision && store.rows("SELECT id,body FROM records ORDER BY position") == before, "table transaction preserves revision and bodies on failure")
        let revoked = try owner(); _ = try preview(frame(row("授权回滚", "事务", "必须回滚")), revoked); try revoked.prepareCommit(store: store)
        var authorizations = 0
        try rejects("table permission loss before COMMIT rolls back") {
            _ = try store.importTableStream(revoked) { authorizations += 1; if authorizations == 2 { throw LogbookFailure("public permission revoked") } }
        }
        try revoked.close()
        try require(try store.revision() == revision && store.rows("SELECT id,body FROM records ORDER BY position") == before, "table final authorization rollback")
        let stale = try owner(); _ = try preview(frame(row("过期", "事务", "正文")), stale)
        _ = try store.mutate(expected: revision) { $0["exportedAt"] = logbookNow() }
        try rejects("table CAS rejects stale preview") { try stale.prepareCommit(store: store) }; try stale.close()

        // Total SST >64MiB stays on disk; byte offsets may split UTF-8 and NUL.
        print("TABLE_STAGE SST chunk storage")
        let strings = try owner(); var stringChunk = 0
        let text = String(repeating: "s", count: MiB) + "😀\u{0000}尾"
        for number in 0..<65 {
            var bytes = try logbookData([number, text]); bytes.append(10)
            try append(bytes, to: strings, key: "strings", next: &stringChunk)
        }
        let tail = try strings.readString(64, offset: MiB + 1)
        let all = Data(text.utf8)
        try require(tail["bytes"] as? Int == all.count && tail["done"] as? Bool == true && Data(base64Encoded: tail["base64"] as! String) == all.subdata(in: (MiB + 1)..<all.count), "SST above 64MiB bounded UTF8 byte-offset reading")
        try rejects("SST missing index") { _ = try strings.readString(65, offset: 0) }; try strings.close()

        // Candidate total exceeds64MiB while each complete record is1MiB.
        print("TABLE_STAGE 65MiB candidate aggregate")
        let large = try owner(); var chunk = 0, total = 0, hash = SHA256()
        let body = String(repeating: "B", count: MiB)
        for number in 0..<65 {
            let bytes = try frame(row("公开大表", "完整场次\(number)", body), row: number)
            try append(bytes, to: large, next: &chunk); total += bytes.count; hash.update(data: bytes)
        }
        try require(total > 64 * MiB, "public table candidate exceeds former quota")
        let largeProof = LogbookBackupProof(bytes: total, sha256: hash.finalize().map { String(format: "%02x", $0) }.joined())
        let largePreview = try large.preview(largeProof, store: store)
        try require(largePreview["added"] as? Int == 65, "large table preview retains all records")
        try large.prepareCommit(store: store); _ = try store.importTableStream(large); try large.close()
        try require(try store.rows("SELECT COUNT(*) FROM records WHERE json_extract(metadata,'$.name') LIKE '完整场次%'")[0][0] == "65", "large table writes every record")
        for row in try store.rows("SELECT id FROM records WHERE json_extract(metadata,'$.name') LIKE '完整场次%'") {
            try autoreleasepool { try require(try (logbookObject(store.bodyText(row[0]))["manualContent"] as! String).utf8.count == MiB, "large table complete body lengths") }
        }

        print("TABLE_STAGE 50001 entities")
        // This exercises the removed50000 entity gate without retaining bodies
        // or a candidate array. Empty-body records remain individually tiny.
        try autoreleasepool {
            let many = try owner(); var next = 0, total = 0, hash = SHA256()
            for number in 0..<50001 {
                try autoreleasepool {
                    let bytes = try frame(row("公开数量测试", "数量\(number)", ""), row: number)
                    try append(bytes, to: many, next: &next); total += bytes.count; hash.update(data: bytes)
                }
            }
            let proof = LogbookBackupProof(bytes: total, sha256: hash.finalize().map { String(format: "%02x", $0) }.joined())
            let result = try many.preview(proof, store: store)
            try require(result["added"] as? Int == 50001, "table has no50000 candidate entity quota")
            try many.prepareCommit(store: store); _ = try store.importTableStream(many); try many.close()
            try require(try store.rows("SELECT COUNT(*) FROM records WHERE json_extract(metadata,'$.name') LIKE '数量%'")[0][0] == "50001", "table commits every entity beyond50000")
        }

        print("TABLE_STAGE paging and characters")
        let paged = try owner(); var pages = Data()
        for number in 0..<105 { pages.append(try frame(row("分页", "页\(number)", "完整"), row: number)) }
        let pagePreview = try preview(pages, paged)
        try require((pagePreview["names"] as! [String]).count == 100 && pagePreview["namesCount"] as? Int == 105, "table initial preview bounded at100")
        try require((try paged.page("names", offset: 100, limit: 100)["values"] as! [String]).count == 5, "table remaining preview page")
        try paged.close()

        var card = (fixture["characters"] as! [LogbookJSON])[0]; card["id"] = UUID().uuidString.lowercased()
        let characters = try owner("character-table")
        let cards = try preview(frame(card, prefix: "C", warnings: ["公开识别提醒"]), characters)
        try require(cards["added"] as? Int == 1 && cards["warningsCount"] as? Int == 1, "character stream retains recognition warnings")
        try characters.prepareCommit(store: store); _ = try store.importTableStream(characters); try characters.close()

        print("TABLE_STAGE 65MiB metadata")
        // Body-free metadata itself may exceed64MiB. Neither overview nor the
        // next transaction imposes the former whole-library metadata ceiling.
        try autoreleasepool {
            let metadata = try owner(); var next = 0, total = 0, hash = SHA256()
            let longName = String(repeating: "N", count: 128 * 1024)
            for number in 0..<513 {
                try autoreleasepool {
                    let bytes = try frame(row("公开元数据测试", longName + String(number), ""), row: number)
                    try append(bytes, to: metadata, next: &next); total += bytes.count; hash.update(data: bytes)
                }
            }
            let proof = LogbookBackupProof(bytes: total, sha256: hash.finalize().map { String(format: "%02x", $0) }.joined())
            _ = try metadata.preview(proof, store: store); try metadata.prepareCommit(store: store)
            _ = try store.importTableStream(metadata); try metadata.close()
            let summary = try store.metadata()!
            try require(try logbookData(summary).count > 64 * MiB, "metadata overview above64MiB remains readable")
            let current = try store.revision()
            _ = try store.mutate(expected: current) { $0["exportedAt"] = logbookNow() }
            try require(try store.revision() == current + 1, "metadata above64MiB does not block later transaction")
        }

        print("TABLE_STAGE cleanup and source capacity")
        let cancelled = try owner(), cancelledDirectory = cancelled.directory; try cancelled.close()
        try require(!FileManager.default.fileExists(atPath: cancelledDirectory.path), "table exact owner cancellation cleanup")
        let abandoned = try owner(); try LogbookTableSession.cleanupStale(base)
        try require(!FileManager.default.fileExists(atPath: abandoned.directory.path), "table owned restart cleanup"); try abandoned.close()
        try rejects("table unavailable capacity") { _ = try LogbookTableSession(directory: base, expected: 0, bookmark: Data(), kind: "record-table", available: { 0 }) }
        try autoreleasepool {
            let largeSource = root.appendingPathComponent("public-large-table.csv")
            try Data().write(to: largeSource, options: [.withoutOverwriting])
            let output = try FileHandle(forWritingTo: largeSource)
            for _ in 0..<65 { try output.write(contentsOf: Data(repeating: 65, count: MiB)) }
            try output.close()
            let captured = try LogbookTableSession(directory: base, expected: store.revision(), bookmark: Data(), kind: "record-table", available: free)
            let input = try FileHandle(forReadingFrom: largeSource)
            let proof = try captured.capture(input, name: "公开65MiB.csv"); try input.close()
            try require(proof["bytes"] as? Int == 65 * MiB, "picked table source has no64MiB total cap")
            try captured.close(); try FileManager.default.removeItem(at: largeSource)
        }
    }
}
