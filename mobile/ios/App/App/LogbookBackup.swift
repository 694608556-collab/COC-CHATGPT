import Foundation
import CryptoKit
import Darwin

/// Simulator processes may have no jetsam application budget. Real devices
/// must retain zero-headroom fallback; host pages are advisory only in simulator.
enum LogbookSearchMemory {
    static func available(process: UInt64, simulator: Bool) -> Int {
        available(process: process, simulator: simulator, host: hostAvailable)
    }
    static func available(process: UInt64, simulator: Bool, host: () -> UInt64) -> Int {
        if process > 0 { return Int(min(process, UInt64(Int.max))) }
        guard simulator else { return 0 }
        return Int(min(host(), min(ProcessInfo.processInfo.physicalMemory / 4, UInt64(Int.max))))
    }
    private static func hostAvailable() -> UInt64 {
        let port = mach_host_self()
        defer { mach_port_deallocate(mach_task_self_, port) }
        var page: vm_size_t = 0
        guard host_page_size(port, &page) == KERN_SUCCESS else { return 0 }
        var stats = vm_statistics64_data_t()
        var count = mach_msg_type_number_t(MemoryLayout<vm_statistics64_data_t>.size / MemoryLayout<integer_t>.size)
        let status = withUnsafeMutablePointer(to: &stats) {
            $0.withMemoryRebound(to: integer_t.self, capacity: Int(count)) { host_statistics64(port, HOST_VM_INFO64, $0, &count) }
        }
        guard status == KERN_SUCCESS else { return 0 }
        // Inactive pages are reclaimable host resources; the admission budget
        // remains capped to one quarter of physical RAM and is simulator-only.
        let pages = UInt64(stats.free_count) + UInt64(stats.speculative_count) + UInt64(stats.inactive_count)
        let bytes = pages.multipliedReportingOverflow(by: UInt64(page))
        return bytes.overflow ? 0 : bytes.partialValue
    }
}

/// Optional numeric-only phase measurements; no source text or credentials.
final class LogbookSearchTiming {
    private let lock = NSLock()
    private(set) var values: [String: Double] = [:]
    func elapsed(_ key: String, _ started: TimeInterval) {
        lock.lock(); defer { lock.unlock() }
        values[key, default: 0] += (ProcessInfo.processInfo.systemUptime - started) * 1000
    }
}

/// Both independent readbacks finish before an error reaches owner cleanup.
private final class LogbookSearchReadbackFailures {
    private let lock = NSLock()
    private var failure: Error?
    func record(_ error: Error) { lock.lock(); defer { lock.unlock() }; if failure == nil { failure = error } }
    func check() throws { lock.lock(); defer { lock.unlock() }; if let failure { throw failure } }
}

/// An acceleration admission failure requests the complete original stream,
/// never a content-size rejection or permission/validation bypass.
struct LogbookSearchUnavailable: Error {}

