import Foundation
import SQLite3
import CryptoKit

/// Opt-in diagnostics only. Fixed phase names and durations never contain snapshot values or paths.
final class LogbookTableTiming {
    private let started: TimeInterval
    private var previous: TimeInterval
    private var phases: [String: Double] = [:]
    init() { let now = ProcessInfo.processInfo.systemUptime; started = now; previous = now }
    func mark(_ phase: String) {
        let now = ProcessInfo.processInfo.systemUptime
        phases[phase] = (phases[phase] ?? 0) + (now - previous) * 1000
        previous = now
    }
    func result() -> LogbookJSON {
        ["clock": "native-monotonic", "totalMs": (ProcessInfo.processInfo.systemUptime - started) * 1000, "phasesMs": phases]
    }
}
typealias LogbookJSON = [String: Any]
struct LogbookFailure: LocalizedError {
    let message: String
    init(_ message: String) { self.message = message }
    var errorDescription: String? { message }
}
/// Independent native budgets. Keep current values/accounting until streaming
/// backup and restore plus device scale/rollback validation are complete.
enum LogbookLimits {
    static let deviceSpaceLibrary = true
    static let libraryBytes = 64 * 1024 * 1024
    static let snapshotRequestBytes = 64 * 1024 * 1024
    static let snapshotUploadBytes = 64 * 1024 * 1024
    static let entityRequestBytes = 64 * 1024 * 1024
    static let tableRequestBytes = 64 * 1024 * 1024
    static let backupFileBytes = 64 * 1024 * 1024
    static let batchStagingBytes = 64 * 1024 * 1024
    static let recordResponseBytes = 64 * 1024 * 1024
    static let pickedFileBytes = 64 * 1024 * 1024
    static let archiveFileBytes = 64 * 1024 * 1024
    static let attachmentTotalBytes = 128 * 1024 * 1024
    static let transferChunkBytes = 256 * 1024
    static let encodedChunkBytes = 349528
}
/// Native-owned available-volume policy. Callers retain actual I/O/transaction
/// rollback and recheck after staging; this query is not a disk reservation.
enum LogbookCapacity {
    static let minimumReserve = 64 * 1024 * 1024
    static func remaining(_ available: Int) throws -> Int {
        guard available > 0 else { throw LogbookFailure("无法确认本机可用空间；未写入数据。") }
        return max(0, available - max(minimumReserve, available / 20))
    }
    static func available(_ directory: URL) throws -> Int {
        let values = try directory.resourceValues(forKeys: [.isDirectoryKey, .volumeAvailableCapacityKey, .volumeAvailableCapacityForImportantUsageKey])
        guard values.isDirectory == true, let free = values.volumeAvailableCapacity, free > 0 else {
            throw LogbookFailure("无法确认保存卷可用空间；未写入数据。")
        }
        if let important = values.volumeAvailableCapacityForImportantUsage {
            guard important > 0 else { throw LogbookFailure("保存卷可用空间不足或无法确认。") }
            return min(free, Int(clamping: important))
        }
        return free
    }
    static func maximum(available: () throws -> Int, copies: Int) throws -> Int {
        guard copies > 0 else { throw LogbookFailure("空间估算参数无效。") }
        let maximum = min(9007199254740991, try remaining(available()) / copies)
        guard maximum > 0 else { throw LogbookFailure("本机可用空间不足，请释放空间后重试；原数据保留。") }
        return maximum
    }
    static func require(available: () throws -> Int, additional: Int) throws {
        guard additional >= 0, additional <= (try remaining(available())) else {
            throw LogbookFailure("本机可用空间不足，操作未完成；原数据保留。")
        }
    }
    static func estimate(_ bytes: Int, copies: Int) throws -> Int {
        guard bytes >= 0, copies > 0 else { throw LogbookFailure("空间估算参数无效。") }
        let multiplied = bytes.multipliedReportingOverflow(by: copies)
        let result = multiplied.partialValue.addingReportingOverflow(4 * 1024 * 1024)
        guard !multiplied.overflow, !result.overflow else { throw LogbookFailure("空间需求超出系统计量范围。") }
        return result.partialValue
    }
}
func logbookData(_ object: Any) throws -> Data {
    guard JSONSerialization.isValidJSONObject(object) else { throw LogbookFailure("数据格式不合法。") }
    return try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys, .withoutEscapingSlashes])
}
func logbookObject(_ text: String) throws -> LogbookJSON {
    guard let object = try JSONSerialization.jsonObject(with: Data(text.utf8)) as? LogbookJSON else { throw LogbookFailure("数据结构不合法。") }
    return object
}
func logbookText(_ object: Any) throws -> String { String(decoding: try logbookData(object), as: UTF8.self) }
func logbookNow() -> String { ISO8601DateFormatter().string(from: Date()) }

