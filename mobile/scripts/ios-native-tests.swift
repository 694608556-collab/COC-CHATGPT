import Foundation

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
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("coc-ios-tests-" + UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let fixture = try logbookObject(String(contentsOfFile: CommandLine.arguments[1], encoding: .utf8))
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
        var oversized = delta, largeManual = manualRows[manualIndex]; largeManual["manualContent"] = String(repeating: "x", count: logbookMaximumBytes)
        oversized["manualUpdates"] = [largeManual]
        try rejects("delta whole library capacity rollback") { _ = try deltaStore.importTableDelta(oversized, expected: 2) }
        try require(try deltaStore.revision() == 2 && logbookData(deltaStore.fullSnapshot()!) == stableDelta, "capacity rejection retains all data")
        _ = try deltaStore.importTableDelta(delta, expected: 2)
        let reopenedDelta = try LogbookStore(url: root.appendingPathComponent("table-delta.sqlite"))
        try require(try reopenedDelta.revision() == 3 && (reopenedDelta.fullSnapshot(selected: [manualRows[manualIndex]["id"] as! String])!["records"] as! [LogbookJSON])[0]["manualContent"] as? String == "public manual\n\n中文😀", "delta manual Unicode and blank lines survive reopening")
        let freshDelta = try LogbookStore(url: root.appendingPathComponent("table-delta-fresh.sqlite"))
        var first = delta; first["manualUpdates"] = [LogbookJSON](); first["modulesAdded"] = deltaBefore["modules"]; first["charactersAdded"] = deltaBefore["characters"]; first["recordsAdded"] = deltaBefore["records"]
        _ = try freshDelta.importTableDelta(first, expected: 0)
        try require(try logbookData(freshDelta.metadata()!["settings"]!) == logbookData(deltaBefore["settings"]!), "fresh native store accepts validated initial settings")
        try IOSScaleChecks.run(root: root, fixture: fixture)
        print("iOS native core: \(checks) checks passed; macOS test folders only, no phone or system picker tested.")
    }
}