/// Strict decoded duplicate-key checks before Foundation parses one bounded
/// candidate line. JSONSerialization supplies the complete grammar/UTF-8 check.
enum LogbookBackupJSON {
    /// Foundation accepts some non-standard JSON (including trailing commas).
    /// Validate complete strict grammar before constructing one bounded object.
    static func object(_ data: Data) throws -> LogbookJSON {
        try data.withUnsafeBytes { (raw: UnsafeRawBufferPointer) throws -> Void in
            let bytes = raw.bindMemory(to: UInt8.self)
            var index = 0
            func invalid() -> LogbookFailure { LogbookFailure("恢复JSON语法、UTF-8或重复字段无效。") }
            func whitespace() { while index < bytes.count && (bytes[index] == 32 || bytes[index] == 9 || bytes[index] == 10 || bytes[index] == 13) { index += 1 } }
            func take(_ byte: UInt8) throws { guard index < bytes.count, bytes[index] == byte else { throw invalid() }; index += 1 }
            func digit(_ byte: UInt8) -> Bool { byte >= 48 && byte <= 57 }
            func hex(_ byte: UInt8) -> Bool { digit(byte) || (byte >= 65 && byte <= 70) || (byte >= 97 && byte <= 102) }
            func string() throws -> Range<Int> {
                let start = index; try take(34)
                while index < bytes.count {
                    let byte = bytes[index]; index += 1
                    if byte == 34 { return start..<index }
                    guard byte >= 32 else { throw invalid() }
                    if byte == 92 {
                        guard index < bytes.count else { throw invalid() }
                        let escaped = bytes[index]; index += 1
                        if escaped == 117 {
                            for _ in 0..<4 { guard index < bytes.count, hex(bytes[index]) else { throw invalid() }; index += 1 }
                        } else if ![34, 92, 47, 98, 102, 110, 114, 116].contains(escaped) { throw invalid() }
                    } else if byte >= 128 {
                        let count: Int
                        if byte >= 194 && byte <= 223 { count = 1 }
                        else if byte >= 224 && byte <= 239 { count = 2 }
                        else if byte >= 240 && byte <= 244 { count = 3 }
                        else { throw invalid() }
                        guard index + count <= bytes.count else { throw invalid() }
                        let first = bytes[index]
                        if (byte == 224 && first < 160) || (byte == 237 && first >= 160) || (byte == 240 && first < 144) || (byte == 244 && first >= 144) { throw invalid() }
                        for _ in 0..<count { guard bytes[index] >= 128 && bytes[index] <= 191 else { throw invalid() }; index += 1 }
                    }
                }
                throw invalid()
            }
            func number() throws {
                if bytes[index] == 45 { index += 1 }
                guard index < bytes.count else { throw invalid() }
                if bytes[index] == 48 { index += 1 }
                else {
                    guard bytes[index] >= 49 && bytes[index] <= 57 else { throw invalid() }
                    while index < bytes.count && digit(bytes[index]) { index += 1 }
                }
                if index < bytes.count && bytes[index] == 46 {
                    index += 1; guard index < bytes.count, digit(bytes[index]) else { throw invalid() }
                    while index < bytes.count && digit(bytes[index]) { index += 1 }
                }
                if index < bytes.count && (bytes[index] == 69 || bytes[index] == 101) {
                    index += 1
                    if index < bytes.count && (bytes[index] == 43 || bytes[index] == 45) { index += 1 }
                    guard index < bytes.count, digit(bytes[index]) else { throw invalid() }
                    while index < bytes.count && digit(bytes[index]) { index += 1 }
                }
            }
            func value(_ depth: Int) throws {
                whitespace(); guard index < bytes.count else { throw invalid() }
                let byte = bytes[index]
                if byte == 123 {
                    guard depth < 256 else { throw invalid() }; index += 1; whitespace()
                    if index < bytes.count && bytes[index] == 125 { index += 1; return }
                    var keys = Set<String>()
                    while true {
                        whitespace(); let span = try string()
                        let key: String
                        if bytes[span].contains(92) {
                            guard let decoded = try JSONSerialization.jsonObject(with: Data(bytes[span]), options: [.fragmentsAllowed]) as? String else { throw invalid() }
                            key = decoded
                        } else { key = String(decoding: bytes[(span.lowerBound + 1)..<(span.upperBound - 1)], as: UTF8.self) }
                        guard keys.insert(key).inserted else { throw invalid() }
                        whitespace(); try take(58); try value(depth + 1); whitespace()
                        if index < bytes.count && bytes[index] == 125 { index += 1; return }
                        try take(44)
                    }
                } else if byte == 91 {
                    guard depth < 256 else { throw invalid() }; index += 1; whitespace()
                    if index < bytes.count && bytes[index] == 93 { index += 1; return }
                    while true {
                        try value(depth + 1); whitespace()
                        if index < bytes.count && bytes[index] == 93 { index += 1; return }
                        try take(44)
                    }
                } else if byte == 34 { _ = try string() }
                else if byte == 45 || digit(byte) { try number() }
                else if byte == 116 { for expected in [UInt8(116), 114, 117, 101] { try take(expected) } }
                else if byte == 102 { for expected in [UInt8(102), 97, 108, 115, 101] { try take(expected) } }
                else if byte == 110 { for expected in [UInt8(110), 117, 108, 108] { try take(expected) } }
                else { throw invalid() }
            }
            try value(0); whitespace(); guard index == bytes.count else { throw invalid() }
        }
        guard let object = try JSONSerialization.jsonObject(with: data) as? LogbookJSON else { throw LogbookFailure("恢复JSON必须为对象。") }
        return object
    }

