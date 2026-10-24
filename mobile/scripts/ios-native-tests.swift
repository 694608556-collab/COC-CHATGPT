import Foundation
import Darwin

@main struct IOSNativeChecks {
    static var checks = 0
    static func require(_ value: @autoclosure () throws -> Bool, _ message: String) throws {
        guard try value() else { throw LogbookFailure("Native check failed: " + message) }; checks += 1
    }
    static func rejects(_ message: String, _ action: () throws -> Void) throws {
        do { try action() } catch { checks += 1; return }
        throw LogbookFailure("Expected rejection: " + message)
    }
    static func main() throws {
        setbuf(stdout, nil)
        if CommandLine.arguments.count == 4 && CommandLine.arguments[1] == "--public-capacity-crash" {
            try crashRestoreForPublicTest(database: URL(fileURLWithPath: CommandLine.arguments[2]), candidate: URL(fileURLWithPath: CommandLine.arguments[3]))
            return
        }
        let MiB = 1024 * 1024
        for json in [#"{"x":1,}"#, #"{"x":[1,]}"#, #"{"x":01}"#, #"{"x":+1}"#, #"{"x":true}tail"#, #"{"x":NaN}"#, #"{"x":1,"\u0078":2}"#] {
            try rejects("strict native candidate JSON grammar") { _ = try LogbookBackupJSON.object(Data(json.utf8)) }
        }
        try rejects("strict native candidate UTF-8") { _ = try LogbookBackupJSON.object(Data([123,34,120,34,58,34,192,175,34,125])) }
        for budget in [0, 256 * MiB] {
            for text in [#"{"x":1,}"#, #"{"x":[1,]}"#, #"{"x":01}"#, #"{"x":true}tail"#, #"{"x":NaN}"#, #"{"x":1,"\u0078":2}"#] {
                try rejects("upload strict proof and zero-memory fallback") { _ = try LogbookBackupJSON.uploadObject(Data(text.utf8), budget: budget) }
            }
            for text in [#"{"\u00e9":1,"e\u0301":2}"#, #"{"nested":{"é":1,"e\u0301":2}}"#, #"{"\u212b":1,"A\u030a":2}"#] {
                try rejects("upload retains Swift canonical-equivalent duplicate key rejection") { _ = try LogbookBackupJSON.uploadObject(Data(text.utf8), budget: budget) }
            }
            let unicodeKeys = Data(#"{"é":1,"nested":{"中文😀":"保留完整值"}}"#.utf8)
            try require(try logbookData(LogbookBackupJSON.uploadObject(unicodeKeys, budget: budget)) == logbookData(LogbookBackupJSON.object(unicodeKeys)), "valid Unicode keys use complete fallback without content rejection")
            try rejects("upload proof invalid UTF8 and fallback") { _ = try LogbookBackupJSON.uploadObject(Data([123,34,120,34,58,34,192,175,34,125]), budget: budget) }
            let publicData = Data(#"{"escaped":"\uD83D\uDE00","number":-1.25e+2,"nested":[true,false,null,{}]}"#.utf8)
            try require(try logbookData(LogbookBackupJSON.uploadObject(publicData, budget: budget)) == logbookData(LogbookBackupJSON.object(publicData)), "same complete strict object with native admission or fallback")
        }
        let strictValid = try LogbookBackupJSON.object(Data(#"{"escaped":"\uD83D\uDE00","number":-1.25e+2,"nested":[true,false,null,{}]}"#.utf8))
        try require(strictValid["escaped"] as? String == "😀" && (strictValid["number"] as? NSNumber)?.doubleValue == -125, "strict native grammar retains valid Unicode and numeric forms")
        try require(try LogbookCapacity.remaining(64 * MiB) == 0, "minimum free-space reserve")
        try require(try LogbookCapacity.remaining(128 * MiB) == 64 * MiB, "available bytes after reserve")
        try require(try LogbookCapacity.remaining(20 * 1024 * MiB) == 19 * 1024 * MiB, "proportional reserve")
        try require(try LogbookCapacity.maximum(available: { 1024 * MiB }, copies: 6) == (1024 * MiB - 64 * MiB) / 6, "native operation budget")
        try LogbookCapacity.require(available: {128 * MiB}, additional: 64 * MiB)
        try rejects("zero-byte final check rejects exhausted reserve") { try LogbookCapacity.require(available: {64 * MiB}, additional: 0) }
        try rejects("space boundary plus one") { try LogbookCapacity.require(available: {128 * MiB}, additional: 64 * MiB + 1) }
        try rejects("unavailable capacity") { _ = try LogbookCapacity.maximum(available: {0}, copies: 1) }
        try rejects("capacity query failure") { _ = try LogbookCapacity.maximum(available: {throw LogbookFailure("unavailable")}, copies: 1) }
        try rejects("invalid copies") { _ = try LogbookCapacity.maximum(available: {1024 * MiB}, copies: 0) }
        try rejects("negative estimate") { _ = try LogbookCapacity.estimate(-1, copies: 6) }
        try rejects("overflow estimate") { _ = try LogbookCapacity.estimate(Int.max, copies: 6) }
        try require(try LogbookCapacity.estimate(512 * MiB, copies: 6) == 3076 * MiB, "temporary/WAL growth estimate")
        var available = 1024 * MiB
        try LogbookCapacity.require(available: { available }, additional: 128 * MiB); available = 100 * MiB
        try rejects("space falls after preflight") { try LogbookCapacity.require(available: { available }, additional: 128 * MiB) }
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("coc-ios-tests-" + UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let fixture = try logbookObject(String(contentsOfFile: CommandLine.arguments[1], encoding: .utf8))
        var finalCheckFree = 1024 * MiB
        let finalCheck = try LogbookStore(url: root.appendingPathComponent("late-space-check.sqlite"), available: { finalCheckFree })
        _ = try finalCheck.replace(fixture, expected: 0)
        let beforeFinalCheck = try logbookData(finalCheck.fullSnapshot()!)
        try rejects("space exhausted while edit is in flight rolls back final commit") {
            _ = try finalCheck.mutate(expected: 1) { data in
                data["exportedAt"] = "2099-01-01T00:00:00Z"
                finalCheckFree = LogbookCapacity.minimumReserve
            }
        }
        finalCheckFree = 1024 * MiB
        try require(try finalCheck.revision() == 1 && logbookData(finalCheck.fullSnapshot()!) == beforeFinalCheck, "late capacity rejection preserves state bodies and revision")
        try autoreleasepool { try chunkStorageChecks(root: root, fixture: fixture) }
        try backupStreamChecks(root: root, fixture: fixture)
        try searchProjectionChecks(root: root, fixture: fixture)
        try capacityDatabaseChecks(root: root, fixture: fixture)
        try capacityFetchChecks(root: root, fixture: fixture)
        try encodedUploadChecks(root: root, fixture: fixture)
        try tableStreamChecks(root: root, fixture: fixture)
        try tableKernelChecks(root: root)
        let store = try LogbookStore(url: root.appendingPathComponent("db/state.sqlite"))
        try require(try store.metadata() == nil, "fresh database")
        try require(try store.replace(fixture, expected: 0) == 1, "initial restore")
        let initial = try store.fullSnapshot()!, initialBytes = try logbookData(initial)
        let metadata = try store.metadata()!
        try require((metadata["records"] as! [LogbookJSON]).allSatisfy { $0["rawContent"] == nil && $0["manualContent"] == nil }, "body-free overview")
        try require(!(try store.deferredIDs()).isEmpty, "deferred body IDs")
        let records = fixture["records"] as! [LogbookJSON]
        let first = records.first(where: { $0["rawContent"] != nil })!, firstID = first["id"] as! String
        let read = try store.fullSnapshot(selected: [firstID])!
        try require(try logbookData((read["records"] as! [LogbookJSON])[0]["rawContent"]!) == logbookData(first["rawContent"]!), "complete selected body")
        try rejects("missing record") { _ = try store.fullSnapshot(selected: ["missing"]) }
        try rejects("stale restore") { _ = try store.replace(fixture, expected: 0) }
        try require(try logbookData(store.fullSnapshot()!) == initialBytes, "stale request leaves every field")
        try rejects("batch deletion validates every ID") { _ = try store.mutate(expected: 1) { try LogbookMutations.action(["type": "delete-records", "ids": [firstID, "missing"]], data: &$0) } }
        try require(try store.revision() == 1, "failed batch preserves revision")
        var character = (metadata["characters"] as! [LogbookJSON])[0]
        let module = (metadata["modules"] as! [LogbookJSON])[0], moduleID = module["id"] as! String
        character["moduleIds"] = [moduleID]; character["moduleId"] = moduleID
        _ = try store.mutate(expected: 1) { try LogbookMutations.entity(["kind": "character", "value": character], data: &$0) }
        try require(try logbookData((store.metadata()!["modules"] as! [LogbookJSON])[0]["pairs"]!) == logbookData(module["pairs"]!), "character association does not create PC entries")
        var draft = first
        for key in ["rawContent", "cacheSourceUrl", "fetchedAt"] { draft.removeValue(forKey: key) }
        draft["name"] = "iOS 元数据编辑"
        _ = try store.mutate(expected: 2) { try LogbookMutations.entity(["kind": "record", "value": draft], data: &$0) }
        let afterEdit = (try store.fullSnapshot(selected: [firstID])!["records"] as! [LogbookJSON])[0]
        try require(try logbookData(afterEdit["rawContent"]!) == logbookData(first["rawContent"]!), "record edit preserves complete body")
        let manual = records.first(where: { $0["sourceType"] as? String == "manual" })!
        var manualEdit = manual; manualEdit["manualContent"] = "第一行\n第二行\n最后一行完整保留"
        for key in ["rawContent", "cacheSourceUrl", "fetchedAt"] { manualEdit.removeValue(forKey: key) }
        _ = try store.mutate(expected: 3) { try LogbookMutations.entity(["kind": "record", "value": manualEdit], data: &$0) }
        let manualRead = (try store.fullSnapshot(selected: [manual["id"] as! String])!["records"] as! [LogbookJSON])[0]
        try require(manualRead["manualContent"] as? String == manualEdit["manualContent"] as? String, "manual body saved fully")
        let beforeFailure = try logbookData(store.fullSnapshot()!)
        try store.execute("CREATE TRIGGER refuse_state BEFORE UPDATE ON state BEGIN SELECT RAISE(ABORT,'injected'); END")
        try rejects("SQLite failure during full replacement") { _ = try store.replace(fixture, expected: 4) }
        try require(try store.revision() == 4 && logbookData(store.fullSnapshot()!) == beforeFailure, "SQLite rollback restores deleted/inserted bodies and revision")
        try store.execute("DROP TRIGGER refuse_state")
        let sameModule = records.filter { $0["moduleId"] as? String == first["moduleId"] as? String }
        _ = try store.mutate(expected: 4) { try LogbookMutations.action(["type": "reorder", "kind": "record", "id": firstID, "targetId": sameModule.last!["id"]!], data: &$0) }
        try require(try logbookData((store.fullSnapshot(selected: [firstID])!["records"] as! [LogbookJSON])[0]["rawContent"]!) == logbookData(first["rawContent"]!), "sorting preserves body")
        let reopened = try LogbookStore(url: root.appendingPathComponent("db/state.sqlite"))
        try require(try reopened.revision() == 5, "restart revision")
        try require(try logbookData(reopened.fullSnapshot()!) == logbookData(store.fullSnapshot()!), "restart retains complete state")
        let suite = "coc-native-tests-" + UUID().uuidString
        let preferences = UserDefaults(suiteName: suite)!
        defer { preferences.removePersistentDomain(forName: suite) }
        let localDocuments = root.appendingPathComponent("local-documents")
        let archive = try LogbookArchive(directory: root.appendingPathComponent("registry"), preferences: preferences, documentsDirectory: { localDocuments })
        let folder = root.appendingPathComponent("exports")
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        _ = try archive.choose(folder)
        let firstBackup = try archive.write(name: "20261022COC跑团记录簿.json", mime: "application/json", bytes: Data("{}".utf8), purpose: "backup")
        let nextBackup = try archive.write(name: "20261022COC跑团记录簿.zip", mime: "application/zip", bytes: Data("public zip".utf8), purpose: "backup")
        let autoBackup = try archive.write(name: "20261022COC跑团记录簿.json", mime: "application/json", bytes: Data("{\"public\":true}".utf8), purpose: "auto")
        try require(firstBackup["name"] as? String == "20261022COC跑团记录簿.json", "first daily backup has no sequence")
        try require(nextBackup["name"] as? String == "20261022COC跑团记录簿1.zip", "JSON and ZIP share daily sequence from one")
        try require(autoBackup["name"] as? String == "20261022COC跑团记录簿2.json", "automatic backup uses same daily sequence")
        try require(try archive.read(firstBackup["uri"] as! String).0 == Data("{}".utf8), "numbering keeps first backup bytes")
        try require(try LogbookArchive.backupAvailable(["20261022COC跑团记录簿4.zip"], "20261022COC跑团记录簿.json") == "20261022COC跑团记录簿5.json", "numbering continues maximum")
        try require(try LogbookArchive.backupAvailable(["20261022COC跑团记录簿4.zip"], "20261023COC跑团记录簿.json") == "20261023COC跑团记录簿.json", "new local date starts without sequence")
        let original = try archive.write(name: "公开正文.txt", mime: "text/plain", bytes: Data("原正文".utf8), purpose: "export")
        let duplicate = try archive.write(name: "公开正文.txt", mime: "text/plain", bytes: Data("新正文".utf8), purpose: "export")
        try require(duplicate["name"] as? String == "公开正文 (2).txt", "collision numbered")
        try require(try archive.read(original["uri"] as! String).0 == Data("原正文".utf8), "old document retained")
        try rejects("path traversal") { _ = try archive.write(name: "../escape", mime: "text/plain", bytes: Data(), purpose: "export") }
        try Data("用户改动".utf8).write(to: folder.appendingPathComponent("公开正文.txt"))
        try rejects("changed exported document") { _ = try archive.read(original["uri"] as! String) }
        for index in 0..<12 { _ = try archive.write(name: "auto-\(index).json", mime: "application/json", bytes: Data("{}".utf8), purpose: "auto") }
        _ = archive.rotateAutomatic(bookmark: try archive.bookmark())
        try require(try archive.documents(all: true).filter { $0["purpose"] as? String == "auto" }.count == 10, "only ten unchanged automatic backups retained")
        try require(FileManager.default.fileExists(atPath: folder.appendingPathComponent("公开正文.txt").path), "rotation does not delete manual or modified exports")
        let local = try archive.chooseLocalDirectory()
        try require(local["valid"] as? Bool == true, "explicit local folder validates")
        let localFile = try archive.write(name: "保留.txt", mime: "text/plain", bytes: Data("已有完整正文😀".utf8), purpose: "export")
        _ = try archive.chooseLocalDirectory()
        try require(try archive.read(localFile["uri"] as! String).0 == Data("已有完整正文😀".utf8), "reselecting local folder preserves existing exports")
        try require(try archive.read(duplicate["uri"] as! String).0 == Data("新正文".utf8), "external bookmark document still opens after owned selection")
        let previousBookmark = try archive.bookmark()
        var stale = false
        try rejects("owned reference is not a Foundation bookmark") {
            _ = try URL(resolvingBookmarkData: previousBookmark, options: [.withoutUI], relativeTo: nil, bookmarkDataIsStale: &stale)
        }
        let deniedArchive = try LogbookArchive(directory: root.appendingPathComponent("registry"), preferences: preferences, documentsDirectory: {
            throw NSError(domain: NSCocoaErrorDomain, code: 257)
        })
        try rejects("unavailable owned container does not report success") { _ = try deniedArchive.chooseLocalDirectory() }
        try require(try archive.bookmark() == previousBookmark, "permission denial preserves choice")
        let invalidDocuments = root.appendingPathComponent("invalid-documents")
        try FileManager.default.createDirectory(at: invalidDocuments, withIntermediateDirectories: true)
        try Data("原文件".utf8).write(to: invalidDocuments.appendingPathComponent("归档"))
        let invalidArchive = try LogbookArchive(directory: root.appendingPathComponent("registry"), preferences: preferences, documentsDirectory: { invalidDocuments })
        try rejects("local folder name occupied by a file") { _ = try invalidArchive.chooseLocalDirectory() }
        try require(try archive.bookmark() == previousBookmark, "failed local choice preserves previous authorization")
        let reopenedArchive = try LogbookArchive(directory: root.appendingPathComponent("registry"), preferences: preferences, documentsDirectory: { localDocuments })
        try require(reopenedArchive.location()["valid"] as? Bool == true, "owned archive survives restart without resolving a bookmark")
        try require(try reopenedArchive.read(localFile["uri"] as! String).0 == Data("已有完整正文😀".utf8), "owned document reopens with complete bytes")
        // A new container root must be used after relocation; the saved reference has no old path.
        let relocated = root.appendingPathComponent("relocated-documents")
        try FileManager.default.moveItem(at: localDocuments, to: relocated)
        let relocatedArchive = try LogbookArchive(directory: root.appendingPathComponent("registry"), preferences: preferences, documentsDirectory: { relocated })
        try require(try relocatedArchive.read(localFile["uri"] as! String).0 == Data("已有完整正文😀".utf8), "owned reference follows current container rather than old absolute path")
        let linkRoot = root.appendingPathComponent("link-documents")
        try FileManager.default.createDirectory(at: linkRoot, withIntermediateDirectories: true)
        try FileManager.default.createSymbolicLink(at: linkRoot.appendingPathComponent("归档"), withDestinationURL: relocated.appendingPathComponent("归档"))
        let linkArchive = try LogbookArchive(directory: root.appendingPathComponent("registry"), preferences: preferences, documentsDirectory: { linkRoot })
        try rejects("owned archive rejects symbolic link") { _ = try linkArchive.chooseLocalDirectory() }
        try require(try archive.bookmark() == previousBookmark, "symlink failure retains choice")
        do {
            _ = try LogbookArchive.archiveStep("L3：本机目录读写回读") { throw NSError(domain: NSCocoaErrorDomain, code: 257, userInfo: [NSFilePathErrorKey: "/private/secret/path"]) }
        } catch {
            try require(error.localizedDescription.contains("L3") && error.localizedDescription.contains("257") && !error.localizedDescription.contains("/private"), "diagnostic preserves stage and code but excludes private path")
        }
        let tableStore = try LogbookStore(url: root.appendingPathComponent("table-increment.sqlite"))
        _ = try tableStore.replace(fixture, expected: 0)
        let originalBodies = try tableStore.rows("SELECT id,body FROM records ORDER BY position")
        var table = try tableStore.metadata()!
        var tableRows = table["records"] as! [LogbookJSON]
        var appended = tableRows[0]; appended["id"] = "public-table-added"; appended["name"] = "public added"
        tableRows.append(appended); table["records"] = tableRows
        let tableTiming = LogbookTableTiming()
        _ = try tableStore.mutate(expected: 1, timing: tableTiming) { try LogbookMutations.table(table, data: &$0) }
        let measured = tableTiming.result()
        let phases = measured["phasesMs"] as! [String: Double]
        try require(Set(measured.keys) == Set(["clock", "totalMs", "phasesMs"]) && measured["clock"] as? String == "native-monotonic" && Set(phases.keys) == Set(["transactionBegin", "transactionCAS", "metadataRead", "tableRules", "mergedValidation", "recordCompareAndWrite", "capacity", "transactionEnd"]) && phases.values.allSatisfy { $0.isFinite && $0 >= 0 } && measured["totalMs"] as! Double >= phases.values.reduce(0, +), "opt-in table timing contains only non-overlapping monotonic durations")
        try require(try tableStore.rows("SELECT id,body FROM records WHERE id<>'public-table-added' ORDER BY position") == originalBodies, "table append preserves exact stored body strings")
        try rejects("table CAS") { _ = try tableStore.mutate(expected: 1, timing: LogbookTableTiming()) { try LogbookMutations.table(table, data: &$0) } }
        var deletedTable = table; deletedTable["records"] = Array(tableRows.dropFirst())
        try rejects("table deletion") { _ = try tableStore.mutate(expected: 2) { try LogbookMutations.table(deletedTable, data: &$0) } }
        var changedTable = table, changedRows = tableRows; changedRows[0]["link"] = "https://log.weizaima.com/?key=changed"; changedTable["records"] = changedRows
        try rejects("table source mutation") { _ = try tableStore.mutate(expected: 2) { try LogbookMutations.table(changedTable, data: &$0) } }
        let beforeTableFailure = try logbookData(tableStore.fullSnapshot()!)
        try tableStore.execute("CREATE TRIGGER refuse_table BEFORE UPDATE ON state BEGIN SELECT RAISE(ABORT,'injected'); END")
        try rejects("table SQL rollback") { _ = try tableStore.mutate(expected: 2, timing: LogbookTableTiming()) { try LogbookMutations.table(table, data: &$0) } }
        try require(try tableStore.revision() == 2 && logbookData(tableStore.fullSnapshot()!) == beforeTableFailure, "table failure preserves revision and every body")
        try tableStore.execute("DROP TRIGGER refuse_table")
        var manualTable = try tableStore.metadata()!, manualRows = manualTable["records"] as! [LogbookJSON]
        let manualIndex = manualRows.firstIndex(where: { $0["sourceType"] as? String == "manual" })!
        manualRows[manualIndex]["manualContent"] = "public manual\n\n中文😀"; manualRows[manualIndex]["updatedAt"] = logbookNow(); manualTable["records"] = manualRows
        _ = try tableStore.mutate(expected: 2) { try LogbookMutations.table(manualTable, data: &$0) }
        try require((try tableStore.fullSnapshot(selected: [manualRows[manualIndex]["id"] as! String])!["records"] as! [LogbookJSON])[0]["manualContent"] as? String == "public manual\n\n中文😀", "table updates only explicit manual text")
        // Delta has its own native validation, fresh-store semantics and atomic failure checks.
        let deltaStore = try LogbookStore(url: root.appendingPathComponent("table-delta.sqlite"))
        _ = try deltaStore.replace(fixture, expected: 0)
        let deltaBefore = try deltaStore.metadata()!
        let deltaBodies = try deltaStore.rows("SELECT id,body FROM records ORDER BY position")
        var delta: LogbookJSON = ["protocolVersion": 1, "initialSettings": deltaBefore["settings"]!, "modulesAdded": [LogbookJSON](), "moduleParticipants": [LogbookJSON](), "charactersAdded": [LogbookJSON](), "recordsAdded": [appended], "manualUpdates": [LogbookJSON]()]
        var equivalent = deltaBefore
        try LogbookMutations.table(table, data: &equivalent)
        _ = try deltaStore.importTableDelta(delta, expected: 1)
        var actual = try deltaStore.metadata()!; actual["exportedAt"] = equivalent["exportedAt"]
        try require(try logbookData(actual) == logbookData(equivalent), "delta equals full table metadata and order")
        try require(try deltaStore.rows("SELECT id,body FROM records WHERE id<>'public-table-added' ORDER BY position") == deltaBodies, "delta preserves exact native body strings")
        let stableDelta = try logbookData(deltaStore.fullSnapshot()!)
        try rejects("delta stale CAS") { _ = try deltaStore.importTableDelta(delta, expected: 1) }
        try rejects("delta duplicate addition") { _ = try deltaStore.importTableDelta(delta, expected: 2) }
        delta["recordsAdded"] = [LogbookJSON]()
        var invalid = delta; invalid["delete"] = []
        try rejects("delta unknown operation") { _ = try deltaStore.importTableDelta(invalid, expected: 2) }
        invalid = delta; invalid["protocolVersion"] = true
        try rejects("delta boolean version") { _ = try deltaStore.importTableDelta(invalid, expected: 2) }
        invalid = delta; var missing = appended; missing["id"] = "missing-link"; missing["moduleId"] = "absent"; invalid["recordsAdded"] = [missing]
        try rejects("delta complete graph validation") { _ = try deltaStore.importTableDelta(invalid, expected: 2) }
        invalid = delta; var foreign = (deltaBefore["records"] as! [LogbookJSON])[0]; foreign["manualContent"] = "bad"; invalid["manualUpdates"] = [foreign]
        try rejects("delta online body overwrite") { _ = try deltaStore.importTableDelta(invalid, expected: 2) }
        invalid = delta; var altered = manualRows[manualIndex]; altered["moduleId"] = "absent"; invalid["manualUpdates"] = [altered]
        try rejects("delta non import field") { _ = try deltaStore.importTableDelta(invalid, expected: 2) }
        invalid = delta; invalid["manualUpdates"] = [manualRows[manualIndex], manualRows[manualIndex]]
        try rejects("delta repeated manual update") { _ = try deltaStore.importTableDelta(invalid, expected: 2) }
        try rejects("delta directory authorization") { _ = try deltaStore.importTableDelta(delta, expected: 2) { throw LogbookFailure("injected authorization") } }
        try require(try deltaStore.revision() == 2 && logbookData(deltaStore.fullSnapshot()!) == stableDelta, "all rejected deltas retain complete prior state")
        delta["manualUpdates"] = [manualRows[manualIndex]]
        try deltaStore.execute("CREATE TRIGGER fail_delta BEFORE UPDATE ON state BEGIN SELECT RAISE(ABORT,'injected'); END")
        try rejects("delta SQL rollback after manual write") { _ = try deltaStore.importTableDelta(delta, expected: 2) }
        try deltaStore.execute("DROP TRIGGER fail_delta")
        try require(try deltaStore.revision() == 2 && logbookData(deltaStore.fullSnapshot()!) == stableDelta, "delta rollback restores metadata and body")
        // Large single-record success/rollback is covered by chunkStorageChecks.
        var nulManual = manualRows[manualIndex]; nulManual["manualContent"] = "public manual\n\n中文😀\0tail"
        delta["manualUpdates"] = [nulManual]
        _ = try deltaStore.importTableDelta(delta, expected: 2)
        let reopenedDelta = try LogbookStore(url: root.appendingPathComponent("table-delta.sqlite"))
        try require(try reopenedDelta.revision() == 3 && (reopenedDelta.fullSnapshot(selected: [manualRows[manualIndex]["id"] as! String])!["records"] as! [LogbookJSON])[0]["manualContent"] as? String == "public manual\n\n中文😀\0tail", "delta manual NUL, Unicode and blank lines survive reopening")
        let freshDelta = try LogbookStore(url: root.appendingPathComponent("table-delta-fresh.sqlite"))
        var initialDelta = delta; initialDelta["manualUpdates"] = [LogbookJSON](); initialDelta["modulesAdded"] = deltaBefore["modules"]; initialDelta["charactersAdded"] = deltaBefore["characters"]; initialDelta["recordsAdded"] = deltaBefore["records"]
        _ = try freshDelta.importTableDelta(initialDelta, expected: 0)
        try require(try logbookData(freshDelta.metadata()!["settings"]!) == logbookData(deltaBefore["settings"]!), "fresh native store accepts validated initial settings")
        try IOSScaleChecks.run(root: root, fixture: fixture)
        print("iOS native core: \(checks) checks passed; macOS test folders only, no phone or system picker tested.")
    }
}
