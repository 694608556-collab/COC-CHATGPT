import Foundation
import SQLite3
import CryptoKit

/// Shared read-only parser. The C ABI receives one privately owned immutable
/// EOF/SHA snapshot. Unsupported spellings/cache budgets use the full reader.
enum LogbookTableKernel {
    static func warmCode() { coc_table_kernel_warm() }
    static func inspect(_ bytes: Data, available: Int) throws -> LogbookJSON? {
        let output = bytes.withUnsafeBytes { buffer in
            coc_table_kernel_preview(buffer.bindMemory(to: UInt8.self).baseAddress, bytes.count, UInt64(max(0, available)))
        }
        guard let output else { return nil }
        defer { free(output) }
        guard let text = String(validatingUTF8: output),
              let value = try JSONSerialization.jsonObject(with: Data(text.utf8)) as? LogbookJSON else {
            throw LogbookFailure("原生角色卡草稿编码无效。")
        }
        guard value["version"] as? Int == 1, value["supported"] as? Bool == true else { return nil }
        return value
    }
}

/// A private disk index. Every query returning multiple values has an explicit
/// caller-owned page, or is consumed with each() without materializing all rows.
final class LogbookTableIndex {
    private var handle: OpaquePointer?
    private let url: URL
    private var chunks: LogbookChunks { LogbookChunks(handle) }
    private let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
    init(_ url: URL) throws {
        self.url = url
        guard sqlite3_open_v2(url.path, &handle, SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE | SQLITE_OPEN_FULLMUTEX, nil) == SQLITE_OK else { throw LogbookFailure("表格私有索引无法创建。") }
        do {
        try execute("PRAGMA journal_mode=DELETE"); try execute("PRAGMA synchronous=FULL")
        // Retain FULL durability, committing all private schema creation once.
        try execute("BEGIN IMMEDIATE")
        try chunks.create()
        try execute("CREATE TABLE frames(sheet INTEGER NOT NULL,row INTEGER NOT NULL,kind TEXT NOT NULL,value TEXT NOT NULL,warnings TEXT NOT NULL,PRIMARY KEY(sheet,row))")
        try execute("CREATE TABLE entities(kind TEXT NOT NULL,id TEXT NOT NULL,position INTEGER NOT NULL,value TEXT NOT NULL,manual TEXT,name TEXT NOT NULL,module TEXT NOT NULL,link TEXT NOT NULL,source TEXT NOT NULL,changed INTEGER NOT NULL,PRIMARY KEY(kind,id))")
        try execute("CREATE INDEX entity_names ON entities(kind,name,position)")
        try execute("CREATE INDEX record_names ON entities(kind,module,name,source,link)")
        try execute("CREATE INDEX record_links ON entities(kind,module,link)")
        try execute("CREATE TABLE module_counts(id TEXT PRIMARY KEY,value INTEGER NOT NULL)")
        try execute("CREATE TABLE preview(kind TEXT NOT NULL,position INTEGER NOT NULL,value TEXT NOT NULL,PRIMARY KEY(kind,position))")
        try execute("COMMIT")
        } catch { try? execute("ROLLBACK"); sqlite3_close(handle); handle = nil; throw error }
    }
    deinit { close() }
    func close() { if let handle { sqlite3_close(handle); self.handle = nil } }
    private func prepare(_ sql: String, _ values: [String?] = []) throws -> OpaquePointer {
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(handle, sql, -1, &statement, nil) == SQLITE_OK, let statement else { throw LogbookFailure("表格私有索引语句失败。") }
        for (offset, value) in values.enumerated() {
            let code: Int32
            if let value {
                code = sqlite3_bind_text64(statement, Int32(offset + 1), value, UInt64(value.utf8.count), transient, UInt8(SQLITE_UTF8))
            } else { code = sqlite3_bind_null(statement, Int32(offset + 1)) }
            guard code == SQLITE_OK else { sqlite3_finalize(statement); throw LogbookFailure("表格私有索引参数失败，或内容超出当前SQLite/内存的实际处理能力。") }
        }
        return statement
    }
    func execute(_ sql: String, _ values: [String?] = []) throws {
        let statement = try prepare(sql, values); defer { sqlite3_finalize(statement) }
        var code = sqlite3_step(statement)
        while code == SQLITE_ROW { code = sqlite3_step(statement) }
        guard code == SQLITE_DONE else { throw LogbookFailure("表格索引写入失败、坐标重复或空间不足。") }
    }
    func each(_ sql: String, _ values: [String?] = [], _ receive: ([String?]) throws -> Void) throws {
        let statement = try prepare(sql, values); defer { sqlite3_finalize(statement) }
        var code = sqlite3_step(statement)
        while code == SQLITE_ROW {
            try autoreleasepool {
                let row: [String?] = try (0..<sqlite3_column_count(statement)).map { column in
                    if sqlite3_column_type(statement, column) == SQLITE_NULL { return nil }
                    guard let value = sqlite3_column_text(statement, column), let text = String(bytes: UnsafeBufferPointer(start: value, count: Int(sqlite3_column_bytes(statement, column))), encoding: .utf8) else { throw LogbookFailure("表格索引UTF-8损坏。") }
                    return text
                }
                try receive(row)
            }
            code = sqlite3_step(statement)
        }
        guard code == SQLITE_DONE else { throw LogbookFailure("表格索引读取失败（SQLite \(code)/\(sqlite3_extended_errcode(handle))：\(String(cString: sqlite3_errmsg(handle)))）。") }
    }
    func rows(_ sql: String, _ values: [String?] = []) throws -> [[String?]] {
        var result: [[String?]] = []; try each(sql, values) { result.append($0) }; return result
    }
    func count(_ sql: String, _ values: [String?] = []) throws -> Int {
        guard let cell = try rows(sql, values).first?.first, let text = cell, let count = Int(text), count >= 0 else { throw LogbookFailure("表格索引计量失败。") }; return count
    }
    // The SQLite cell contains either a small complete JSON value or a private
    // chunk key. Arbitrarily large text never becomes a single SQLite value.
    func pack(_ text: String, key: String) throws -> String {
        if text.utf8.count <= LogbookLimits.transferChunkBytes { try chunks.remove(key); return text }
        try chunks.put(Data(text.utf8), key: key); return "@chunks:" + key
    }
    func unpack(_ text: String) throws -> String {
        guard text.hasPrefix("@chunks:") else { return text }
        let key = String(text.dropFirst(8))
        guard let bytes = try chunks.data(key), let result = String(data: bytes, encoding: .utf8) else { throw LogbookFailure("表格分块内容缺失或UTF-8无效。") }
        return result
    }
    func unpackString(_ text: String) throws -> String {
        guard let values = try JSONSerialization.jsonObject(with: Data(unpack(text).utf8)) as? [String], values.count == 1 else { throw LogbookFailure("表格文本分块无效。") }
        return values[0]
    }
    func putString(_ id: Int, _ text: String) throws { try chunks.put(Data(text.utf8), key: "sst:" + String(id)) }
    func string(_ id: Int, offset: Int) throws -> LogbookJSON {
        let (data, length) = try chunks.range("sst:" + String(id), offset: offset, limit: LogbookLimits.transferChunkBytes)
        return ["base64": data.base64EncodedString(), "bytes": length, "done": offset + data.count == length]
    }
    func freeze() throws {
        close()
        guard sqlite3_open_v2(url.absoluteString + "?immutable=1", &handle, SQLITE_OPEN_READONLY | SQLITE_OPEN_FULLMUTEX | SQLITE_OPEN_URI, nil) == SQLITE_OK else { throw LogbookFailure("表格预览索引无法封存。") }
        try execute("PRAGMA query_only=ON")
    }
}

