import Foundation
import SQLite3

typealias LogbookJSON = [String: Any]
struct LogbookFailure: LocalizedError {
    let message: String
    init(_ message: String) { self.message = message }
    var errorDescription: String? { message }
}
let logbookMaximumBytes = 64 * 1024 * 1024
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
    private func transaction(_ expected: Int, _ action: () throws -> Void) throws -> Int {
        try execute("BEGIN IMMEDIATE")
        do {
            try check(expected); try action()
            let size = Int(try rows("SELECT COALESCE(SUM(length(CAST(metadata AS BLOB))+length(CAST(body AS BLOB))),0) FROM records")[0][0]) ?? logbookMaximumBytes + 1
            let rootSize = Int(try rows("SELECT COALESCE(length(CAST(json AS BLOB)),0) FROM state WHERE id=1")[0][0]) ?? logbookMaximumBytes + 1
            guard size + rootSize <= logbookMaximumBytes else { throw LogbookFailure("数据超过 64 MB 上限。") }
            try execute("COMMIT"); return expected + 1
        } catch { try? execute("ROLLBACK"); throw error }
    }
    func replace(_ data: LogbookJSON, expected: Int) throws -> Int {
        try LogbookValidation.snapshot(data)
        guard try logbookData(data).count <= logbookMaximumBytes else { throw LogbookFailure("数据超过 64 MB 上限。") }
        return try transaction(expected) {
            try execute("DELETE FROM records")
            for (index, value) in (data["records"] as! [LogbookJSON]).enumerated() { try writeRecord(value, position: index) }
            try saveRoot(data, revision: expected + 1)
        }
    }
    func mutate(expected: Int, _ operation: (inout LogbookJSON) throws -> Void) throws -> (Int, String) {
        let now = logbookNow()
        let revision = try transaction(expected) {
            var data = try metadata() ?? Self.empty()
            let before = data["records"] as! [LogbookJSON]
            try operation(&data)
            data["exportedAt"] = now
            try LogbookValidation.snapshot(data, metadataOnly: true)
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
        }
        return (revision, now)
    }
}