    /// Extract only the two already-validated top-level body values. Their raw
    /// numeric/escape spelling must survive restoration into the v1 body column.
    static func body(_ data: Data) throws -> String {
        let fields = try members(data, selected: ["rawContent", "manualContent"])
        return "{" + fields.keys.sorted().map { "\"" + $0 + "\":" + String(decoding: fields[$0]!, as: UTF8.self) }.joined(separator: ",") + "}"
    }
    static func replacingManual(_ data: Data, manual: String) throws -> String {
        let raw = try members(data, selected: ["rawContent"])["rawContent"]
        let patch = try logbookText(["manualContent": manual])
        guard let raw else { return patch }
        return "{\"rawContent\":" + String(decoding: raw, as: UTF8.self) + "," + String(patch.dropFirst())
    }
    static func singleRecord(_ data: Data) throws -> Data {
        guard let records = try members(data, selected: ["records"])["records"], records.first == 91, records.last == 93 else { throw LogbookFailure("暂存缺少完整场次数组。") }
        return Data(records.dropFirst().dropLast())
    }
    private static func members(_ data: Data, selected: Set<String>) throws -> [String: Data] {
        let ranges = try memberRanges(data, selected: selected)
        return data.withUnsafeBytes { raw in
            let bytes = raw.bindMemory(to: UInt8.self)
            return ranges.mapValues { Data(bytes[$0]) }
        }
    }
    /// Validate every original body byte, then replace only the raw log with
    /// complete searchable tuples. Original manual/unknown spans remain exact.
    static func searchBody(_ data: Data, budget: Int) throws -> Data? {
        guard budget > 0, data.count <= budget / 8 else { return nil }
        var count = 0
        let pointer = data.withUnsafeBytes { raw in
            coc_search_json_body(raw.bindMemory(to: UInt8.self).baseAddress, data.count, UInt64(budget / 3), &count)
        }
        guard let pointer else { return nil }
        guard count >= 2, count <= data.count else { free(pointer); return nil }
        // The C ABI transfers malloc ownership; Data releases it exactly once.
        return Data(bytesNoCopy: pointer, count: count, deallocator: .free)
    }

    private static func memberRanges(_ data: Data, selected: Set<String>) throws -> [String: Range<Int>] {
        try data.withUnsafeBytes { (raw: UnsafeRawBufferPointer) throws -> [String: Range<Int>] in
            let bytes = raw.bindMemory(to: UInt8.self)
            func space(_ start: Int) -> Int { var at = start; while at < bytes.count && [9, 10, 13, 32].contains(bytes[at]) { at += 1 }; return at }
            func stringEnd(_ start: Int) throws -> Int {
                guard start < bytes.count, bytes[start] == 34 else { throw LogbookFailure("正文词元字段无效。") }
                var at = start + 1
                while at < bytes.count { let char = bytes[at]; at += 1; if char == 92 { at += 1 } else if char == 34 { return at } }
                throw LogbookFailure("正文词元字符串不完整。")
            }
            func end(_ start: Int) throws -> Int {
                var at = space(start)
                guard at < bytes.count else { throw LogbookFailure("正文词元缺失。") }
                if bytes[at] == 34 { return try stringEnd(at) }
                if bytes[at] == 123 || bytes[at] == 91 {
                    var depth = 0
                    while at < bytes.count {
                        let char = bytes[at]
                        if char == 34 { at = try stringEnd(at); continue }
                        if char == 123 || char == 91 { depth += 1 }
                        if char == 125 || char == 93 { depth -= 1; if depth == 0 { return at + 1 } }
                        at += 1
                    }
                    throw LogbookFailure("正文词元结构不完整。")
                }
                while at < bytes.count && ![9, 10, 13, 32, 44, 93, 125].contains(bytes[at]) { at += 1 }
                return at
            }
            var at = space(0), fields: [String: Range<Int>] = [:]
            guard at < bytes.count, bytes[at] == 123 else { throw LogbookFailure("正文词元对象无效。") }; at += 1
            while true {
                at = space(at); guard at < bytes.count else { throw LogbookFailure("正文词元字段不完整。") }
                if bytes[at] == 125 { break }
                let keyEnd = try stringEnd(at), keyData = Data(bytes[at..<keyEnd])
                guard let key = try JSONSerialization.jsonObject(with: keyData, options: [.fragmentsAllowed]) as? String else { throw LogbookFailure("正文词元字段名无效。") }
                at = space(keyEnd); guard at < bytes.count, bytes[at] == 58 else { throw LogbookFailure("正文词元字段分隔无效。") }; at = space(at + 1)
                let until = try end(at)
                if selected.contains(key) { fields[key] = at..<until }
                at = space(until); guard at < bytes.count else { throw LogbookFailure("正文词元对象不完整。") }
                if bytes[at] == 125 { break }
                guard bytes[at] == 44 else { throw LogbookFailure("正文词元字段分隔无效。") }; at += 1
            }
            return fields
        }
    }
}

