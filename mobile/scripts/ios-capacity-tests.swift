import Foundation
import Darwin

extension IOSNativeChecks {
    static func crashRestoreForPublicTest(database: URL, candidate: URL) throws {
        guard database.deletingLastPathComponent().lastPathComponent == "capacity-96", candidate.lastPathComponent == "candidate" else { throw LogbookFailure("Refuse non-public crash fixture") }
        let store = try LogbookStore(url: database, deviceSpace: true, available: {32 * 1024 * 1024 * 1024})
        let proof = try LogbookBackupSession.fileProof(candidate, maximumBytes: 128 * 1024 * 1024)
        let input = try FileHandle(forReadingFrom: candidate)
        let preview = try LogbookRestoreCandidate.inspect(input, proof: proof); try input.seek(toOffset: 0)
        var authorizations = 0
        _ = try store.restoreCandidate(input, preview: preview, expected: 2, restoreSettings: true) {
            authorizations += 1
            // Exit after all record/root/revision writes and before SQLite COMMIT.
            if authorizations == 2 { _exit(99) }
        }
        throw LogbookFailure("Crash injection did not execute")
    }
    static func capacityDatabaseChecks(root: URL, fixture: LogbookJSON) throws {
        let MiB = 1024 * 1024
        // Public generated data only. Explicit test mode exercises the actual
        // SQLite path before the production capability is enabled.
        for count in [96, 192, 512] {
            try autoreleasepool {
                let directory = root.appendingPathComponent("capacity-\(count)")
                try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
                defer { try? FileManager.default.removeItem(at: directory) }
                var free = 32 * 1024 * MiB
                let database = directory.appendingPathComponent("state.sqlite")
                let store = try LogbookStore(url: database, deviceSpace: true, available: { free })
                var metadata = fixture
                let sample = (fixture["records"] as! [LogbookJSON]).first { $0["sourceType"] as? String == "manual" }!
                let candidate = directory.appendingPathComponent("candidate")
                try Data().write(to: candidate, options: [.withoutOverwriting])
                let output = try FileHandle(forWritingTo: candidate)
                let body = "公开正文😀\0\r\n" + String(repeating: "A", count: MiB)
                var rows: [LogbookJSON] = []
                for index in 0..<count {
                    try autoreleasepool {
                        var row = sample
                        row["id"] = "capacity-\(index)"; row["name"] = "公开场次\(index)"; row["order"] = index
                        row.removeValue(forKey: "rawContent"); row["manualContent"] = body
                        var line = Data([82]); line.append(try logbookData(row)); line.append(10)
                        try output.write(contentsOf: line)
                        row.removeValue(forKey: "manualContent"); rows.append(row)
                    }
                }
                metadata["records"] = rows
                var last = Data([77]); last.append(try logbookData(metadata)); last.append(10)
                try output.write(contentsOf: last); try output.synchronize(); try output.close()
                let proof = try LogbookBackupSession.fileProof(candidate, maximumBytes: 2 * count * MiB)
                func restore(_ expected: Int, authorize: () throws -> Void = {}) throws -> Int {
                    let input = try FileHandle(forReadingFrom: candidate); defer { try? input.close() }
                    let preview = try LogbookRestoreCandidate.inspect(input, proof: proof)
                    try input.seek(toOffset: 0)
                    return try store.restoreCandidate(input, preview: preview, expected: expected, restoreSettings: true, authorize: authorize)
                }
                try require(try restore(0) == 1, "actual SQLite streamed restore \(count)MiB")
                try require(try store.logicalBytes() > count * MiB && store.deferredIDs().count == count, "indexed complete data exceeds old cap")
                if count == 96 { try require(try (store.fullSnapshot()!["records"] as! [LogbookJSON]).count == count, "complete snapshot above64MiB succeeds with available RAM") }
                let selected = try store.fullSnapshot(selected: ["capacity-0"])!
                try require((selected["records"] as! [LogbookJSON])[0]["manualContent"] as? String == body, "complete selected Unicode and NUL body")
                let original = try store.bodyText("capacity-0")
                let hash = LogbookArchive.digest(Data(original.utf8))
                try store.execute("CREATE TRIGGER protect_bodies BEFORE UPDATE OF body ON records BEGIN SELECT RAISE(ABORT,'unchanged body write'); END")
                try store.execute("CREATE TRIGGER protect_deletes BEFORE DELETE ON records BEGIN SELECT RAISE(ABORT,'unchanged body delete'); END")
                _ = try store.mutate(expected: 1) { data in
                    var settings = data["settings"] as! LogbookJSON; settings["theme"] = "dark"; data["settings"] = settings
                }
                try require(try store.revision() == 2 && LogbookArchive.digest(Data(store.bodyText("capacity-0").utf8)) == hash, "metadata-only edit touches no body")
                try store.execute("DROP TRIGGER protect_bodies"); try store.execute("DROP TRIGGER protect_deletes")
                free = LogbookCapacity.minimumReserve
                try rejects("low space before transaction") { _ = try store.mutate(expected: 2) { $0["exportedAt"] = logbookNow() } }
                free = 32 * 1024 * MiB
                try store.execute("CREATE TRIGGER fail_commit BEFORE UPDATE ON state BEGIN SELECT RAISE(ABORT,'public injected failure'); END")
                try rejects("SQLite failure rolls back entire streamed restore") { _ = try restore(2) }
                try store.execute("DROP TRIGGER fail_commit")
                try require(try store.revision() == 2 && LogbookArchive.digest(Data(store.bodyText("capacity-0").utf8)) == hash, "large restore rollback preserves exact body and CAS")
                try rejects("authorization changes during restore") { _ = try restore(2) { throw LogbookFailure("public denied permission") } }
                let backup = try store.backupFile(expected: 2, directory: directory)
                let fullProof = try LogbookArchive.fileProof(backup, maximumBytes: proof.bytes + MiB)
                try require(fullProof.0 > count * MiB, "native complete automatic/manual JSON \(count)MiB")
                if count == 96 {
                    let selected = directory.appendingPathComponent("selected-search.json")
                    try Data().write(to: selected, options: [.withoutOverwriting])
                    let output = try FileHandle(forWritingTo: selected)
                    try store.writeBackup(expected: 2, maximumBytes: 4 * MiB, selected: ["capacity-0","capacity-95"]) { try output.write(contentsOf: $0) }
                    try output.synchronize(); try output.close()
                    let projected = try logbookObject(String(contentsOf: selected, encoding: .utf8))["snapshot"] as! LogbookJSON
                    try require((projected["records"] as! [LogbookJSON]).map { $0["id"] as! String } == ["capacity-0","capacity-95"], "read-only search source contains only selected complete records")
                    var fastBytes = Data()
                    try store.writeBackup(expected: 2, maximumBytes: 4 * MiB, selected: ["capacity-0","capacity-95"], validateRecords: false) { fastBytes.append($0) }
                    let fastProjected = try logbookObject(String(decoding: fastBytes, as: UTF8.self))["snapshot"] as! LogbookJSON
                    try require(try logbookData(projected) == logbookData(fastProjected), "read-only worker-validated search retains exactly the complete selected data")
                    try rejects("read-only search rejects stale source revision") { try store.writeBackup(expected: 1, maximumBytes: 4 * MiB, selected: ["capacity-0"], validateRecords: false) { _ in } }
                    let owner = try LogbookBackupSession(directory: directory.appendingPathComponent("read-only-source"), expected: 2, bookmark: Data(), restoring: false, includeArchives: false, searching: true, available: { free })
                    _ = try owner.captureJSON { sink in try store.writeBackup(expected: 2, maximumBytes: owner.sourceBudget, selected: ["capacity-0"], sink: sink) }
                    try rejects("search source cannot enable staging or publication") { _ = try owner.beginOutput() }
                    try owner.close()
                }
                if count == 96 {
                    let process = Process(); process.executableURL = URL(fileURLWithPath: CommandLine.arguments[0])
                    process.arguments = ["--public-capacity-crash", database.path, candidate.path]
                    try process.run(); process.waitUntilExit()
                    try require(process.terminationStatus == 99, "native process terminated before SQLite COMMIT")
                    let recovered = try LogbookStore(url: database, deviceSpace: true, available: { free })
                    try require(try recovered.revision() == 2 && recovered.deferredIDs().count == count && LogbookArchive.digest(Data(recovered.bodyText("capacity-0").utf8)) == hash, "process interruption retains complete old library")
                }
                if count == 96 && LogbookLimits.deviceSpaceLibrary {
                    let suite = "coc-capacity-archive-" + UUID().uuidString
                    let preferences = UserDefaults(suiteName: suite)!
                    defer { preferences.removePersistentDomain(forName: suite) }
                    let archive = try LogbookArchive(directory: directory.appendingPathComponent("registry"), preferences: preferences, documentsDirectory: { directory.appendingPathComponent("documents") })
                    _ = try archive.chooseLocalDirectory()
                    let saved = try archive.writeFile(name: "complete-public.json", mime: "application/json", source: backup, purpose: "backup", bookmark: archive.bookmark())
                    try require(saved["sha256"] as? String == fullProof.1 && (saved["bytes"] as? NSNumber)?.intValue == fullProof.0, "large archive publication readback")
                    let share = directory.appendingPathComponent("share"); try FileManager.default.createDirectory(at: share, withIntermediateDirectories: true)
                    let presented = try archive.copyForPresentation(saved["uri"] as! String, directory: share)
                    try require(try LogbookArchive.fileProof(presented, maximumBytes: fullProof.0).1 == fullProof.1, "large registered preview/share copy")
                    for index in 0..<11 { _ = try archive.write(name: "auto-\(index).json", mime: "application/json", bytes: Data("public-\(index)".utf8), purpose: "auto") }
                    let bookmark = try archive.bookmark()
                    try require(archive.rotateAutomatic(bookmark: bookmark).isEmpty, "automatic retention rotation")
                    try require(try archive.documents(all: true).filter { $0["purpose"] as? String == "auto" }.count == 10, "ten previous complete auto backups retained")
                    try archive.removeOwned(saved["uri"] as! String)
                    print("PUBLIC_IOS_CAPACITY_ARCHIVE bytes=\(fullProof.0) readback=true presentation=true automaticRetention=10")
                }
                let reopened = try LogbookStore(url: database, deviceSpace: true, available: { free })
                try require(try reopened.revision() == 2 && reopened.deferredIDs().count == count, "large library restart")
                try require(try reopened.rows("PRAGMA integrity_check")[0][0] == "ok", "large SQLite integrity")
                print("PUBLIC_IOS_CAPACITY records=\(count) candidateBytes=\(proof.bytes) backupBytes=\(fullProof.0) backupSHA256=\(fullProof.1) nativeSQLite=true physicalPhone=false")
            }
        }
    }
}
