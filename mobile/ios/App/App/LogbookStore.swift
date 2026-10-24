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
/// Transport frames are bounded; complete content has no product byte quota.
enum LogbookLimits {
    static let deviceSpaceLibrary = true
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
        let budget = try remaining(available())
        guard budget > 0, additional >= 0, additional <= budget else {
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

/// A representation threshold, never a content limit. Complete values are
/// verified UTF-8/JSON by callers and can span any number of bounded SQLite BLOBs.
final class LogbookChunks {
    private let handle: OpaquePointer?
    private let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
    init(_ handle: OpaquePointer?) { self.handle = handle }
    private func statement(_ sql: String, _ key: String? = nil) throws -> OpaquePointer {
        var result: OpaquePointer?
        guard sqlite3_prepare_v2(handle, sql, -1, &result, nil) == SQLITE_OK, let result else { throw LogbookFailure("分块存储语句失败。") }
        if let key, sqlite3_bind_text64(result, 1, key, UInt64(key.utf8.count), transient, UInt8(SQLITE_UTF8)) != SQLITE_OK { sqlite3_finalize(result); throw LogbookFailure("分块存储标识无效。") }
        return result
    }
    func execute(_ sql: String, _ key: String? = nil) throws {
        let query = try statement(sql, key); defer { sqlite3_finalize(query) }
        guard sqlite3_step(query) == SQLITE_DONE else { throw LogbookFailure("分块存储写入失败或空间不足。") }
    }
    func create() throws {
        try execute("CREATE TABLE IF NOT EXISTS value_manifests(key TEXT PRIMARY KEY,bytes INTEGER NOT NULL,sha256 TEXT NOT NULL)")
        try execute("CREATE TABLE IF NOT EXISTS value_chunks(key TEXT NOT NULL,part INTEGER NOT NULL,value BLOB NOT NULL,PRIMARY KEY(key,part))")
    }
    func remove(_ key: String) throws {
        try execute("DELETE FROM value_chunks WHERE key=?", key); try execute("DELETE FROM value_manifests WHERE key=?", key)
    }
    func put(_ data: Data, key: String) throws {
        try remove(key)
        let insert = try statement("INSERT INTO value_chunks VALUES(?,?,?)", key); defer { sqlite3_finalize(insert) }
        for (part, start) in stride(from: 0, to: data.count, by: LogbookLimits.transferChunkBytes).enumerated() {
            let chunk = data.subdata(in: start..<min(data.count, start + LogbookLimits.transferChunkBytes))
            sqlite3_reset(insert)
            guard sqlite3_bind_int64(insert, 2, Int64(part)) == SQLITE_OK else { throw LogbookFailure("分块序号超出系统计量范围。") }
            let bound = chunk.withUnsafeBytes { sqlite3_bind_blob64(insert, 3, $0.baseAddress, UInt64(chunk.count), transient) }
            guard bound == SQLITE_OK, sqlite3_step(insert) == SQLITE_DONE else { throw LogbookFailure("分块写入失败或空间不足。") }
        }
        let manifest = try statement("INSERT INTO value_manifests VALUES(?,?,?)", key); defer { sqlite3_finalize(manifest) }
        let hash = LogbookArchive.digest(data)
        guard sqlite3_bind_int64(manifest, 2, Int64(data.count)) == SQLITE_OK,
              sqlite3_bind_text(manifest, 3, hash, Int32(hash.utf8.count), transient) == SQLITE_OK,
              sqlite3_step(manifest) == SQLITE_DONE else { throw LogbookFailure("分块完整证明写入失败。") }
    }
    func proof(_ key: String) throws -> (Int, String)? {
        let query = try statement("SELECT bytes,sha256 FROM value_manifests WHERE key=?", key); defer { sqlite3_finalize(query) }
        let status = sqlite3_step(query)
        if status == SQLITE_DONE { return nil }
        guard status == SQLITE_ROW, let hash = sqlite3_column_text(query, 1) else { throw LogbookFailure("分块完整证明读取失败。") }
        let bytes = sqlite3_column_int64(query, 0)
        guard bytes >= 0, bytes <= Int64(Int.max) else { throw LogbookFailure("分块完整长度无效。") }
        return (Int(bytes), String(cString: hash))
    }
    func data(_ key: String) throws -> Data? {
        guard let (bytes, expectedHash) = try proof(key) else { return nil }
        let query = try statement("SELECT part,value FROM value_chunks WHERE key=? ORDER BY part", key); defer { sqlite3_finalize(query) }
        var result = Data(), part = 0, hash = SHA256(), status = sqlite3_step(query)
        while status == SQLITE_ROW {
            let count = Int(sqlite3_column_bytes(query, 1))
            guard sqlite3_column_int64(query, 0) == Int64(part), count > 0, count <= LogbookLimits.transferChunkBytes,
                  count <= bytes - result.count, let pointer = sqlite3_column_blob(query, 1) else { throw LogbookFailure("正文分块缺失、乱序或长度不符。") }
            let chunk = Data(bytes: pointer, count: count); result.append(chunk); hash.update(data: chunk); part += 1
            status = sqlite3_step(query)
        }
        guard status == SQLITE_DONE, result.count == bytes, hash.finalize().map({ String(format: "%02x", $0) }).joined() == expectedHash else { throw LogbookFailure("正文分块完整长度或摘要不符。") }
        return result
    }
    func text(_ key: String, inline: String) throws -> String {
        if inline != "@chunks:" + key {
            if let _ = try proof(key) { throw LogbookFailure("正文分块引用与完整证明不一致。") }
            return inline
        }
        guard let data = try data(key), let text = String(data: data, encoding: .utf8) else { throw LogbookFailure("正文分块缺失或UTF-8无效。") }; return text
    }
    func store(_ text: String, key: String) throws -> String {
        if text.utf8.count <= LogbookLimits.transferChunkBytes { try remove(key); return text }
        try put(Data(text.utf8), key: key); return "@chunks:" + key
    }
    func range(_ key: String, offset: Int, limit: Int) throws -> (Data, Int) {
        guard let (bytes, _) = try proof(key), offset >= 0, offset <= bytes, limit > 0 else { throw LogbookFailure("分块读取区间无效。") }
        let size = min(limit, bytes - offset), first = offset / LogbookLimits.transferChunkBytes
        let query = try statement("SELECT part,value FROM value_chunks WHERE key=? AND part>=? ORDER BY part LIMIT 2", key); defer { sqlite3_finalize(query) }
        sqlite3_bind_int64(query, 2, Int64(first))
        var result = Data(), part = first, status = sqlite3_step(query)
        while status == SQLITE_ROW, result.count < size {
            let count = Int(sqlite3_column_bytes(query, 1)), skip = part == first ? offset % LogbookLimits.transferChunkBytes : 0
            guard sqlite3_column_int64(query, 0) == Int64(part), count > skip, count <= LogbookLimits.transferChunkBytes, let pointer = sqlite3_column_blob(query, 1) else { throw LogbookFailure("字符串分块缺失或次序无效。") }
            let take = min(size - result.count, count - skip)
            result.append(Data(bytes: pointer.advanced(by: skip), count: take)); part += 1; status = sqlite3_step(query)
        }
        guard result.count == size else { throw LogbookFailure("字符串分块未取齐。") }; return (result, bytes)
    }
}

/// iOS-owned database. Bodies occupy separate columns and never enter metadata-only mutations.
/// All calls are serialized by the plugin's storage queue; automatic-backup file I/O runs elsewhere.
final class LogbookStore {
    private var handle: OpaquePointer?
    private var chunks: LogbookChunks { LogbookChunks(handle) }
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
            guard [0, 1, 2, 3].contains(version) else { throw LogbookFailure("iOS 数据库版本不兼容；未清空数据。") }
            try execute("CREATE TABLE IF NOT EXISTS state(id INTEGER PRIMARY KEY CHECK(id=1),json TEXT,revision INTEGER NOT NULL)")
            try execute("INSERT OR IGNORE INTO state VALUES(1,NULL,0)")
            try execute("CREATE TABLE IF NOT EXISTS records(id TEXT PRIMARY KEY,position INTEGER NOT NULL,metadata TEXT NOT NULL,body TEXT NOT NULL)")
            // v3 keeps every existing inline body byte-for-byte. New large
            // values use bounded BLOB parts; the migration itself copies none.
            try execute("BEGIN IMMEDIATE")
            do {
                if deviceSpace, version < 2 { try LogbookCapacity.require(available: self.available, additional: 4 * 1024 * 1024) }
                try execute("CREATE TABLE IF NOT EXISTS record_sizes(id TEXT PRIMARY KEY,metadata_bytes INTEGER NOT NULL CHECK(metadata_bytes>=0),body_bytes INTEGER NOT NULL CHECK(body_bytes>=0))")
                try chunks.create()
                for trigger in ["record_size_insert", "record_size_metadata", "record_size_body", "record_size_delete", "record_size_id"] { try execute("DROP TRIGGER IF EXISTS " + trigger) }
                try execute("CREATE TRIGGER record_size_insert AFTER INSERT ON records BEGIN INSERT OR REPLACE INTO record_sizes VALUES(NEW.id,COALESCE((SELECT bytes FROM value_manifests WHERE key='metadata:'||NEW.id),length(CAST(NEW.metadata AS BLOB))),COALESCE((SELECT bytes FROM value_manifests WHERE key='body:'||NEW.id),length(CAST(NEW.body AS BLOB)))); END")
                try execute("CREATE TRIGGER record_size_metadata AFTER UPDATE OF metadata ON records BEGIN UPDATE record_sizes SET metadata_bytes=COALESCE((SELECT bytes FROM value_manifests WHERE key='metadata:'||NEW.id),length(CAST(NEW.metadata AS BLOB))) WHERE id=NEW.id; END")
                try execute("CREATE TRIGGER record_size_body AFTER UPDATE OF body ON records BEGIN UPDATE record_sizes SET body_bytes=COALESCE((SELECT bytes FROM value_manifests WHERE key='body:'||NEW.id),length(CAST(NEW.body AS BLOB))) WHERE id=NEW.id; END")
                try execute("CREATE TRIGGER record_size_delete AFTER DELETE ON records BEGIN DELETE FROM record_sizes WHERE id=OLD.id; DELETE FROM value_chunks WHERE key IN ('body:'||OLD.id,'metadata:'||OLD.id); DELETE FROM value_manifests WHERE key IN ('body:'||OLD.id,'metadata:'||OLD.id); END")
                try execute("CREATE TRIGGER record_size_id BEFORE UPDATE OF id ON records WHEN NEW.id<>OLD.id BEGIN SELECT RAISE(ABORT,'record id is immutable'); END")
                if version < 2 {
                    try execute("DELETE FROM record_sizes")
                    try execute("INSERT INTO record_sizes SELECT id,COALESCE((SELECT bytes FROM value_manifests WHERE key='metadata:'||records.id),length(CAST(metadata AS BLOB))),COALESCE((SELECT bytes FROM value_manifests WHERE key='body:'||records.id),length(CAST(body AS BLOB))) FROM records")
                }
                guard try scalar("SELECT COUNT(*) FROM records") == scalar("SELECT COUNT(*) FROM record_sizes"),
                      try scalar("SELECT COUNT(*) FROM records r LEFT JOIN record_sizes s ON s.id=r.id WHERE s.id IS NULL") == 0 else { throw LogbookFailure("正文计量索引不完整；原数据未重置。") }
                try execute("PRAGMA user_version=3"); try execute("COMMIT")
            } catch { try? execute("ROLLBACK"); throw error }
        } catch { sqlite3_close(handle); handle = nil; throw error }
    }
    deinit { sqlite3_close(handle) }
    private func prepare(_ sql: String, _ values: [String] = []) throws -> OpaquePointer {
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(handle, sql, -1, &statement, nil) == SQLITE_OK, let statement else { throw LogbookFailure("本机数据库语句失败。") }
        for (index, value) in values.enumerated() {
            let bytes = value.utf8.count
            guard sqlite3_bind_text64(statement, Int32(index + 1), value, UInt64(bytes), transient, UInt8(SQLITE_UTF8)) == SQLITE_OK else { sqlite3_finalize(statement); throw LogbookFailure("本机数据库参数失败，或内容超出当前SQLite/内存的实际处理能力。") }
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
        try scalar("SELECT COALESCE(SUM(metadata_bytes+body_bytes),0) FROM record_sizes") + rootBytes()
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
        return try scalar("SELECT COALESCE(SUM(metadata_bytes),0) FROM record_sizes") + rootBytes() + 13 + max(0, records - 1)
    }
    private func rootBytes() throws -> Int { try scalar("SELECT COALESCE((SELECT bytes FROM value_manifests WHERE key='state'),length(CAST(json AS BLOB)),0) FROM state WHERE id=1") }
    func bodyText(_ id: String) throws -> String {
        guard let inline = try rows("SELECT body FROM records WHERE id=?", [id]).first?.first else { throw LogbookFailure("场次正文缺失。") }
        return try chunks.text("body:" + id, inline: inline)
    }
    func metadataText(_ id: String) throws -> String {
        guard let inline = try rows("SELECT metadata FROM records WHERE id=?", [id]).first?.first else { throw LogbookFailure("场次元数据缺失。") }
        return try chunks.text("metadata:" + id, inline: inline)
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
        // Body-free overview is bounded by actual device RAM, not a total byte quota.
        var data = try logbookObject(chunks.text("state", inline: text))
        data["records"] = try rows("SELECT id FROM records ORDER BY position").map { try logbookObject(metadataText($0[0])) }
        try LogbookValidation.snapshot(data, metadataOnly: true)
        return data
    }
    func deferredIDs() throws -> [String] { try rows("SELECT id FROM records WHERE body<>'{}' OR EXISTS(SELECT 1 FROM value_manifests WHERE key='body:'||records.id) ORDER BY position").map { $0[0] } }
    /// Captures one exact revision as a private file; only one existing body row is copied at once.
    func backupFile(expected: Int, directory: URL) throws -> URL {
        let url = directory.appendingPathComponent(UUID().uuidString + ".backup")
        let maximum = try LogbookCapacity.maximum(available: { try LogbookCapacity.available(directory) }, copies: 2)
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
    /// Canonical envelope v1 without reserializing body tokens. Exports validate
    /// here; read-only search delegates full semantic validation to its Worker.
    /// The trusted native caller chooses the operation budget, never JavaScript.
    func writeBackup(expected: Int, maximumBytes: Int, selected: [String]? = nil, validateRecords: Bool = true, sink: (Data) throws -> Void) throws {
        try writeSnapshot(expected: expected, maximumBytes: maximumBytes, selected: selected, validateRecords: validateRecords, searchBudget: nil, original: { _ in }, sink: sink)
    }
    /// Read-only acceleration only: the complete original and projected bytes
    /// come from the same selection, SQLite pass, metadata order and revision.
    func writeSearchProjection(expected: Int, maximumBytes: Int, selected: [String], memoryBudget: Int, timing: LogbookSearchTiming? = nil,
                               original: (Data) throws -> Void, sink: (Data) throws -> Void) throws {
        guard memoryBudget > 0 else { throw LogbookSearchUnavailable() }
        try writeSnapshot(expected: expected, maximumBytes: maximumBytes, selected: selected, validateRecords: false,
                          searchBudget: memoryBudget, timing: timing, original: original, sink: sink)
    }
    private func writeSnapshot(expected: Int, maximumBytes: Int, selected: [String]?, validateRecords: Bool,
                               searchBudget: Int?, timing: LogbookSearchTiming? = nil, original: (Data) throws -> Void, sink: (Data) throws -> Void) throws {
        try check(expected)
        var root = try metadata() ?? Self.empty()
        let allRecords = root.removeValue(forKey: "records") as! [LogbookJSON]
        let wanted = selected.map { Set($0) }
        let records = allRecords.filter { wanted == nil || wanted!.contains($0["id"] as! String) }
        if let selected { guard !selected.isEmpty, wanted!.count == selected.count, records.count == selected.count else { throw LogbookFailure("搜索场次缺失、重复或无效。") } }
        let maximum = maximumBytes
        guard maximum > 0 else { throw LogbookFailure("备份空间预算无效。") }
        var total = 0, originalTotal = 0
        // Native-only buffer size, bounded by live search memory admission;
        // every actual write still checks its entire byte and free-space cost.
        let chunkBytes = searchBudget.map { min(1024 * 1024, max(1, $0 / 32)) } ?? 65536
        func writeData(_ originalBytes: Data, projected: Data? = nil) throws {
            let started = timing == nil ? 0 : ProcessInfo.processInfo.systemUptime
            defer { timing?.elapsed("writeMs", started) }
            if searchBudget != nil {
                guard originalBytes.count <= maximum - originalTotal else { throw LogbookFailure("完整搜索来源超过本次可用空间预算。") }
                for offset in stride(from: 0, to: originalBytes.count, by: chunkBytes) {
                    let start = originalBytes.startIndex + offset
                    try original(originalBytes.subdata(in: start..<min(start + chunkBytes, originalBytes.endIndex)))
                }
                originalTotal += originalBytes.count
            }
            let bytes = projected ?? originalBytes
            if searchBudget != nil, bytes.count > originalBytes.count { throw LogbookSearchUnavailable() }
            guard bytes.count <= maximum - total else { throw LogbookFailure("完整备份超过本次可用空间预算。") }
            for offset in stride(from: 0, to: bytes.count, by: chunkBytes) {
                let start = bytes.startIndex + offset
                try sink(bytes.subdata(in: start..<min(start + chunkBytes, bytes.endIndex)))
            }
            total += bytes.count
        }
        func write(_ text: String) throws { try writeData(Data(text.utf8)) }
        try write("{\"format\":\"coc.logbook.android\",\"formatVersion\":1,\"exportedAt\":" + String(try logbookText([logbookNow()]).dropFirst().dropLast()) + ",\"restoreScope\":[\"modules\",\"records\",\"characters\"],\"snapshot\":")
        let rootText = try logbookText(root)
        if let budget = searchBudget {
            let bytes = Data(rootText.utf8)
            guard bytes.withUnsafeBytes({ coc_search_json_check($0.bindMemory(to: UInt8.self).baseAddress, bytes.count, UInt64(budget / 3), 0) }) != 0 else { throw LogbookSearchUnavailable() }
        }
        try write(String(rootText.dropLast()) + ",\"records\":[")
        let statement = try prepare("SELECT id FROM records ORDER BY position")
        defer { sqlite3_finalize(statement) }
        var status = sqlite3_step(statement), count = 0
        while status == SQLITE_ROW {
            guard let pointer = sqlite3_column_text(statement, 0),
                  let id = String(bytes: UnsafeBufferPointer(start: pointer, count: Int(sqlite3_column_bytes(statement, 0))), encoding: .utf8) else { throw LogbookFailure("场次正文读取失败或数量已变化。") }
            if let wanted, !wanted.contains(id) { status = sqlite3_step(statement); continue }
            try autoreleasepool {
                guard count < records.count else { throw LogbookFailure("场次数量已变化。") }
                let readStarted = timing == nil ? 0 : ProcessInfo.processInfo.systemUptime
                let head = try metadataText(id), tail = try bodyText(id)
                timing?.elapsed("readBodyMs", readStarted)
                guard head.hasSuffix("}"), tail.hasPrefix("{"), tail.hasSuffix("}") else { throw LogbookFailure("本机正文格式异常。") }
                var row = try logbookObject(head)
                if validateRecords {
                    let text = tail == "{}" ? head : String(head.dropLast()) + "," + String(tail.dropFirst())
                    let value = try LogbookBackupJSON.object(Data(text.utf8)); try LogbookValidation.record(value)
                    row = value; row.removeValue(forKey: "rawContent"); row.removeValue(forKey: "manualContent")
                }
                guard try logbookData(row) == logbookData(records[count]) else { throw LogbookFailure("备份场次次序或元数据已变化。") }
                if let budget = searchBudget {
                    let kernelStarted = timing == nil ? 0 : ProcessInfo.processInfo.systemUptime
                    let headBytes = Data(head.utf8), bodyBytes = Data(tail.utf8)
                    guard headBytes.withUnsafeBytes({ coc_search_json_check($0.bindMemory(to: UInt8.self).baseAddress, headBytes.count, UInt64(budget / 3), 1) }) != 0,
                          let projected = try LogbookBackupJSON.searchBody(bodyBytes, budget: budget) else { throw LogbookSearchUnavailable() }
                    timing?.elapsed("kernelMs", kernelStarted)
                    var prefix = Data((count == 0 ? "" : ",").utf8)
                    if tail == "{}" {
                        guard projected == bodyBytes else { throw LogbookSearchUnavailable() }
                        prefix.append(headBytes); try writeData(prefix)
                    } else {
                        // Keep the exact original JSON tokens. The C-owned Data
                        // and nonzero-index slices avoid full UTF-8 round trips.
                        prefix.append(headBytes.dropLast()); prefix.append(44)
                        try writeData(prefix)
                        try writeData(bodyBytes.dropFirst(), projected: projected.dropFirst())
                    }
                } else {
                    let text = tail == "{}" ? head : String(head.dropLast()) + "," + String(tail.dropFirst())
                    try write((count == 0 ? "" : ",") + text)
                }
                count += 1

            }
            status = sqlite3_step(statement)
        }
        guard status == SQLITE_DONE, count == records.count else { throw LogbookFailure("完整备份场次未取齐。") }
        try write("]}}"); try check(expected)
    }
    func projectedBytes(_ selected: [String]?) throws -> Int {
        var bytes = try rootBytes() + 13, count = 0
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
        guard var data = try metadata() else { return nil }
        var result: [LogbookJSON] = []
        let groups: [[String]] = selected.map { ids in stride(from: 0, to: ids.count, by: 400).map { Array(ids[$0..<min($0 + 400, ids.count)]) } } ?? [[]]
        for group in groups {
            let filter = selected == nil ? "" : " WHERE id IN (" + Array(repeating: "?", count: group.count).joined(separator: ",") + ")"
            for row in try rows("SELECT id FROM records" + filter + " ORDER BY position", group) {
                var value = try logbookObject(metadataText(row[0])); value.merge(try logbookObject(bodyText(row[0]))) { _, body in body }; result.append(value)
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
        if deviceSpace { try LogbookCapacity.require(available: available, additional: LogbookCapacity.estimate(bytes, copies: 4)) }
        let head = try chunks.store(metadata, key: "metadata:" + id), tail = try chunks.store(body, key: "body:" + id)
        try execute("INSERT INTO records VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET position=excluded.position,metadata=excluded.metadata,body=excluded.body", [id, String(position), head, tail])
    }
    private func writeRawRecord(_ value: LogbookJSON, json: Data, position: Int) throws {
        guard let id = value["id"] as? String else { throw LogbookFailure("场次标识缺失。") }
        var metadata = value; metadata.removeValue(forKey: "rawContent"); metadata.removeValue(forKey: "manualContent")
        try upsertRecord(id: id, metadata: logbookText(metadata), body: LogbookBackupJSON.body(json), position: position)
    }
    /// Replace only the explicit manual member; retain the original raw JSON
    /// tokens exactly, including numeric spelling and escapes.
    private func writeManual(_ value: LogbookJSON, position: Int? = nil) throws {
        guard let id = value["id"] as? String, let manual = value["manualContent"] as? String, value["rawContent"] == nil else { throw LogbookFailure("手动差量字段无效。") }
        var metadata = value; metadata.removeValue(forKey: "manualContent")
        let head = try logbookText(metadata), tail = try LogbookBackupJSON.replacingManual(Data(bodyText(id).utf8), manual: manual)
        if deviceSpace { try LogbookCapacity.require(available: available, additional: LogbookCapacity.estimate(head.utf8.count + tail.utf8.count, copies: 4)) }
        let storedHead = try chunks.store(head, key: "metadata:" + id), storedTail = try chunks.store(tail, key: "body:" + id)
        if let position { try execute("UPDATE records SET metadata=?,body=?,position=? WHERE id=?", [storedHead, storedTail, String(position), id]) }
        else { try execute("UPDATE records SET metadata=?,body=? WHERE id=?", [storedHead, storedTail, id]) }
    }
    private func saveRoot(_ value: LogbookJSON, revision: Int) throws {
        var root = value; root.removeValue(forKey: "records")
        try execute("UPDATE state SET json=?,revision=? WHERE id=1", [try chunks.store(logbookText(root), key: "state"), String(revision)])
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
                try LogbookCapacity.require(available: available, additional: 0)
            }
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
    /// Streaming tables add/patch only staged rows. Existing online body tokens
    /// never enter Foundation or a write statement. Metadata remains RAM-bound.
    func importTableStream(_ owner: LogbookTableSession, authorize: () throws -> Void = {}) throws -> Int {
        try owner.requireCommitReady()
        guard var data = owner.root else { throw LogbookFailure("表格预览尚未完整。") }
        for kind in ["modules", "characters", "records"] {
            var values: [LogbookJSON] = []
            try owner.eachEntity(kind, bodies: false) { value, _, _ in values.append(value) }
            data[kind] = values
        }
        data["exportedAt"] = logbookNow()
        try LogbookValidation.snapshot(data, metadataOnly: true)
        return try transaction(owner.expected) {
            try authorize()
            try owner.eachEntity("records", changedOnly: true) { value, position, change in
                try LogbookValidation.record(value)
                if change == 1 { try self.writeRecord(value, position: position) }
                else { try self.writeManual(value) }
            }
            try saveRoot(data, revision: owner.expected + 1)
            try authorize()
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
                    try execute("UPDATE records SET metadata=? WHERE id=?", [try chunks.store(logbookText(value), key: "metadata:" + id), id])
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
                          try logbookData(logbookObject(metadataText(id))) == logbookData(old) else { throw LogbookFailure("场次来源已变化；未保存。") }
                    try input.seek(toOffset: segment.offset)
                    guard let bytes = try input.read(upToCount: segment.bytes), bytes.count == segment.bytes,
                          LogbookArchive.digest(bytes) == segment.sha256,
                          let text = String(data: bytes, encoding: .utf8) else { throw LogbookFailure("检测暂存回读校验失败；未保存。") }
                    var value = try logbookObject(text)
                    try batch.validate(value)
                    let body = value.removeValue(forKey: "rawContent")
                    try execute("UPDATE records SET metadata=? WHERE id=?", [try chunks.store(logbookText(value), key: "metadata:" + id), id])
                    if value["status"] as? String == "valid", body != nil {
                        try execute("UPDATE records SET body=? WHERE id=?", [try chunks.store(LogbookBackupJSON.body(bytes), key: "body:" + id), id])
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
    private let available: () throws -> Int
    init(directory: URL, expected: Int, bytes: Int, sha256: String, available: (() throws -> Int)? = nil) throws {
        guard bytes > 0, sha256.count == 64,
              sha256.allSatisfy({ "0123456789abcdef".contains($0) }) else { throw LogbookFailure("暂存长度或摘要无效。") }
        self.expected = expected; self.bytes = bytes; self.sha256 = sha256
        self.available = available ?? { try LogbookCapacity.available(directory) }
        try LogbookCapacity.require(available: self.available, additional: LogbookCapacity.estimate(bytes, copies: 4))
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
        try LogbookCapacity.require(available: available, additional: chunk.count)
        try output.write(contentsOf: chunk); written += chunk.count; self.index += 1
    }
    /// Bounded transport decoding preserves the original complete upload hash,
    /// ordinal, space checks and final schema/CAS validation. No content quota.
    func appendEncoded(index: Int, encoding: String, rawBytes: Int, base64: String) throws {
        do {
            guard index == self.index, output != nil, rawBytes > 0,
                  rawBytes <= 2 * 1024 * 1024, rawBytes <= bytes - written,
                  base64.utf8.count <= LogbookLimits.encodedChunkBytes,
                  let wire = Data(base64Encoded: base64), !wire.isEmpty,
                  wire.count <= LogbookLimits.transferChunkBytes else { throw LogbookFailure("暂存片段缺失、乱序或长度无效。") }
            var chunk: Data
            if encoding == "identity" {
                guard rawBytes == wire.count else { throw LogbookFailure("原始片段长度不符。") }
                chunk = wire
            } else if encoding == "zlib" {
                chunk = Data(count: rawBytes)
                let complete = wire.withUnsafeBytes { source in
                    chunk.withUnsafeMutableBytes { target in
                        coc_upload_inflate(source.bindMemory(to: UInt8.self).baseAddress, wire.count,
                                           target.bindMemory(to: UInt8.self).baseAddress, rawBytes)
                    }
                }
                guard complete == 1 else { throw LogbookFailure("压缩片段损坏或展开长度不符。") }
            } else { throw LogbookFailure("不支持的暂存编码。") }
            try LogbookCapacity.require(available: available, additional: chunk.count)
            try output!.write(contentsOf: chunk); written += chunk.count; self.index += 1
        } catch {
            try? close()
            throw error
        }
    }
    func snapshot() throws -> LogbookJSON {
        guard written == bytes, let output else { throw LogbookFailure("暂存尚未取齐。") }
        try output.synchronize(); try output.close(); self.output = nil
        let data = try Data(contentsOf: url)
        guard data.count == bytes, LogbookArchive.digest(data) == sha256,
              let text = String(data: data, encoding: .utf8) else { throw LogbookFailure("暂存长度、摘要或 UTF-8 校验失败。") }
        let value = try LogbookBackupJSON.uploadObject(data)
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
        guard !ids.isEmpty, Set(ids).count == ids.count,
              let data = try store.metadata() else { throw LogbookFailure("批量检测目标无效。") }
        let wanted = Set(ids)
        let rows = (data["records"] as! [LogbookJSON]).filter { wanted.contains($0["id"] as! String) }
        guard rows.count == ids.count, rows.allSatisfy({ $0["sourceType"] as? String == "online" }) else { throw LogbookFailure("批量检测目标已变化。") }
        self.ids = ids; self.expected = expected; self.bookmark = bookmark
        deviceSpace = store.deviceSpace
        available = { try LogbookCapacity.available(directory) }
        maximumBytes = try LogbookCapacity.maximum(available: available, copies: 4)
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