struct LogbookBackupProof {
    let bytes: Int
    let sha256: String
    /// Exact lowercase digest text without locale formatting or omitted zeros.
    static func hex<S: Sequence>(_ bytes: S) -> String where S.Element == UInt8 {
        let alphabet = Array("0123456789abcdef".utf8)
        var output: [UInt8] = []; output.reserveCapacity(64)
        for byte in bytes { output.append(alphabet[Int(byte >> 4)]); output.append(alphabet[Int(byte & 15)]) }
        return String(decoding: output, as: UTF8.self)
    }
    func matches(bytes: Int, sha256: String) throws {
        guard self.bytes == bytes, self.sha256 == sha256 else { throw LogbookFailure("备份文件完整长度或摘要不符。") }
    }
}

enum LogbookRestoreCandidate {
    struct Preview { let metadata: LogbookJSON; let offlineRecords: Int; let proof: LogbookBackupProof }
    /// R<complete record>LF repeated, then M<bodyless complete metadata>LF.
    /// Callback may only stage privately or write inside a rollback-capable CAS
    /// transaction after a complete first inspection. No partial publication.
    static func inspect(_ input: FileHandle, proof: LogbookBackupProof,
                        rawEach: ((LogbookJSON, Data, Int) throws -> Void)? = nil,
                        each: ((LogbookJSON, Int) throws -> Void)? = nil) throws -> Preview {
        var hash = SHA256(), total = 0, line = Data(), rows: [LogbookJSON] = []
        var metadata: LogbookJSON?, offline = 0
        let newline = Data([10])
        func consume() throws {
            guard line.count > 1, metadata == nil else { throw LogbookFailure("恢复候选顺序或单场数据无效。") }
            let kind = line.first!, json = Data(line.dropFirst()), value = try LogbookBackupJSON.object(json)
            if kind == 82 {
                try LogbookValidation.record(value)
                var row = value
                row.removeValue(forKey: "rawContent"); row.removeValue(forKey: "manualContent")
                if value["rawContent"] != nil || (value["sourceType"] as? String == "manual" && !(value["manualContent"] as? String ?? "").isEmpty) { offline += 1 }
                try each?(value, rows.count)
                try rawEach?(value, json, rows.count)
                rows.append(row)
            } else if kind == 77 {
                try LogbookValidation.snapshot(value, metadataOnly: true)
                guard let expected = value["records"] as? [LogbookJSON], expected.allSatisfy({ $0["rawContent"] == nil && $0["manualContent"] == nil }),
                      try logbookData(expected) == logbookData(rows) else { throw LogbookFailure("恢复场次未取齐、重复或元数据不符。") }
                metadata = value
            } else { throw LogbookFailure("恢复候选协议版本无效。") }
            line.removeAll(keepingCapacity: true)
        }
        while let chunk = try input.read(upToCount: 65536), !chunk.isEmpty {
            total += chunk.count
            guard total <= proof.bytes else { throw LogbookFailure("恢复候选长度已变化。") }
            hash.update(data: chunk)
            var start = chunk.startIndex
            while let range = chunk.range(of: newline, in: start..<chunk.endIndex) {
                line.append(chunk.subdata(in: start..<range.lowerBound)); try consume(); start = range.upperBound
            }
            line.append(chunk.subdata(in: start..<chunk.endIndex))
        }
        let digest = LogbookBackupProof.hex(hash.finalize())
        guard line.isEmpty, let metadata else { throw LogbookFailure("恢复候选不完整。") }
        try proof.matches(bytes: total, sha256: digest)
        return Preview(metadata: metadata, offlineRecords: offline, proof: proof)
    }
}