/// Source, XLSX strings and candidates are private disk files. This owner never
/// grants whole-library restore authority and never writes production data.
final class LogbookTableSession {
    private final class Output {
        let url: URL
        var handle: FileHandle?
        var bytes = 0, index = 0
        init(_ url: URL) throws {
            self.url = url; try Data().write(to: url, options: [.withoutOverwriting])
            handle = try FileHandle(forWritingTo: url)
        }
        deinit { try? handle?.close() }
        func seal() throws { if let handle { try handle.synchronize(); try handle.close(); self.handle = nil } }
    }
    let id = UUID().uuidString.lowercased()
    let expected: Int
    let bookmark: Data
    let kind: String
    let available: () throws -> Int
    let directory: URL
    private(set) var index: LogbookTableIndex!
    let maximumStageBytes: Int
    private var source: Output!, candidate: Output!
    private let allowMemorySnapshot: Bool
    private var memorySnapshot: Data?
    private var ownershipEstablished = false
    private var sourceProof: LogbookBackupProof?
    private var candidateProof: LogbookBackupProof?
    private var indexProof: LogbookBackupProof?
    private var commitMetadata: FileHandle?, commitRecords: FileHandle?
    private var commitMetadataProof: LogbookBackupProof?, commitRecordsProof: LogbookBackupProof?
    private var stringsIndex = 0, stringsBytes = 0, stringsCount = 0, stageBytes = 0
    private var stringsLine = Data()
    private var ready = false, closed = false, unlinked = false
    private var moduleTotal = 0, recordTotal = 0, characterTotal = 0
    private(set) var added = 0, updated = 0, skipped = 0, namesCount = 0, warningsCount = 0
    private(set) var root: LogbookJSON?
    var sourceURL: URL { source?.url ?? directory.appendingPathComponent("source") }
    init(directory base: URL, expected: Int, bookmark: Data, kind: String, available: (() throws -> Int)? = nil, deferStorage: Bool = false) throws {
        guard ["record-table", "character-table"].contains(kind) else { throw LogbookFailure("表格类型无效。") }
        self.expected = expected; self.bookmark = bookmark; self.kind = kind
        allowMemorySnapshot = deferStorage && kind == "character-table"
        try FileManager.default.createDirectory(at: base, withIntermediateDirectories: true)
        directory = base.appendingPathComponent("table-" + id, isDirectory: true)
        self.available = available ?? { try LogbookCapacity.available(base) }
        maximumStageBytes = try LogbookCapacity.maximum(available: self.available, copies: 6)
        if !deferStorage { try ensureStorage() }
    }
    private func ensureStorage() throws {
        if ownershipEstablished { return }
        guard !closed else { throw LogbookFailure("表格私有租约已关闭。") }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: false)
        let marker = directory.appendingPathComponent("owner.json")
        do { try logbookData(["kind": "coc-table-stream-v1", "id": id]).write(to: marker, options: [.withoutOverwriting]) }
        catch { try FileManager.default.removeItem(at: directory); throw error }
        ownershipEstablished = true
        do {
            source = try Output(directory.appendingPathComponent("source")); candidate = try Output(directory.appendingPathComponent("candidate"))
            index = try LogbookTableIndex(directory.appendingPathComponent("index.sqlite"))
        } catch {
            do { try Self.removeOwned(directory, id: id) }
            catch { throw LogbookFailure("表格暂存创建失败且清理失败，请重开后重试。") }
            throw error
        }
    }
    deinit { try? close() }
    func require(_ token: String?) throws { guard token == id, !closed else { throw LogbookFailure("表格导入租约已失效。") } }
    func capture(_ input: FileHandle, name: String) throws -> LogbookJSON {
        guard sourceProof == nil, !closed else { throw LogbookFailure("表格来源已封存。") }
        let format = (name as NSString).pathExtension.lowercased()
        guard ["csv", "xlsx", "xls"].contains(format) else { throw LogbookFailure("仅支持XLSX、XLS或CSV表格。") }
        if allowMemorySnapshot && format == "xlsx" { return try captureReadonlySnapshot(input, name: name) }
        try ensureStorage()
        guard let output = source.handle else { throw LogbookFailure("表格来源已封存。") }
        let maximum = try LogbookCapacity.maximum(available: available, copies: 6)
        while let chunk = try input.read(upToCount: 65536), !chunk.isEmpty {
            guard chunk.count <= maximum - source.bytes else { throw LogbookFailure("表格来源超过本次可用空间。") }
            try LogbookCapacity.require(available: available, additional: chunk.count)
            try output.write(contentsOf: chunk); source.bytes += chunk.count
        }
        guard source.bytes > 0 else { throw LogbookFailure("所选表格为空。") }
        try source.seal(); sourceProof = try LogbookBackupSession.fileProof(source.url, maximumBytes: source.bytes)
        return sourceMetadata(name: name, format: format)
    }
    private func sourceMetadata(name: String, format: String) -> LogbookJSON {
        ["id": id, "revision": expected, "fileUri": sourceURL.absoluteString, "bytes": sourceProof!.bytes, "sha256": sourceProof!.sha256, "name": name, "format": format, "maximumStageBytes": maximumStageBytes]
    }
    private func captureReadonlySnapshot(_ input: FileHandle, name: String) throws -> LogbookJSON {
        var memory = Data(), digest = SHA256(), total = 0, onDisk = false
        let maximum = try LogbookCapacity.maximum(available: available, copies: 6)
        while let chunk = try input.read(upToCount: 65536), !chunk.isEmpty {
            guard chunk.count <= maximum - total else { throw LogbookFailure("表格来源超过本次可用空间。") }
            try LogbookCapacity.require(available: available, additional: chunk.count)
            total += chunk.count; digest.update(data: chunk)
            if !onDisk && total > 2 * 1024 * 1024 {
                // A cache budget only: materialize the exact prefix, then all
                // remaining bytes. No content is rejected or omitted here.
                try ensureStorage(); try source.handle!.write(contentsOf: memory)
                memory.removeAll(keepingCapacity: false); onDisk = true
            }
            if onDisk { try source.handle!.write(contentsOf: chunk) } else { memory.append(chunk) }
        }
        guard total > 0 else { throw LogbookFailure("所选表格为空。") }
        let proof = LogbookBackupProof(bytes: total, sha256: digest.finalize().map { String(format: "%02x", $0) }.joined())
        if onDisk {
            source.bytes = total; try source.seal()
            let copied = try LogbookBackupSession.fileProof(source.url, maximumBytes: total)
            try proof.matches(bytes: copied.bytes, sha256: copied.sha256)
        } else { memorySnapshot = memory }
        sourceProof = proof
        return sourceMetadata(name: name, format: "xlsx")
    }
    func inspectCoc7Kernel() throws -> LogbookJSON? {
        guard allowMemorySnapshot, !closed, !ready, let bytes = memorySnapshot, let proof = sourceProof else { return nil }
        guard bytes.count == proof.bytes else { throw LogbookFailure("角色卡完整快照长度已变化。") }
        if let payload = try LogbookTableKernel.inspect(bytes, available: maximumStageBytes) {
            return ["source": ["bytes": proof.bytes, "sha256": proof.sha256], "payload": payload]
        }
        // Unsupported resident input still gets the durable full source/index
        // contract before JS is allowed to fetch or stage any byte.
        try ensureStorage(); try source.handle!.write(contentsOf: bytes); source.bytes = bytes.count; try source.seal()
        let copied = try LogbookBackupSession.fileProof(source.url, maximumBytes: proof.bytes)
        try proof.matches(bytes: copied.bytes, sha256: copied.sha256)
        memorySnapshot = nil
        return nil
    }
    func append(key: String, chunkIndex: Int, bytes: Data) throws {
        guard memorySnapshot == nil, sourceProof != nil, !closed, !ready, !bytes.isEmpty, bytes.count <= LogbookLimits.transferChunkBytes,
              bytes.count <= maximumStageBytes - stageBytes else { throw LogbookFailure("表格分段或本次可用空间预算无效。") }
        try LogbookCapacity.require(available: available, additional: LogbookCapacity.estimate(bytes.count, copies: 3))
        if key == "candidate" {
            guard chunkIndex == candidate.index, let output = candidate.handle else { throw LogbookFailure("表格候选分段乱序或已封存。") }
            try output.write(contentsOf: bytes); candidate.index += 1; candidate.bytes += bytes.count
        } else if key == "strings" {
            guard chunkIndex == stringsIndex else { throw LogbookFailure("表格字符串分段乱序。") }
            try index.execute("BEGIN")
            do {
                try Self.lines(bytes, pending: &stringsLine) { line in
                    var wrapped = Data("{\"value\":".utf8); wrapped.append(line); wrapped.append(125)
                    let object = try LogbookBackupJSON.object(wrapped)
                    guard let value = object["value"] as? [Any], value.count == 2, let number = value[0] as? NSNumber,
                          LogbookValidation.number(number), number.doubleValue == Double(self.stringsCount), let text = value[1] as? String else { throw LogbookFailure("表格共享字符串索引或内容无效。") }
                    try self.index.putString(self.stringsCount, text); self.stringsCount += 1
                }
                try index.execute("COMMIT"); stringsIndex += 1; stringsBytes += bytes.count
            } catch { try? index.execute("ROLLBACK"); throw error }
        } else { throw LogbookFailure("表格私有暂存类型无效。") }
        stageBytes += bytes.count
    }
    private static func lines(_ bytes: Data, pending: inout Data, receive: (Data) throws -> Void) throws {
        var start = bytes.startIndex
        for position in bytes.indices where bytes[position] == 10 {
            pending.append(bytes[start..<position])
            guard !pending.isEmpty else { throw LogbookFailure("表格候选含空行。") }
            try receive(pending); pending.removeAll(keepingCapacity: false); start = bytes.index(after: position)
        }
        pending.append(bytes[start..<bytes.endIndex])
    }
    func readString(_ string: Int, offset: Int) throws -> LogbookJSON {
        guard !closed, !ready, string >= 0, string < stringsCount, offset >= 0, offset < Int.max else { throw LogbookFailure("表格共享字符串位置无效。") }
        return try index.string(string, offset: offset)
    }
    private func verify(_ url: URL, _ proof: LogbookBackupProof) throws {
        let actual = try LogbookBackupSession.fileProof(url, maximumBytes: proof.bytes)
        try proof.matches(bytes: actual.bytes, sha256: actual.sha256)
    }
    private static func indexKey(_ text: String) -> String { LogbookArchive.digest(Data(text.utf8)) }
    private func put(_ kind: String, _ value: LogbookJSON, position: Int, changed: Int, manual: String? = nil) throws {
        var metadata = value; metadata.removeValue(forKey: "rawContent"); metadata.removeValue(forKey: "manualContent")
        let name = kind == "characters" ? ((value["basic"] as? LogbookJSON)?["name"] as? String ?? "") : value["name"] as? String ?? ""
        let id = value["id"] as! String, key = kind + ":" + id
        let head = try index.pack(logbookText(metadata), key: "entity:" + key)
        let body = try manual.map { try index.pack(logbookText([$0]), key: "manual:" + key) }
        try index.execute("INSERT OR REPLACE INTO entities VALUES(?,?,?,?,?,?,?,?,?,?)", [kind, id, String(position), head, body, Self.indexKey(name), value["moduleId"] as? String ?? "", Self.indexKey(value["link"] as? String ?? ""), value["sourceType"] as? String ?? "", String(changed)])
    }
    private func note(_ kind: String, _ text: String) throws {
        let position = kind == "names" ? namesCount : warningsCount
        let value = try index.pack(logbookText([text]), key: "preview:" + kind + ":" + String(position))
        try index.execute("INSERT INTO preview VALUES(?,?,?)", [kind, String(position), value])
        if kind == "names" { namesCount += 1 } else { warningsCount += 1 }
    }
    private static func whitespace(_ value: Unicode.Scalar) -> Bool {
        let n = value.value
        return (9...13).contains(n) || [32,160,5760,8232,8233,8239,8287,12288,65279].contains(n) || (8192...8202).contains(n)
    }
    private static func trim(_ text: String) -> String {
        let scalars = text.unicodeScalars; var start = scalars.startIndex, end = scalars.endIndex
        while start != end, whitespace(scalars[start]) { start = scalars.index(after: start) }
        while end != start { let previous = scalars.index(before: end); if !whitespace(scalars[previous]) { break }; end = previous }
        return String(scalars[start..<end])
    }
    private static func validateLink(_ text: String) throws {
        if text.isEmpty { return }
        let trimmed = trim(text)
        guard let url = URLComponents(string: trimmed), let scheme = url.scheme?.lowercased(), ["http", "https"].contains(scheme),
              url.host?.lowercased() == "log.weizaima.com", (url.user ?? "").isEmpty, (url.password ?? "").isEmpty,
              url.port == nil || (scheme == "http" && url.port == 80) || (scheme == "https" && url.port == 443),
              let key = url.queryItems?.first(where: { $0.name == "key" })?.value, !trim(key).isEmpty,
              url.percentEncodedFragment == nil || url.percentEncodedFragment?.removingPercentEncoding != nil else { throw LogbookFailure("表格含无效海豹链接、来源或key。") }
    }
    private func mergeParticipants(_ old: LogbookJSON, _ incoming: LogbookJSON) throws -> LogbookJSON {
        var module = old, kps: [String] = [], pairs: [LogbookJSON] = [], seen = Set<Data>(), pairSeen = Set<Data>()
        for name in (old["kps"] as! [String]) + (incoming["kps"] as! [String]) {
            let name = Self.trim(name); if !name.isEmpty, seen.insert(Data(name.utf8)).inserted { kps.append(name) }
        }
        for pair in (old["pairs"] as! [LogbookJSON]) + (incoming["pairs"] as! [LogbookJSON]) {
            let pc = pair["pc"] as! String, pl = pair["pl"] as! String
            let key = Data((pc + "\0" + pl).utf8)
            if (!pc.isEmpty || !pl.isEmpty), pairSeen.insert(key).inserted { pairs.append(pair) }
        }
        module["kps"] = kps; module["pairs"] = pairs; return module
    }
    private func applyRow(_ row: LogbookJSON) throws {
        try LogbookValidation.shape(row, "sheet,moduleName,sessionName,link,kps,pairs", "manualContent,playStatus,status,playDate,fetchedAt")
        try LogbookValidation.strings(row, "sheet,moduleName,sessionName,link,manualContent,playStatus,status,playDate,fetchedAt")
        guard let name = row["moduleName"] as? String, !Self.trim(name).isEmpty, row["kps"] is [String], let pairs = row["pairs"] as? [LogbookJSON],
              let sessionName = row["sessionName"] as? String, let link = row["link"] as? String else { throw LogbookFailure("表格模组、场次或参与者字段无效。") }
        for pair in pairs { try LogbookValidation.shape(pair, "pc,pl"); try LogbookValidation.strings(pair, "pc,pl") }
        if let status = row["playStatus"] as? String, !["not_started", "running", "finished"].contains(status) { throw LogbookFailure("表格跑团状态无效。") }
        if let status = row["status"] as? String, !["pending", "valid", "fetch_failed", "manual"].contains(status) { throw LogbookFailure("表格链接状态无效。") }
        if let fetched = row["fetchedAt"] as? String, fetched.range(of: "^\\d{4}-\\d{2}-\\d{2}T", options: .regularExpression) == nil { throw LogbookFailure("表格抓取时间无效。") }
        try Self.validateLink(link)
        let date = logbookNow(), existing = try index.rows("SELECT value,position,changed FROM entities WHERE kind='modules' AND name=? ORDER BY position LIMIT 1", [Self.indexKey(name)]).first
        var module: LogbookJSON
        let modulePosition: Int, moduleChange: Int
        if let existing {
            module = try mergeParticipants(logbookObject(index.unpack(existing[0]!)), row); modulePosition = Int(existing[1]!)!; moduleChange = existing[2] == "1" ? 1 : 2
        } else {
            modulePosition = moduleTotal; moduleTotal += 1; moduleChange = 1
            module = ["id": UUID().uuidString.lowercased(), "name": name, "playStatus": row["playStatus"] ?? "not_started", "kps": row["kps"]!, "pairs": pairs, "order": modulePosition, "collapsed": false, "createdAt": date, "updatedAt": date]
            try index.execute("INSERT INTO module_counts VALUES(?,0)", [module["id"] as? String])
        }
        try LogbookValidation.module(module); try put("modules", module, position: modulePosition, changed: moduleChange)
        let moduleID = module["id"] as! String, manual = row["manualContent"] as? String
        let explicit = manual?.unicodeScalars.contains(where: { !Self.whitespace($0) }) == true
        var matching: [[String?]] = []
        if explicit { matching = try index.rows("SELECT value,position,changed FROM entities WHERE kind='records' AND module=? AND name=? AND source='manual'" + (link.isEmpty ? "" : " AND link=?") + " ORDER BY position LIMIT 2", [moduleID, Self.indexKey(sessionName)] + (link.isEmpty ? [] : [Self.indexKey(link)])) }
        if matching.count == 1 {
            let found = matching[0]; var record = try logbookObject(index.unpack(found[0]!)); record["updatedAt"] = date
            if let playDate = row["playDate"] as? String, !playDate.isEmpty { record["playDate"] = playDate; record["dateSource"] = "manual" }
            record["manualContent"] = manual!; try LogbookValidation.record(record)
            try put("records", record, position: Int(found[1]!)!, changed: found[2] == "1" ? 1 : 2, manual: manual)
            updated += 1; try note("names", name + " / " + (record["name"] as! String)); try note("warnings", (record["name"] as! String) + "：将更新已有同名手动场次正文，确认后生效。")
            return
        }
        if !link.isEmpty, try index.count("SELECT EXISTS(SELECT 1 FROM entities WHERE kind='records' AND module=? AND link=?)", [moduleID, Self.indexKey(link)]) > 0 {
            skipped += 1; try note("warnings", sessionName + "：来源已存在，已跳过。"); return
        }
        let count = try index.count("SELECT value FROM module_counts WHERE id=?", [moduleID]), position = recordTotal
        let online = !link.isEmpty && !explicit, playDate = row["playDate"] as? String ?? ""
        var record: LogbookJSON = ["id": UUID().uuidString.lowercased(), "moduleId": moduleID, "name": sessionName.isEmpty ? "第\(count + 1)场" : sessionName, "sequenceNo": count + 1, "sourceType": online ? "online" : "manual", "status": online ? "pending" : "manual", "dateSource": playDate.isEmpty ? "none" : "manual", "order": count, "createdAt": date, "updatedAt": date]
        if !link.isEmpty { record["link"] = link }; if !playDate.isEmpty { record["playDate"] = playDate }
        let body: String? = explicit ? manual : link.isEmpty ? "" : nil
        if let body { record["manualContent"] = body }
        try LogbookValidation.record(record)
        try put("records", record, position: position, changed: 1, manual: body); added += 1; recordTotal += 1
        try index.execute("UPDATE module_counts SET value=value+1 WHERE id=?", [moduleID])
        try note("names", name + " / " + (record["name"] as! String))
    }
    private func applyCharacter(_ value: LogbookJSON, warnings: [String]) throws {
        try LogbookValidation.character(value)
        guard let id = value["id"] as? String, !id.isEmpty, try index.count("SELECT COUNT(*) FROM entities WHERE kind='characters' AND id=?", [id]) == 0 else { throw LogbookFailure("角色标识无效或重复。") }
        let links = value["moduleIds"] as! [String]
        guard Set(links).count == links.count else { throw LogbookFailure("角色模组关联重复。") }
        for link in links + ([value["moduleId"] as? String].compactMap { $0 }) {
            guard try index.count("SELECT COUNT(*) FROM entities WHERE kind='modules' AND id=?", [link]) == 1 else { throw LogbookFailure("角色模组关联缺失。") }
        }
        try put("characters", value, position: characterTotal, changed: 1)
        characterTotal += 1; added += 1; try note("names", (value["basic"] as! LogbookJSON)["name"] as! String)
        for warning in warnings { try note("warnings", warning) }
    }
    func preview(_ proof: LogbookBackupProof, store: LogbookStore) throws -> LogbookJSON {
        guard memorySnapshot == nil, !closed, !ready, stringsLine.isEmpty, let sourceProof, candidate != nil, proof.bytes == candidate.bytes else { throw LogbookFailure("表格来源或候选尚未完整。") }
        try store.check(expected); try source.seal(); try candidate.seal(); try verify(source.url, sourceProof); try verify(candidate.url, proof)
        var baseline = try store.metadata() ?? LogbookStore.empty()
        try LogbookValidation.snapshot(baseline, metadataOnly: true)
        try index.execute("BEGIN")
        do {
            for kind in ["modules", "characters", "records"] {
                for (position, value) in (baseline[kind] as! [LogbookJSON]).enumerated() { try put(kind, value, position: position, changed: 0) }
            }
            moduleTotal = (baseline["modules"] as! [LogbookJSON]).count; recordTotal = (baseline["records"] as! [LogbookJSON]).count; characterTotal = (baseline["characters"] as! [LogbookJSON]).count
            try index.execute("INSERT INTO module_counts SELECT id,0 FROM entities WHERE kind='modules'")
            try index.execute("UPDATE module_counts SET value=(SELECT COUNT(*) FROM entities WHERE kind='records' AND module=module_counts.id)")
            baseline["records"] = [LogbookJSON](); baseline.removeValue(forKey: "modules"); baseline.removeValue(forKey: "characters"); root = baseline
            let input = try FileHandle(forReadingFrom: candidate.url); defer { try? input.close() }
            var pending = Data()
            while let chunk = try input.read(upToCount: 65536), !chunk.isEmpty {
                try Self.lines(chunk, pending: &pending) { line in
                    guard let prefix = line.first, (self.kind == "record-table" && prefix == 84) || (self.kind == "character-table" && prefix == 67) else { throw LogbookFailure("表格候选类型不一致。") }
                    let value = try LogbookBackupJSON.object(Data(line.dropFirst()))
                    try LogbookValidation.shape(value, "sheetOrder,rowOrder,value", prefix == 67 ? "warnings" : "")
                    guard let sheet = value["sheetOrder"] as? NSNumber, LogbookValidation.number(sheet), sheet.doubleValue >= 0, sheet.doubleValue < 9007199254740991, sheet.doubleValue.rounded(.down) == sheet.doubleValue,
                          let row = value["rowOrder"] as? NSNumber, LogbookValidation.number(row), row.doubleValue >= 0, row.doubleValue < 9007199254740991, row.doubleValue.rounded(.down) == row.doubleValue,
                          let object = value["value"] as? LogbookJSON, value["warnings"] == nil || value["warnings"] is [String] else { throw LogbookFailure("表格工作表、行号或候选值无效。") }
                    let key = sheet.stringValue + ":" + row.stringValue
                    try self.index.execute("INSERT INTO frames VALUES(?,?,?,?,?)", [sheet.stringValue, row.stringValue, prefix == 84 ? "T" : "C", try self.index.pack(logbookText(object), key: "frame:" + key), try self.index.pack(logbookText(value["warnings"] ?? [String]()), key: "warnings:" + key)])
                }
                try LogbookCapacity.require(available: available, additional: LogbookCapacity.estimate(chunk.count, copies: 3))
            }
            guard pending.isEmpty else { throw LogbookFailure("表格候选末行不完整。") }
            try index.each("SELECT kind,value,warnings FROM frames ORDER BY sheet,row") { row in
                if row[0] == "T" { try self.applyRow(logbookObject(self.index.unpack(row[1]!))) }
                else {
                    guard let warnings = try JSONSerialization.jsonObject(with: Data(self.index.unpack(row[2]!).utf8)) as? [String] else { throw LogbookFailure("角色导入提醒无效。") }
                    try self.applyCharacter(logbookObject(self.index.unpack(row[1]!)), warnings: warnings)
                }
                try LogbookCapacity.require(available: self.available, additional: 0)
            }
            guard added + updated > 0 else { throw LogbookFailure("没有可新增的有效数据。") }
            try index.execute("COMMIT")
        } catch { try? index.execute("ROLLBACK"); throw error }
        try index.freeze(); candidateProof = proof
        indexProof = try LogbookBackupSession.fileProof(directory.appendingPathComponent("index.sqlite"), maximumBytes: try LogbookCapacity.maximum(available: available, copies: 1) + stageBytes + source.bytes)
        ready = true
        return ["id": id, "revision": expected, "added": added, "updated": updated, "skipped": skipped, "namesCount": namesCount, "warningsCount": warningsCount,
                "names": try page("names", offset: 0, limit: 100)["values"]!, "warnings": try page("warnings", offset: 0, limit: 100)["values"]!]
    }
    func page(_ kind: String, offset: Int, limit: Int) throws -> LogbookJSON {
        guard ready, !closed, ["names", "warnings"].contains(kind), offset >= 0, limit > 0 else { throw LogbookFailure("表格预览分页无效。") }
        let values = try index.rows("SELECT value FROM preview WHERE kind=? ORDER BY position LIMIT ? OFFSET ?", [kind, String(min(100, limit)), String(offset)]).map { try index.unpackString($0[0]!) }
        return ["values": values, "total": kind == "names" ? namesCount : warningsCount]
    }
    func prepareCommit(store: LogbookStore) throws {
        guard ready, !closed, !unlinked, let sourceProof, let candidateProof, let indexProof else { throw LogbookFailure("表格预览尚未完成。") }
        try store.check(expected); try verify(source.url, sourceProof); try verify(candidate.url, candidateProof)
        try verify(directory.appendingPathComponent("index.sqlite"), indexProof)
        try LogbookCapacity.require(available: store.available, additional: LogbookCapacity.estimate(candidateProof.bytes, copies: 5))
        // Apple's SQLite VFS may still consult the original path, even with
        // immutable=1. Freeze the validated rows into ordinary sequential files
        // before unlinking; plain FileHandle descriptors survive that cleanup.
        let metadata = try Output(directory.appendingPathComponent("commit-metadata"))
        let records = try Output(directory.appendingPathComponent("commit-records"))
        func append(_ value: LogbookJSON, kind: String, position: Int, changed: Int, to output: Output) throws {
            let bytes = try logbookData(["kind": kind, "position": position, "changed": changed, "value": value]) + Data([10])
            try LogbookCapacity.require(available: available, additional: bytes.count)
            guard let handle = output.handle else { throw LogbookFailure("表格提交暂存已封存。") }
            for start in stride(from: 0, to: bytes.count, by: LogbookLimits.transferChunkBytes) {
                try handle.write(contentsOf: bytes.subdata(in: start..<min(bytes.count, start + LogbookLimits.transferChunkBytes)))
            }
            output.bytes += bytes.count
        }
        for kind in ["modules", "characters", "records"] {
            try eachEntity(kind, bodies: false) { value, position, changed in try append(value, kind: kind, position: position, changed: changed, to: metadata) }
        }
        try eachEntity("records") { value, position, changed in try append(value, kind: "records", position: position, changed: changed, to: records) }
        try metadata.seal(); try records.seal()
        commitMetadataProof = try LogbookBackupSession.fileProof(metadata.url, maximumBytes: metadata.bytes)
        commitRecordsProof = try LogbookBackupSession.fileProof(records.url, maximumBytes: records.bytes)
        try verify(directory.appendingPathComponent("index.sqlite"), indexProof)
        commitMetadata = try FileHandle(forReadingFrom: metadata.url); commitRecords = try FileHandle(forReadingFrom: records.url)
        index.close()
        // No cleanup capable of failing follows the production COMMIT.
        try Self.removeOwned(directory, id: id); unlinked = true
    }
    func requireCommitReady() throws {
        guard ready, unlinked, !closed else { throw LogbookFailure("表格提交证明与暂存清理尚未完成。") }
    }
    func eachEntity(_ kind: String, changedOnly: Bool = false, bodies: Bool = true, _ receive: (LogbookJSON, Int, Int) throws -> Void) throws {
        guard ready, !closed else { throw LogbookFailure("表格索引尚未封存。") }
        if unlinked {
            let full = kind == "records" && bodies
            guard let input = full ? commitRecords : commitMetadata, let proof = full ? commitRecordsProof : commitMetadataProof else { throw LogbookFailure("表格提交暂存缺失。") }
            try input.seek(toOffset: 0)
            var pending = Data(), hash = SHA256(), total = 0
            while let chunk = try input.read(upToCount: 65536), !chunk.isEmpty {
                guard chunk.count <= proof.bytes - total else { throw LogbookFailure("表格提交暂存长度已变化。") }
                total += chunk.count; hash.update(data: chunk)
                try Self.lines(chunk, pending: &pending) { bytes in
                    try autoreleasepool {
                        let row = try LogbookBackupJSON.object(bytes)
                        try LogbookValidation.shape(row, "kind,position,changed,value")
                        guard let rowKind = row["kind"] as? String, ["modules", "characters", "records"].contains(rowKind),
                              let position = row["position"] as? Int, position >= 0, let changed = row["changed"] as? Int, (0...2).contains(changed),
                              let value = row["value"] as? LogbookJSON else { throw LogbookFailure("表格提交暂存结构无效。") }
                        if rowKind == kind && (!changedOnly || changed != 0) { try receive(value, position, changed) }
                    }
                }
            }
            guard pending.isEmpty else { throw LogbookFailure("表格提交暂存末行不完整。") }
            try proof.matches(bytes: total, sha256: hash.finalize().map { String(format: "%02x", $0) }.joined())
            return
        }
        try index.each("SELECT value," + (bodies ? "manual" : "NULL") + ",position,changed FROM entities WHERE kind=?" + (changedOnly ? " AND changed<>0" : "") + " ORDER BY position", [kind]) { row in
            var value = try logbookObject(self.index.unpack(row[0]!)); if let manual = row[1] { value["manualContent"] = try self.index.unpackString(manual) }
            try receive(value, Int(row[2]!)!, Int(row[3]!)!)
        }
    }
    func close() throws {
        if closed { return }
        try source?.seal(); try candidate?.seal(); index?.close()
        try? commitMetadata?.close(); commitMetadata = nil
        try? commitRecords?.close(); commitRecords = nil
        if ownershipEstablished && !unlinked { try Self.removeOwned(directory, id: id) }
        memorySnapshot = nil
        closed = true
    }
    private static func removeOwned(_ directory: URL, id: String) throws {
        guard FileManager.default.fileExists(atPath: directory.path) else { return }
        guard directory.lastPathComponent == "table-" + id,
              try directory.resourceValues(forKeys: [.isSymbolicLinkKey]).isSymbolicLink != true else { throw LogbookFailure("表格私有目录引用无效。") }
        let marker = directory.appendingPathComponent("owner.json")
        guard try marker.resourceValues(forKeys: [.isSymbolicLinkKey]).isSymbolicLink != true,
              let length = try marker.resourceValues(forKeys: [.fileSizeKey]).fileSize, length < 1024,
              let value = try JSONSerialization.jsonObject(with: Data(contentsOf: marker)) as? LogbookJSON,
              value["kind"] as? String == "coc-table-stream-v1", value["id"] as? String == id else { throw LogbookFailure("表格暂存所有权标记不符，未删除文件。") }
        let files = try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: [.isSymbolicLinkKey])
        let allowed = Set(["owner.json", "source", "candidate", "index.sqlite", "index.sqlite-journal", "index.sqlite-wal", "index.sqlite-shm", "commit-metadata", "commit-records"])
        for file in files {
            guard allowed.contains(file.lastPathComponent), file.resolvingSymlinksInPath().deletingLastPathComponent() == directory.resolvingSymlinksInPath(),
                  try file.resourceValues(forKeys: [.isSymbolicLinkKey]).isSymbolicLink != true else { throw LogbookFailure("表格暂存目录含未知文件，未清理。") }
        }
        for file in files where file.lastPathComponent != "owner.json" { try FileManager.default.removeItem(at: file) }
        try FileManager.default.removeItem(at: marker); try FileManager.default.removeItem(at: directory)
    }
    static func cleanupStale(_ directory: URL) throws {
        guard FileManager.default.fileExists(atPath: directory.path) else { return }
        for file in try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: [.isDirectoryKey]) {
            guard file.lastPathComponent.range(of: "^table-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$", options: .regularExpression) != nil,
                  try file.resourceValues(forKeys: [.isDirectoryKey]).isDirectory == true else { continue }
            try removeOwned(file, id: String(file.lastPathComponent.dropFirst(6)))
        }
    }
}
