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
    private let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
    init(url: URL) throws {
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        guard sqlite3_open_v2(url.path, &handle, SQLITE_OPEN_CREATE | SQLITE_OPEN_READWRITE | SQLITE_OPEN_FULLMUTEX, nil) == SQLITE_OK else { throw LogbookFailure("本机数据库无法打开；未重置数据。") }
        do {
            sqlite3_busy_timeout(handle, 5000)
            try execute("PRAGMA journal_mode=WAL")
            try execute("PRAGMA synchronous=FULL")
            let version = Int(try rows("PRAGMA user_version").first?.first ?? "0") ?? -1
            guard version == 0 || version == 1 else { throw LogbookFailure("iOS 数据库版本不兼容；未清空数据。") }
            try execute("CREATE TABLE IF NOT EXISTS state(id INTEGER PRIMARY KEY CHECK(id=1),json TEXT,revision INTEGER NOT NULL)")
            try execute("INSERT OR IGNORE INTO state VALUES(1,NULL,0)")
            try execute("CREATE TABLE IF NOT EXISTS records(id TEXT PRIMARY KEY,position INTEGER NOT NULL,metadata TEXT NOT NULL,body TEXT NOT NULL)")
            try execute("PRAGMA user_version=1")
        } catch { sqlite3_close(handle); handle = nil; throw error }
    }
    deinit { sqlite3_close(handle) }
    private func prepare(_ sql: String, _ values: [String] = []) throws -> OpaquePointer {
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(handle, sql, -1, &statement, nil) == SQLITE_OK, let statement else { throw LogbookFailure("本机数据库语句失败。") }
        for (index, value) in values.enumerated() {
            guard sqlite3_bind_text(statement, Int32(index + 1), value, -1, transient) == SQLITE_OK else { sqlite3_finalize(statement); throw LogbookFailure("本机数据库参数失败。") }
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
            result.append((0..<sqlite3_column_count(statement)).map { index in
                guard let value = sqlite3_column_text(statement, index) else { return "" }
                return String(cString: value)
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
        var data = try logbookObject(text)
        data["records"] = try rows("SELECT metadata FROM records ORDER BY position").map { try logbookObject($0[0]) }
        try LogbookValidation.snapshot(data, metadataOnly: true)
        return data
    }
    func deferredIDs() throws -> [String] { try rows("SELECT id FROM records WHERE body<>'{}' ORDER BY position").map { $0[0] } }
    /// Captures one exact revision as a private file; only one existing body row is copied at once.
    func backupFile(expected: Int, directory: URL) throws -> URL {
        try check(expected)
        guard var root = try metadata() else { throw LogbookFailure("尚无已保存数据。") }
        root.removeValue(forKey: "records")
        let url = directory.appendingPathComponent(UUID().uuidString + ".backup")
        try Data().write(to: url, options: [.withoutOverwriting])
        do {
            let output = try FileHandle(forWritingTo: url); defer { try? output.close() }
            var total = 0
            func write(_ text: String) throws {
                let bytes = Data(text.utf8); total += bytes.count
                guard total <= LogbookLimits.backupFileBytes else { throw LogbookFailure("备份超过 64 MB 上限。") }
                try output.write(contentsOf: bytes)
            }
            try write("{\"format\":\"coc.logbook.android\",\"formatVersion\":1,\"exportedAt\":" + String(try logbookText([logbookNow()]).dropFirst().dropLast()) + ",\"restoreScope\":[\"modules\",\"records\",\"characters\"],\"snapshot\":")
            try write(String(try logbookText(root).dropLast()) + ",\"records\":[")
            let statement = try prepare("SELECT metadata,body FROM records ORDER BY position")
            defer { sqlite3_finalize(statement) }
            var status = sqlite3_step(statement), first = true
            while status == SQLITE_ROW {
                try autoreleasepool {
                    guard let metadata = sqlite3_column_text(statement, 0), let body = sqlite3_column_text(statement, 1) else { throw LogbookFailure("场次正文读取失败。") }
                    let head = String(cString: metadata), tail = String(cString: body)
                    guard head.hasSuffix("}"), tail.hasPrefix("{"), tail.hasSuffix("}") else { throw LogbookFailure("本机正文格式异常。") }
                    try write((first ? "" : ",") + (tail == "{}" ? head : String(head.dropLast()) + "," + String(tail.dropFirst())))
                    first = false
                }
                status = sqlite3_step(statement)
            }
            guard status == SQLITE_DONE else { throw LogbookFailure("备份读取失败。") }
            try write("]}}")
            try check(expected); try output.synchronize()
            return url
        } catch { try? FileManager.default.removeItem(at: url); throw error }
    }
    func fullSnapshot(selected: [String]? = nil) throws -> LogbookJSON? {
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
        try execute("INSERT OR REPLACE INTO records VALUES(?,?,?,?)", [id, String(position), try logbookText(metadata), try logbookText(body)])
    }
    private func saveRoot(_ value: LogbookJSON, revision: Int) throws {
        var root = value; root.removeValue(forKey: "records")
        try execute("UPDATE state SET json=?,revision=? WHERE id=1", [try logbookText(root), String(revision)])
    }
    private func transaction(_ expected: Int, timing: LogbookTableTiming? = nil, _ action: () throws -> Void) throws -> Int {
        try execute("BEGIN IMMEDIATE")
        timing?.mark("transactionBegin")
        do {
            try check(expected); timing?.mark("transactionCAS"); try action()
            let size = Int(try rows("SELECT COALESCE(SUM(length(CAST(metadata AS BLOB))+length(CAST(body AS BLOB))),0) FROM records")[0][0]) ?? LogbookLimits.libraryBytes + 1
            let rootSize = Int(try rows("SELECT COALESCE(length(CAST(json AS BLOB)),0) FROM state WHERE id=1")[0][0]) ?? LogbookLimits.libraryBytes + 1
            guard size + rootSize <= LogbookLimits.libraryBytes else { throw LogbookFailure("数据超过 64 MB 上限。") }
            timing?.mark("capacity")
            try execute("COMMIT"); timing?.mark("transactionEnd"); return expected + 1
        } catch { try? execute("ROLLBACK"); throw error }
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
                    var metadata = value
                    let manual = metadata.removeValue(forKey: "manualContent") as! String
                    // Only replace the explicit manual field; all other native body members remain in SQLite.
                    try execute("UPDATE records SET metadata=?,body=json_patch(body,?) WHERE id=?", [try logbookText(metadata), try logbookText(["manualContent": manual]), value["id"] as! String])
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
                    var full = value
                    if old["link"] as? String == value["link"] as? String, old["sourceType"] as? String == value["sourceType"] as? String,
                       let text = try rows("SELECT body FROM records WHERE id=?", [id]).first?.first,
                       let raw = try logbookObject(text)["rawContent"] { full["rawContent"] = raw }
                    try writeRecord(full, position: index)
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
                    if value["status"] as? String == "valid", let body {
                        try execute("UPDATE records SET body=? WHERE id=?", [try logbookText(["rawContent": body]), id])
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
    init(directory: URL, expected: Int, bytes: Int, sha256: String) throws {
        guard bytes > 0, bytes <= LogbookLimits.snapshotUploadBytes, sha256.count == 64,
              sha256.allSatisfy({ "0123456789abcdef".contains($0) }) else { throw LogbookFailure("暂存长度或摘要无效。") }
        self.expected = expected; self.bytes = bytes; self.sha256 = sha256
        url = directory.appendingPathComponent(id + ".upload")
        try Data().write(to: url, options: [.withoutOverwriting])
        output = try FileHandle(forWritingTo: url)
    }
    deinit { try? output?.close(); try? FileManager.default.removeItem(at: url) }
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
        let value = try logbookObject(text)
        try LogbookValidation.snapshot(value)
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
    init(directory: URL, store: LogbookStore, ids: [String], expected: Int, bookmark: Data) throws {
        try store.check(expected)
        guard !ids.isEmpty, ids.count <= 50000, Set(ids).count == ids.count,
              let data = try store.metadata() else { throw LogbookFailure("批量检测目标无效。") }
        let wanted = Set(ids)
        let rows = (data["records"] as! [LogbookJSON]).filter { wanted.contains($0["id"] as! String) }
        guard rows.count == ids.count, rows.allSatisfy({ $0["sourceType"] as? String == "online" }) else { throw LogbookFailure("批量检测目标已变化。") }
        self.ids = ids; self.expected = expected; self.bookmark = bookmark
        targets = Dictionary(uniqueKeysWithValues: rows.map { ($0["id"] as! String, $0) })
        url = directory.appendingPathComponent(id + ".batch")
        try Data().write(to: url, options: [.withoutOverwriting])
    }
    deinit { try? FileManager.default.removeItem(at: url) }
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
            let data = try logbookData(value)
            guard written + data.count <= LogbookLimits.batchStagingBytes else { throw LogbookFailure("检测结果超过 64 MB 上限；未保存，可减少所选场次后重试。") }
            let output = try FileHandle(forWritingTo: url); defer { try? output.close() }
            try output.seekToEnd(); try output.write(contentsOf: data); try output.synchronize()
            segments[id] = Segment(offset: UInt64(written), bytes: data.count, sha256: LogbookArchive.digest(data))
            written += data.count
        }
    }
}