/// Native-owned private operation. File names never come from bridge paths;
/// no method grants database or external document publication authority.
final class LogbookBackupSession {
    private final class Entry {
        let url: URL
        var output: FileHandle?
        var bytes = 0, index = 0
        var proof: LogbookBackupProof?
        init(url: URL) throws {
            self.url = url
            try Data().write(to: url, options: [.withoutOverwriting])
            do { output = try FileHandle(forWritingTo: url) }
            catch { try FileManager.default.removeItem(at: url); throw error }
        }
        func seal(readBufferBytes: Int = 65536) throws {
            if let output { try output.synchronize(); try output.close(); self.output = nil }
            let actual = try LogbookBackupSession.fileProof(url, maximumBytes: bytes, readBufferBytes: readBufferBytes)
            guard actual.bytes == bytes else { throw LogbookFailure("备份暂存长度不完整。") }
            proof = actual
        }
    }
    let id = UUID().uuidString.lowercased()
    let expected: Int
    let bookmark: Data
    let restoring: Bool
    let includeArchives: Bool
    let searching: Bool
    let available: () throws -> Int
    private let directory: URL
    private let maximumInputBytes: Int
    private var inputBytes = 0, outputBytes = 0, maximumOutputBytes = 0
    private var ready = false, closed = false
    private var entries: [String: Entry] = [:]
    struct Attachment { let key: String; let name: String; let mime: String; let proof: LogbookBackupProof }
    private(set) var restorePreview: LogbookRestoreCandidate.Preview?
    private(set) var attachments: [Attachment] = []
    init(directory: URL, expected: Int, bookmark: Data, restoring: Bool, includeArchives: Bool, searching: Bool = false,
         available: (() throws -> Int)? = nil) throws {
        self.directory = directory; self.expected = expected; self.bookmark = bookmark
        self.restoring = restoring; self.includeArchives = includeArchives; self.searching = searching
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        self.available = available ?? { try LogbookCapacity.available(directory) }
        for file in try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)
            where file.lastPathComponent.range(of: "^coc-backup-[a-f0-9-]+-[0-9]+\\.part$", options: .regularExpression) != nil {
            try Self.delete(file)
        }
        maximumInputBytes = try LogbookCapacity.maximum(available: self.available, copies: restoring ? 6 : searching ? 2 : 3)
    }
    deinit { try? close() }
    func require(_ token: String?) throws { guard !closed, token == id else { throw LogbookFailure("备份暂存租约已失效。") } }
    private func create(_ key: String) throws -> Entry {
        if let entry = entries[key] { return entry }
        let entry = try Entry(url: directory.appendingPathComponent("coc-backup-\(id)-\(entries.count).part"))
        entries[key] = entry; return entry
    }
    func capture(_ key: String, input: FileHandle, expected: LogbookBackupProof? = nil) throws -> LogbookBackupProof {
        guard !closed, !ready, maximumOutputBytes == 0, key == "source" || key.hasPrefix("archive:"), entries[key] == nil else { throw LogbookFailure("备份来源阶段无效。") }
        let entry = try create(key)
        while let chunk = try input.read(upToCount: 65536), !chunk.isEmpty {
            guard inputBytes + chunk.count <= maximumInputBytes, let output = entry.output else { throw LogbookFailure("备份来源暂存空间不足。") }
            try LogbookCapacity.require(available: available, additional: chunk.count)
            try output.write(contentsOf: chunk); entry.bytes += chunk.count; inputBytes += chunk.count
        }
        try entry.seal()
        let proof = entry.proof!
        if let expected { try expected.matches(bytes: proof.bytes, sha256: proof.sha256) }
        return proof
    }
    func beginOutput() throws -> Int {
        guard !searching else { throw LogbookFailure("正文搜索来源只读，不能暂存输出或发布文件。") }
        guard !closed, !ready, entries["source"]?.proof != nil else { throw LogbookFailure("备份来源未封存。") }
        if maximumOutputBytes == 0 { maximumOutputBytes = try LogbookCapacity.maximum(available: available, copies: restoring ? 4 : 2) }
        return maximumOutputBytes
    }
    func captureJSON(_ producer: (_ write: (Data) throws -> Void) throws -> Void) throws -> LogbookBackupProof {
        guard !closed, !ready, maximumOutputBytes == 0, entries["source"] == nil else { throw LogbookFailure("备份来源阶段无效。") }
        let entry = try create("source")
        try producer { chunk in
            guard inputBytes + chunk.count <= maximumInputBytes, let output = entry.output else { throw LogbookFailure("完整备份来源暂存空间不足。") }
            try LogbookCapacity.require(available: available, additional: chunk.count)
            try output.write(contentsOf: chunk); entry.bytes += chunk.count; inputBytes += chunk.count
        }
        try entry.seal(); return entry.proof!
    }
    /// One SQLite snapshot feeds the complete original ledger and the read-only
    /// projection. Both files must match their independently hashed input bytes.
    func captureSearch(timing: LogbookSearchTiming? = nil, readBufferBytes: Int = 65536, _ producer: (_ original: (Data) throws -> Void, _ projection: (Data) throws -> Void) throws -> Void) throws -> (original: LogbookBackupProof, projection: LogbookBackupProof) {
        guard searching, !restoring, !includeArchives, !closed, !ready, maximumOutputBytes == 0,
              entries["source"] == nil, entries["search"] == nil else { throw LogbookFailure("只读搜索来源阶段无效。") }
        let original = try create("source"), projection = try create("search")
        var originalHash = SHA256(), projectionHash = SHA256()
        try producer({ chunk in
            guard !self.closed, chunk.count <= self.maximumInputBytes - original.bytes, let output = original.output else { throw LogbookFailure("完整搜索来源暂存空间不足。") }
            try LogbookCapacity.require(available: self.available, additional: chunk.count)
            try output.write(contentsOf: chunk); originalHash.update(data: chunk)
            original.bytes += chunk.count; self.inputBytes += chunk.count
        }, { chunk in
            guard !self.closed, chunk.count <= self.maximumInputBytes - projection.bytes, let output = projection.output else { throw LogbookFailure("搜索投影暂存空间不足。") }
            try LogbookCapacity.require(available: self.available, additional: chunk.count)
            try output.write(contentsOf: chunk); projectionHash.update(data: chunk); projection.bytes += chunk.count
        })
        // The producer has finished and each handle belongs to one task only.
        // Join both tasks before observing proofs, comparing input hashes,
        // returning credentials or allowing the caller to remove private files.
        let readbacks = DispatchGroup(), failures = LogbookSearchReadbackFailures()
        for (entry, key) in [(original, "sealOriginalMs"), (projection, "sealProjectionMs")] {
            readbacks.enter()
            DispatchQueue.global(qos: .userInitiated).async {
                let started = timing == nil ? 0 : ProcessInfo.processInfo.systemUptime
                defer { timing?.elapsed(key, started); readbacks.leave() }
                do { try entry.seal(readBufferBytes: readBufferBytes) } catch { failures.record(error) }
            }
        }
        readbacks.wait(); try failures.check()
        try original.proof!.matches(bytes: original.bytes, sha256: LogbookBackupProof.hex(originalHash.finalize()))
        try projection.proof!.matches(bytes: projection.bytes, sha256: LogbookBackupProof.hex(projectionHash.finalize()))
        return (original.proof!, projection.proof!)
    }
    var sourceBudget: Int { maximumInputBytes }
    func verifySources() throws {
        for (key, entry) in entries where key == "source" || key.hasPrefix("archive:") {
            guard let expected = entry.proof else { throw LogbookFailure("备份来源尚未封存。") }
            try verify(key, expected: expected)
        }
    }
    func append(key: String, index: Int, chunk: Data) throws {
        guard !closed, !ready, maximumOutputBytes > 0, key.utf8.count <= 4096, !key.contains("\0"),
              restoring ? (key == "candidate" || key.hasPrefix("zip:")) : key == "output" else { throw LogbookFailure("备份暂存条目标识无效。") }
        guard !chunk.isEmpty, chunk.count <= LogbookLimits.transferChunkBytes, outputBytes + chunk.count <= maximumOutputBytes else { throw LogbookFailure("备份暂存分段或可用空间不足。") }
        let entry = try create(key)
        guard let output = entry.output, entry.index == index else { throw LogbookFailure("备份暂存已封存或分段乱序。") }
        try LogbookCapacity.require(available: available, additional: chunk.count)
        try output.write(contentsOf: chunk); entry.bytes += chunk.count; entry.index += 1; outputBytes += chunk.count
    }
    func verify(_ key: String, expected: LogbookBackupProof) throws {
        if entries[key] == nil, key.hasPrefix("zip:"), expected.bytes == 0,
           expected.sha256 == "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" { _ = try create(key) }
        guard let entry = entries[key] else { throw LogbookFailure("备份暂存条目缺失。") }
        try entry.seal(); try expected.matches(bytes: entry.proof!.bytes, sha256: entry.proof!.sha256)
    }
    func proof(_ key: String) throws -> LogbookBackupProof {
        guard let proof = entries[key]?.proof else { throw LogbookFailure("备份来源未取齐。") }; return proof
    }
    func file(_ key: String) throws -> URL {
        guard let entry = entries[key], entry.output == nil else { throw LogbookFailure("备份来源未封存。") }; return entry.url
    }
    func finish(keeping: Set<String>) throws {
        guard !closed, !ready else { throw LogbookFailure("备份暂存状态无效。") }
        for (key, entry) in entries {
            if entry.output != nil { try entry.seal() }
            if !keeping.contains(key) { try Self.delete(entry.url) }
        }
        entries = entries.filter { keeping.contains($0.key) }; ready = true
    }
    func requireReady() throws { guard !closed, ready else { throw LogbookFailure("备份预览尚未完成。") } }
    static func requestProof(_ value: LogbookJSON) throws -> LogbookBackupProof {
        guard LogbookValidation.number(value["bytes"]), let bytes = value["bytes"] as? NSNumber,
              bytes.doubleValue >= 0, bytes.doubleValue <= 9007199254740991, bytes.doubleValue.rounded(.down) == bytes.doubleValue,
              let hash = value["sha256"] as? String, hash.count == 64, hash.allSatisfy({ "0123456789abcdef".contains($0) }) else { throw LogbookFailure("备份证明类型、长度或摘要无效。") }
        return LogbookBackupProof(bytes: bytes.intValue, sha256: hash)
    }
    func previewRestore(candidate: LogbookBackupProof, selected: [LogbookJSON]) throws {
        guard restoring, !ready, !closed else { throw LogbookFailure("恢复预览状态无效。") }
        try verify("candidate", expected: candidate)
        let input = try FileHandle(forReadingFrom: file("candidate")); defer { try? input.close() }
        let preview = try LogbookRestoreCandidate.inspect(input, proof: candidate)
        var keep: Set<String> = ["source", "candidate"], checked: [Attachment] = []
        for value in selected {
            try LogbookValidation.shape(value, "zipPath,name,mime,bytes,sha256")
            guard let path = value["zipPath"] as? String, let name = value["name"] as? String, let mime = value["mime"] as? String else { throw LogbookFailure("恢复附件类型无效。") }
            let key = "zip:" + path, proof = try Self.requestProof(value)
            guard key.utf8.count <= 4096, !name.isEmpty, name.count <= 255, name != ".", name != "..", !name.contains("/"), !name.contains("\\"),
                  !name.unicodeScalars.contains(where: { $0.value < 32 }), !mime.isEmpty, mime.count <= 128,
                  keep.insert(key).inserted else { throw LogbookFailure("恢复附件名称、大小或重复引用无效。") }
            try verify(key, expected: proof); checked.append(Attachment(key: key, name: name, mime: mime, proof: proof))
        }
        try finish(keeping: keep); restorePreview = preview; attachments = checked
    }
    static func fileProof(_ url: URL, maximumBytes: Int, readBufferBytes: Int = 65536) throws -> LogbookBackupProof {
        guard readBufferBytes > 0 else { throw LogbookFailure("文件回读缓冲无效。") }
        let input = try FileHandle(forReadingFrom: url); defer { try? input.close() }
        var hash = SHA256(), bytes = 0
        while let chunk = try input.read(upToCount: readBufferBytes), !chunk.isEmpty {
            bytes += chunk.count; guard bytes <= maximumBytes else { throw LogbookFailure("备份文件长度已变化。") }; hash.update(data: chunk)
        }
        return LogbookBackupProof(bytes: bytes, sha256: LogbookBackupProof.hex(hash.finalize()))
    }
    private static func delete(_ file: URL) throws {
        guard FileManager.default.fileExists(atPath: file.path) else { return }
        let resolved = file.resolvingSymlinksInPath()
        guard resolved.deletingLastPathComponent() == file.deletingLastPathComponent().resolvingSymlinksInPath(), resolved.lastPathComponent == file.lastPathComponent else { throw LogbookFailure("私有暂存文件引用无效。") }
        try FileManager.default.removeItem(at: file)
    }
    func close() throws {
        var failure: Error?
        for entry in entries.values {
            do { if let output = entry.output { try output.close(); entry.output = nil }; try Self.delete(entry.url) }
            catch { if failure == nil { failure = error } }
        }
        if let failure { throw failure }
        entries.removeAll(); closed = true
    }
}