/// iOS-owned database. Bodies occupy separate columns and never enter metadata-only mutations.
/// All calls are serialized by the plugin's storage queue; automatic-backup file I/O runs elsewhere.
final class LogbookStore {
    private var handle: OpaquePointer?
    private let url: URL
    let deviceSpace: Bool
    let available: () throws -> Int
    private let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
    init(url: URL, deviceSpace: Bool = LogbookLimits.deviceSpaceLibrary, available: (() throws -> Int)? = nil) throws {
        self.url = url; self.deviceSpace = deviceSpace
        self.available = available ?? { try LogbookCapacity.available(url.deletingLastPathComponent()) }
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        guard sqlite3_open_v2(url.path, &handle, SQLITE_OPEN_CREATE | SQLITE_OPEN_READWRITE | SQLITE_OPEN_FULLMUTEX, nil) == SQLITE_OK else { throw LogbookFailure("本机数据库无法打开；未重置数据。") }
        do {
            sqlite3_busy_timeout(handle, 5000)
            try execute("PRAGMA journal_mode=WAL")
            try execute("PRAGMA synchronous=FULL")
            let version = Int(try rows("PRAGMA user_version").first?.first ?? "0") ?? -1
            guard [0, 1, 2].contains(version) else { throw LogbookFailure("iOS 数据库版本不兼容；未清空数据。") }
            try execute("CREATE TABLE IF NOT EXISTS state(id INTEGER PRIMARY KEY CHECK(id=1),json TEXT,revision INTEGER NOT NULL)")
            try execute("INSERT OR IGNORE INTO state VALUES(1,NULL,0)")
            try execute("CREATE TABLE IF NOT EXISTS records(id TEXT PRIMARY KEY,position INTEGER NOT NULL,metadata TEXT NOT NULL,body TEXT NOT NULL)")
            // v2 keeps every original v1 body column byte-for-byte and adds a
            // transactional size ledger. Metadata edits never rescan old bodies.
            try execute("BEGIN IMMEDIATE")
            do {
                if deviceSpace, version < 2 { try LogbookCapacity.require(available: self.available, additional: 4 * 1024 * 1024) }
                try execute("CREATE TABLE IF NOT EXISTS record_sizes(id TEXT PRIMARY KEY,metadata_bytes INTEGER NOT NULL CHECK(metadata_bytes>=0),body_bytes INTEGER NOT NULL CHECK(body_bytes>=0))")
                try execute("CREATE TRIGGER IF NOT EXISTS record_size_insert AFTER INSERT ON records BEGIN INSERT OR REPLACE INTO record_sizes VALUES(NEW.id,length(CAST(NEW.metadata AS BLOB)),length(CAST(NEW.body AS BLOB))); END")
                try execute("CREATE TRIGGER IF NOT EXISTS record_size_metadata AFTER UPDATE OF metadata ON records BEGIN UPDATE record_sizes SET metadata_bytes=length(CAST(NEW.metadata AS BLOB)) WHERE id=NEW.id; END")
                try execute("CREATE TRIGGER IF NOT EXISTS record_size_body AFTER UPDATE OF body ON records BEGIN UPDATE record_sizes SET body_bytes=length(CAST(NEW.body AS BLOB)) WHERE id=NEW.id; END")
                try execute("CREATE TRIGGER IF NOT EXISTS record_size_delete AFTER DELETE ON records BEGIN DELETE FROM record_sizes WHERE id=OLD.id; END")
                try execute("CREATE TRIGGER IF NOT EXISTS record_size_id AFTER UPDATE OF id ON records BEGIN UPDATE record_sizes SET id=NEW.id WHERE id=OLD.id; END")
                if version < 2 {
                    try execute("DELETE FROM record_sizes")
                    try execute("INSERT INTO record_sizes SELECT id,length(CAST(metadata AS BLOB)),length(CAST(body AS BLOB)) FROM records")
                }
                guard try scalar("SELECT COUNT(*) FROM records") == scalar("SELECT COUNT(*) FROM record_sizes"),
                      try scalar("SELECT COUNT(*) FROM records r LEFT JOIN record_sizes s ON s.id=r.id WHERE s.id IS NULL") == 0 else { throw LogbookFailure("正文计量索引不完整；原数据未重置。") }
                try execute("PRAGMA user_version=2"); try execute("COMMIT")
            } catch { try? execute("ROLLBACK"); throw error }
        } catch { sqlite3_close(handle); handle = nil; throw error }
    }
    deinit { sqlite3_close(handle) }
    private func prepare(_ sql: String, _ values: [String] = []) throws -> OpaquePointer {
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(handle, sql, -1, &statement, nil) == SQLITE_OK, let statement else { throw LogbookFailure("本机数据库语句失败。") }
        for (index, value) in values.enumerated() {
            let bytes = value.utf8.count
            guard bytes <= Int(Int32.max), sqlite3_bind_text(statement, Int32(index + 1), value, Int32(bytes), transient) == SQLITE_OK else { sqlite3_finalize(statement); throw LogbookFailure("本机数据库参数失败。") }
        }
        return statement
    }
    func execute(_ sql: String, _ values: [String] = []) throws {
        let statement = try prepare(sql, values); defer { sqlite3_finalize(statement) }
        var status = sqlite3_step(statement)
        while status == SQLITE_ROW { status = sqlite3_step(statement) }
        guard status == SQLITE_DONE else { throw LogbookFailure("本机数据库写入失败；事务未提交。") }
    }
    func rows(_ sql: String, _ values: [String] = []) throws -> [[String]] {
        let statement = try prepare(sql, values); defer { sqlite3_finalize(statement) }
        var result: [[String]] = []
        var status = sqlite3_step(statement)
        while status == SQLITE_ROW {
            result.append(try (0..<sqlite3_column_count(statement)).map { index in
                if sqlite3_column_type(statement, index) == SQLITE_NULL { return "" }
                guard let value = sqlite3_column_text(statement, index),
                      let text = String(bytes: UnsafeBufferPointer(start: value, count: Int(sqlite3_column_bytes(statement, index))), encoding: .utf8) else { throw LogbookFailure("本机文本读取失败或UTF-8损坏；未重置数据。") }
                return text
            })
            status = sqlite3_step(statement)
        }
        guard status == SQLITE_DONE else { throw LogbookFailure("本机数据库读取失败；未重置数据。") }
        return result
    }
    func revision() throws -> Int {
        guard let value = try rows("SELECT revision FROM state WHERE id=1").first?.first, let revision = Int(value) else { throw LogbookFailure("本机数据版本缺失。") }
        return revision
    }
    private func scalar(_ sql: String, _ values: [String] = []) throws -> Int {
        guard let text = try rows(sql, values).first?.first, let value = Int(text), value >= 0 else { throw LogbookFailure("本机数据计量失败；未重置数据。") }
        return value
    }
    func logicalBytes() throws -> Int {
        try scalar("SELECT COALESCE(SUM(metadata_bytes+body_bytes),0) FROM record_sizes") + scalar("SELECT COALESCE(length(CAST(json AS BLOB)),0) FROM state WHERE id=1")
    }
    func storageUsage() throws -> LogbookJSON {
        var physical = 0
        for suffix in ["", "-wal", "-shm"] { physical += (try? URL(fileURLWithPath: url.path + suffix).resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0 }
        var result: LogbookJSON = ["logicalBytes": try logicalBytes(), "databaseBytes": physical]
        if let free = try? available() { result["availableBytes"] = free }
        return result
    }
    private func metadataBytes() throws -> Int {
        let records = try scalar("SELECT COUNT(*) FROM record_sizes")
        return try scalar("SELECT COALESCE(SUM(metadata_bytes),0) FROM record_sizes") + scalar("SELECT COALESCE(length(CAST(json AS BLOB)),0) FROM state WHERE id=1") + 13 + max(0, records - 1)
    }
    func check(_ expected: Int) throws {
        guard try revision() == expected else { throw LogbookFailure("数据已变化，请重新读取／预览。") }
    }
    static func empty() -> LogbookJSON {
        let keys = ["hideDiceCommands", "hideImages", "hideOffTopic", "hideTime", "hidePlatformAccount", "hideYearMonthDay", "indentFirstLine", "darkDisplay"]
        return ["schemaVersion": 2, "exportedAt": logbookNow(), "modules": [LogbookJSON](), "records": [LogbookJSON](), "characters": [LogbookJSON](), "settings": ["theme": "light", "filterPreset": Dictionary(uniqueKeysWithValues: keys.map { ($0, $0 == "hidePlatformAccount" || $0 == "hideYearMonthDay") })]]
    }
    func metadata() throws -> LogbookJSON? {
        guard let text = try rows("SELECT json FROM state WHERE id=1").first?.first else { throw LogbookFailure("本机数据状态缺失。") }
        if text.isEmpty { return nil }
        guard try metadataBytes() <= LogbookLimits.snapshotRequestBytes else { throw LogbookFailure("整库元数据超过独立处理上限。") }
        var data = try logbookObject(text)
        data["records"] = try rows("SELECT metadata FROM records ORDER BY position").map { try logbookObject($0[0]) }
        try LogbookValidation.snapshot(data, metadataOnly: true)
        return data
    }
    func deferredIDs() throws -> [String] { try rows("SELECT id FROM records WHERE body<>'{}' ORDER BY position").map { $0[0] } }
    /// Captures one exact revision as a private file; only one existing body row is copied at once.
    func backupFile(expected: Int, directory: URL) throws -> URL {
        let url = directory.appendingPathComponent(UUID().uuidString + ".backup")
        let maximum = deviceSpace ? try LogbookCapacity.maximum(available: { try LogbookCapacity.available(directory) }, copies: 2) : LogbookLimits.backupFileBytes
        try Data().write(to: url, options: [.withoutOverwriting])
        do {
            let output = try FileHandle(forWritingTo: url); defer { try? output.close() }
            try writeBackup(expected: expected, maximumBytes: maximum) { chunk in
                if self.deviceSpace { try LogbookCapacity.require(available: { try LogbookCapacity.available(directory) }, additional: chunk.count) }
                try output.write(contentsOf: chunk)
            }
            try output.synchronize()
            return url
        } catch { try? FileManager.default.removeItem(at: url); throw error }
    }
    /// Canonical envelope v1, fully validated without reserializing body tokens.
    /// The trusted native caller chooses the operation budget, never JavaScript.
    func writeBackup(expected: Int, maximumBytes: Int, selected: [String]? = nil, sink: (Data) throws -> Void) throws {
        try check(expected)
        var root = try metadata() ?? Self.empty()
        let allRecords = root.removeValue(forKey: "records") as! [LogbookJSON]
        let wanted = selected.map { Set($0) }
        let records = allRecords.filter { wanted == nil || wanted!.contains($0["id"] as! String) }
        if let selected { guard !selected.isEmpty, selected.count <= 50000, wanted!.count == selected.count, records.count == selected.count else { throw LogbookFailure("搜索场次缺失、重复或无效。") } }
        let maximum = deviceSpace ? maximumBytes : min(maximumBytes, LogbookLimits.backupFileBytes)
        guard maximum > 0 else { throw LogbookFailure("备份空间预算无效。") }
        var total = 0
        func write(_ text: String) throws {
            let bytes = Data(text.utf8)
            guard bytes.count <= maximum - total else { throw LogbookFailure("完整备份超过本次可用空间预算。") }
            for start in stride(from: 0, to: bytes.count, by: 65536) { try sink(bytes.subdata(in: start..<min(start + 65536, bytes.count))) }
            total += bytes.count
        }
        try write("{\"format\":\"coc.logbook.android\",\"formatVersion\":1,\"exportedAt\":" + String(try logbookText([logbookNow()]).dropFirst().dropLast()) + ",\"restoreScope\":[\"modules\",\"records\",\"characters\"],\"snapshot\":")
        try write(String(try logbookText(root).dropLast()) + ",\"records\":[")
        let statement: OpaquePointer
        if let selected { statement = try prepare("SELECT metadata,body FROM records WHERE id IN (SELECT value FROM json_each(?)) ORDER BY position", [try logbookText(selected)]) }
        else { statement = try prepare("SELECT metadata,body FROM records ORDER BY position") }
        defer { sqlite3_finalize(statement) }
        var status = sqlite3_step(statement), count = 0
        while status == SQLITE_ROW {
            try autoreleasepool {
                guard let metadata = sqlite3_column_text(statement, 0), let body = sqlite3_column_text(statement, 1), count < records.count else { throw LogbookFailure("场次正文读取失败或数量已变化。") }
                guard let head = String(bytes: UnsafeBufferPointer(start: metadata, count: Int(sqlite3_column_bytes(statement, 0))), encoding: .utf8),
                      let tail = String(bytes: UnsafeBufferPointer(start: body, count: Int(sqlite3_column_bytes(statement, 1))), encoding: .utf8) else { throw LogbookFailure("正文UTF-8损坏；未省略数据。") }
                guard head.hasSuffix("}"), tail.hasPrefix("{"), tail.hasSuffix("}") else { throw LogbookFailure("本机正文格式异常。") }
                let text = tail == "{}" ? head : String(head.dropLast()) + "," + String(tail.dropFirst())
                guard text.utf8.count <= LogbookLimits.entityRequestBytes else { throw LogbookFailure("单场完整raw/manual合计超过64MiB。") }
                let value = try LogbookBackupJSON.object(Data(text.utf8)); try LogbookValidation.record(value)
                var row = value; row.removeValue(forKey: "rawContent"); row.removeValue(forKey: "manualContent")
                guard try logbookData(row) == logbookData(records[count]) else { throw LogbookFailure("备份场次次序或元数据已变化。") }
                try write((count == 0 ? "" : ",") + text); count += 1
            }
            status = sqlite3_step(statement)
        }
        guard status == SQLITE_DONE, count == records.count else { throw LogbookFailure("完整备份场次未取齐。") }
        try write("]}}"); try check(expected)
    }
    func projectedBytes(_ selected: [String]?) throws -> Int {
        var bytes = try scalar("SELECT COALESCE(length(CAST(json AS BLOB)),0) FROM state WHERE id=1") + 13, count = 0
        let groups: [[String]] = selected.map { ids in stride(from: 0, to: ids.count, by: 400).map { Array(ids[$0..<min($0 + 400, ids.count)]) } } ?? [[]]
        for group in groups {
            let filter = selected == nil ? "" : " WHERE id IN (" + Array(repeating: "?", count: group.count).joined(separator: ",") + ")"
            count += try scalar("SELECT COUNT(*) FROM record_sizes" + filter, group)
            bytes += try scalar("SELECT COALESCE(SUM(metadata_bytes+body_bytes-CASE WHEN body_bytes=2 THEN 2 ELSE 1 END),0) FROM record_sizes" + filter, group)
        }
        if let selected, count != selected.count { throw LogbookFailure("所选场次已变化。") }
        return bytes + max(0, count - 1)
    }
    func fullSnapshot(selected: [String]? = nil) throws -> LogbookJSON? {
        guard try projectedBytes(selected) <= LogbookLimits.snapshotRequestBytes else { throw LogbookFailure("所选完整正文超过单次内存读取预算，请减少场次或使用完整分块备份。") }
        guard var data = try metadata() else { return nil }
        var result: [LogbookJSON] = []
        let groups: [[String]] = selected.map { ids in stride(from: 0, to: ids.count, by: 400).map { Array(ids[$0..<min($0 + 400, ids.count)]) } } ?? [[]]
        for group in groups {
            let filter = selected == nil ? "" : " WHERE id IN (" + Array(repeating: "?", count: group.count).joined(separator: ",") + ")"
            for row in try rows("SELECT metadata,body FROM records" + filter + " ORDER BY position", group) {
                var value = try logbookObject(row[0]); value.merge(try logbookObject(row[1])) { _, body in body }; result.append(value)
            }
        }
        if let selected, Set(result.compactMap { $0["id"] as? String }) != Set(selected) { throw LogbookFailure("场次已变化，请重新读取。") }
        data["records"] = result
        return data
    }
    private func writeRecord(_ value: LogbookJSON, position: Int) throws {
        guard let id = value["id"] as? String else { throw LogbookFailure("场次标识缺失。") }
        var metadata = value; var body: LogbookJSON = [:]
        for key in ["rawContent", "manualContent"] { if let content = metadata.removeValue(forKey: key) { body[key] = content } }
        try upsertRecord(id: id, metadata: logbookText(metadata), body: logbookText(body), position: position)
    }
    private func upsertRecord(id: String, metadata: String, body: String, position: Int) throws {
        let bytes = metadata.utf8.count + body.utf8.count - (body == "{}" ? 2 : 1)
        guard bytes <= LogbookLimits.entityRequestBytes else { throw LogbookFailure("单场完整raw/manual合计超过64MiB；原数据保留。") }
        if deviceSpace { try LogbookCapacity.require(available: available, additional: LogbookCapacity.estimate(bytes, copies: 4)) }
        try execute("INSERT OR REPLACE INTO records VALUES(?,?,?,?)", [id, String(position), metadata, body])
    }
    private func writeRawRecord(_ value: LogbookJSON, json: Data, position: Int) throws {
        guard let id = value["id"] as? String else { throw LogbookFailure("场次标识缺失。") }
        var metadata = value; metadata.removeValue(forKey: "rawContent"); metadata.removeValue(forKey: "manualContent")
        try upsertRecord(id: id, metadata: logbookText(metadata), body: LogbookBackupJSON.body(json), position: position)
    }
    /// Only the explicit manual member is replaced. SQLite preserves untouched
    /// raw JSON numeric tokens; no old body enters Foundation for metadata edits.
    private func writeManual(_ value: LogbookJSON, position: Int? = nil) throws {
        guard let id = value["id"] as? String, let manual = value["manualContent"] as? String, value["rawContent"] == nil else { throw LogbookFailure("手动差量字段无效。") }
        var metadata = value; metadata.removeValue(forKey: "manualContent")
        let head = try logbookText(metadata), patch = try logbookText(["manualContent": manual])
        let retained = try scalar("SELECT length(CAST(json_remove(body,'$.manualContent') AS BLOB)) FROM records WHERE id=?", [id])
        let combinedBody = retained == 2 ? patch.utf8.count : retained + patch.utf8.count - 1
        let bytes = head.utf8.count + combinedBody - 1
        guard bytes <= LogbookLimits.entityRequestBytes else { throw LogbookFailure("单场完整raw/manual合计超过64MiB；原数据保留。") }
        if deviceSpace { try LogbookCapacity.require(available: available, additional: LogbookCapacity.estimate(bytes, copies: 4)) }
        if let position { try execute("UPDATE records SET metadata=?,body=json_patch(body,?),position=? WHERE id=?", [head, patch, String(position), id]) }
        else { try execute("UPDATE records SET metadata=?,body=json_patch(body,?) WHERE id=?", [head, patch, id]) }
    }
    private func saveRoot(_ value: LogbookJSON, revision: Int) throws {
        var root = value; root.removeValue(forKey: "records")
        try execute("UPDATE state SET json=?,revision=? WHERE id=1", [try logbookText(root), String(revision)])
    }
    private func transaction(_ expected: Int, timing: LogbookTableTiming? = nil, _ action: () throws -> Void) throws -> Int {
        if deviceSpace { try LogbookCapacity.require(available: available, additional: LogbookCapacity.estimate(metadataBytes(), copies: 4)) }
        let wal = URL(fileURLWithPath: url.path + "-wal")
        let walBefore = (try? wal.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
        try execute("BEGIN IMMEDIATE")
        timing?.mark("transactionBegin")
        do {
            try check(expected); timing?.mark("transactionCAS"); try action()
            if deviceSpace {
                guard try metadataBytes() <= LogbookLimits.snapshotRequestBytes,
                      try scalar("SELECT COALESCE(MAX(metadata_bytes+body_bytes-CASE WHEN body_bytes=2 THEN 2 ELSE 1 END),0) FROM record_sizes") <= LogbookLimits.entityRequestBytes else { throw LogbookFailure("单场完整正文或整库元数据超过独立处理上限。") }
                try LogbookCapacity.require(available: available, additional: 0)
            } else { guard try logicalBytes() <= LogbookLimits.libraryBytes else { throw LogbookFailure("数据超过 64 MB 上限。") } }
            timing?.mark("capacity")
            try execute("COMMIT"); timing?.mark("transactionEnd"); return expected + 1
        } catch {
            try? execute("ROLLBACK")
            let walAfter = (try? wal.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
            if deviceSpace, walAfter > walBefore { _ = sqlite3_wal_checkpoint_v2(handle, nil, SQLITE_CHECKPOINT_TRUNCATE, nil, nil) }
            throw error
        }
    }
    func replace(_ data: LogbookJSON, expected: Int) throws -> Int {
        try LogbookValidation.snapshot(data)
        guard try logbookData(data).count <= LogbookLimits.snapshotRequestBytes else { throw LogbookFailure("数据超过 64 MB 上限。") }
        return try transaction(expected) {
            try execute("DELETE FROM records")
            for (index, value) in (data["records"] as! [LogbookJSON]).enumerated() { try writeRecord(value, position: index) }
            try saveRoot(data, revision: expected + 1)
        }
    }
    func restoreCandidate(_ input: FileHandle, preview: LogbookRestoreCandidate.Preview, expected: Int, restoreSettings: Bool,
                          authorize: () throws -> Void) throws -> Int {
        try LogbookValidation.snapshot(preview.metadata, metadataOnly: true)
        return try transaction(expected) {
            try authorize()
            var root = preview.metadata
            if !restoreSettings { root["settings"] = (try metadata() ?? Self.empty())["settings"] }
            try execute("DELETE FROM records")
            let actual = try LogbookRestoreCandidate.inspect(input, proof: preview.proof, rawEach: { value, json, index in
                try self.writeRawRecord(value, json: json, position: index)
            })
            guard try logbookData(actual.metadata) == logbookData(preview.metadata) else { throw LogbookFailure("恢复候选元数据已变化。") }
            try saveRoot(root, revision: expected + 1); try authorize()
        }
    }
    /// Delta writes skip comparison/serialization of untouched records; all graph and capacity checks remain.
    func importTableDelta(_ delta: LogbookJSON, expected: Int, timing: LogbookTableTiming? = nil, authorize: () throws -> Void = {}) throws -> (Int, String) {
        let now = logbookNow()
        let revision = try transaction(expected, timing: timing) {
            try authorize()
            let stored = try metadata()
            var data = stored ?? Self.empty()
            let oldCount = (data["records"] as! [LogbookJSON]).count
            timing?.mark("metadataRead")
            let touched = try LogbookMutations.tableDelta(delta, data: &data, fresh: stored == nil)
            timing?.mark("tableRules")
            data["exportedAt"] = now
            try LogbookValidation.snapshot(data, metadataOnly: true)
            timing?.mark("mergedValidation")
            for (index, value) in (data["records"] as! [LogbookJSON]).enumerated() where touched.contains(value["id"] as! String) {
                if index >= oldCount { try writeRecord(value, position: index) }
                else {
                    try writeManual(value)
                }
            }
            try saveRoot(data, revision: expected + 1)
            timing?.mark("recordCompareAndWrite")
        }
        return (revision, now)
    }
    func mutate(expected: Int, timing: LogbookTableTiming? = nil, _ operation: (inout LogbookJSON) throws -> Void) throws -> (Int, String) {
        let now = logbookNow()
        let revision = try transaction(expected, timing: timing) {
            var data = try metadata() ?? Self.empty()
            let before = data["records"] as! [LogbookJSON]
            timing?.mark("metadataRead")
            try operation(&data)
            timing?.mark("tableRules")
            data["exportedAt"] = now
            try LogbookValidation.snapshot(data, metadataOnly: true)
            timing?.mark("mergedValidation")
            let after = data["records"] as! [LogbookJSON]
            let existing = Dictionary(uniqueKeysWithValues: before.map { ($0["id"] as! String, $0) })
            let retained = Set(after.map { $0["id"] as! String })
            for old in before where !retained.contains(old["id"] as! String) { try execute("DELETE FROM records WHERE id=?", [old["id"] as! String]) }
            for (index, value) in after.enumerated() {
                let id = value["id"] as! String
                guard let old = existing[id] else { try writeRecord(value, position: index); continue }
                // A touched manual draft is stored independently; unchanged online bodies stay in SQLite.
                if value["manualContent"] != nil || (old["link"] as? String != value["link"] as? String) || (old["sourceType"] as? String != value["sourceType"] as? String) {
                    if old["link"] as? String == value["link"] as? String, old["sourceType"] as? String == value["sourceType"] as? String,
                       value["manualContent"] != nil, value["rawContent"] == nil { try writeManual(value, position: index) }
                    else { try writeRecord(value, position: index) }
                } else if try logbookData(old) != logbookData(value) {
                    try execute("UPDATE records SET metadata=? WHERE id=?", [try logbookText(value), id])
                }
            }
            try saveRoot(data, revision: expected + 1)
            timing?.mark("recordCompareAndWrite")
        }
        return (revision, now)
    }

    /// Bodies remain in their existing v1 rows. Only successful selected results replace a body.
    /// The private spool has already been unlinked; its open descriptor survives until this ends.
    func finishFetch(_ batch: LogbookFetchBatch) throws -> (Int, String) {
        guard batch.segments.count == batch.targets.count else { throw LogbookFailure("检测结果尚未取齐；未保存。") }
        if deviceSpace {
            let needed = try LogbookCapacity.estimate(batch.stagedBytes, copies: 4) + LogbookCapacity.estimate(projectedBytes(batch.ids), copies: 2)
            try LogbookCapacity.require(available: available, additional: needed)
        }
        let input = try FileHandle(forReadingFrom: batch.url)
        defer { try? input.close() }
        try FileManager.default.removeItem(at: batch.url)
        let now = logbookNow()
        let revision = try transaction(batch.expected) {
            guard var root = try metadata() else { throw LogbookFailure("本机数据缺失。") }
            for id in batch.ids {
                try autoreleasepool {
                    guard let segment = batch.segments[id], let old = batch.targets[id],
                          let stored = try rows("SELECT metadata FROM records WHERE id=?", [id]).first?.first,
                          try logbookData(logbookObject(stored)) == logbookData(old) else { throw LogbookFailure("场次来源已变化；未保存。") }
                    try input.seek(toOffset: segment.offset)
                    guard let bytes = try input.read(upToCount: segment.bytes), bytes.count == segment.bytes,
                          LogbookArchive.digest(bytes) == segment.sha256,
                          let text = String(data: bytes, encoding: .utf8) else { throw LogbookFailure("检测暂存回读校验失败；未保存。") }
                    var value = try logbookObject(text)
                    try batch.validate(value)
                    let body = value.removeValue(forKey: "rawContent")
                    try execute("UPDATE records SET metadata=? WHERE id=?", [try logbookText(value), id])
                    if value["status"] as? String == "valid", body != nil {
                        try execute("UPDATE records SET body=? WHERE id=?", [try LogbookBackupJSON.body(bytes), id])
                    }
                }
            }
            root["exportedAt"] = now
            try saveRoot(root, revision: batch.expected + 1)
        }
        return (revision, now)
    }
}

/// One bounded upload at a time, then one append-only spool. Neither retains batch bodies in RAM.
final class LogbookSnapshotUpload {
    let id = UUID().uuidString
    let url: URL
    let expected: Int
    let bytes: Int
    let sha256: String
    private var output: FileHandle?
    private var written = 0
    private var index = 0
    private(set) var recordJSON: Data?
    init(directory: URL, expected: Int, bytes: Int, sha256: String) throws {
        guard bytes > 0, bytes <= LogbookLimits.snapshotUploadBytes, sha256.count == 64,
              sha256.allSatisfy({ "0123456789abcdef".contains($0) }) else { throw LogbookFailure("暂存长度或摘要无效。") }
        self.expected = expected; self.bytes = bytes; self.sha256 = sha256
        url = directory.appendingPathComponent(id + ".upload")
        try Data().write(to: url, options: [.withoutOverwriting])
        output = try FileHandle(forWritingTo: url)
    }
    deinit { try? close() }
    func close() throws {
        if let output { try output.close(); self.output = nil }
        if FileManager.default.fileExists(atPath: url.path) { try FileManager.default.removeItem(at: url) }
    }
    func append(index: Int, base64: String) throws {
        guard index == self.index, base64.utf8.count <= LogbookLimits.encodedChunkBytes,
              let chunk = Data(base64Encoded: base64), !chunk.isEmpty, chunk.count <= LogbookLimits.transferChunkBytes,
              written + chunk.count <= bytes, let output else { throw LogbookFailure("暂存片段缺失、乱序或超过上限。") }
        try output.write(contentsOf: chunk); written += chunk.count; self.index += 1
    }
    func snapshot() throws -> LogbookJSON {
        guard written == bytes, let output else { throw LogbookFailure("暂存尚未取齐。") }
        try output.synchronize(); try output.close(); self.output = nil
        let data = try Data(contentsOf: url)
        guard data.count == bytes, LogbookArchive.digest(data) == sha256,
              let text = String(data: data, encoding: .utf8) else { throw LogbookFailure("暂存长度、摘要或 UTF-8 校验失败。") }
        let value = try LogbookBackupJSON.object(data)
        try LogbookValidation.snapshot(value)
        guard let records = value["records"] as? [LogbookJSON], records.count == 1 else { throw LogbookFailure("每次只能暂存一场检测结果。") }
        recordJSON = try LogbookBackupJSON.singleRecord(data)
        return value
    }
}

final class LogbookFetchBatch {
    struct Segment { let offset: UInt64; let bytes: Int; let sha256: String }
    let id = UUID().uuidString
    let url: URL
    let expected: Int
    let bookmark: Data
    let ids: [String]
    let targets: [String: LogbookJSON]
    private(set) var segments: [String: Segment] = [:]
    private var written = 0
    var stagedBytes: Int { written }
    private let available: () throws -> Int
    private let maximumBytes: Int
    private let deviceSpace: Bool
    init(directory: URL, store: LogbookStore, ids: [String], expected: Int, bookmark: Data) throws {
        try store.check(expected)
        guard !ids.isEmpty, ids.count <= 50000, Set(ids).count == ids.count,
              let data = try store.metadata() else { throw LogbookFailure("批量检测目标无效。") }
        let wanted = Set(ids)
        let rows = (data["records"] as! [LogbookJSON]).filter { wanted.contains($0["id"] as! String) }
        guard rows.count == ids.count, rows.allSatisfy({ $0["sourceType"] as? String == "online" }) else { throw LogbookFailure("批量检测目标已变化。") }
        self.ids = ids; self.expected = expected; self.bookmark = bookmark
        deviceSpace = store.deviceSpace
        available = { try LogbookCapacity.available(directory) }
        maximumBytes = store.deviceSpace ? try LogbookCapacity.maximum(available: available, copies: 4) : LogbookLimits.batchStagingBytes
        targets = Dictionary(uniqueKeysWithValues: rows.map { ($0["id"] as! String, $0) })
        url = directory.appendingPathComponent(id + ".batch")
        try Data().write(to: url, options: [.withoutOverwriting])
    }
    deinit { try? close() }
    func close() throws { if FileManager.default.fileExists(atPath: url.path) { try FileManager.default.removeItem(at: url) } }
    func validate(_ value: LogbookJSON) throws {
        try LogbookValidation.record(value)
        guard let id = value["id"] as? String, var old = targets[id], value["manualContent"] == nil,
              ["valid", "invalid", "fetch_failed"].contains(value["status"] as? String ?? "") else { throw LogbookFailure("检测场次不匹配。") }
        var next = value
        let mutable = ["status", "lastError", "rawContent", "fetchedAt", "cacheSourceUrl", "playDate", "dateSource"]
        for key in mutable { old.removeValue(forKey: key); next.removeValue(forKey: key) }
        guard try logbookData(old) == logbookData(next) else { throw LogbookFailure("检测不得更改场次来源或其他字段。") }
        if let old = targets[id], old["dateSource"] as? String == "manual" {
            guard value["dateSource"] as? String == "manual", value["playDate"] as? String == old["playDate"] as? String else { throw LogbookFailure("检测不得更改手动日期。") }
        }
        if value["status"] as? String == "valid" {
            guard value["rawContent"] != nil, value["cacheSourceUrl"] as? String == targets[id]?["link"] as? String else { throw LogbookFailure("成功结果缺少对应来源的正文。") }
        } else if value["rawContent"] != nil { throw LogbookFailure("失败结果不得替换旧正文。") }
    }
    func stage(_ upload: LogbookSnapshotUpload) throws {
        guard upload.expected == expected else { throw LogbookFailure("暂存版本不一致。") }
        try autoreleasepool {
            let snapshot = try upload.snapshot()
            guard let records = snapshot["records"] as? [LogbookJSON], records.count == 1 else { throw LogbookFailure("每次只能暂存一场检测结果。") }
            let value = records[0]
            try validate(value)
            let id = value["id"] as! String
            guard segments[id] == nil else { throw LogbookFailure("检测结果重复。") }
            guard let data = upload.recordJSON else { throw LogbookFailure("完整正文词元未取齐。") }
            guard written + data.count <= maximumBytes else { throw LogbookFailure("检测结果超过本次可用空间预算；整批未保存。") }
            if deviceSpace { try LogbookCapacity.require(available: available, additional: LogbookCapacity.estimate(data.count, copies: 4)) }
            let output = try FileHandle(forWritingTo: url); defer { try? output.close() }
            do {
                try output.seekToEnd(); try output.write(contentsOf: data); try output.synchronize()
                try upload.close()
            } catch { try output.truncate(atOffset: UInt64(written)); throw error }
            segments[id] = Segment(offset: UInt64(written), bytes: data.count, sha256: LogbookArchive.digest(data))
            written += data.count
        }
    }
}
