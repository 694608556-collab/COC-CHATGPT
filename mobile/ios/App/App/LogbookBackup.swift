import Foundation
import CryptoKit

/// Strict decoded duplicate-key checks before Foundation parses one bounded
/// candidate line. JSONSerialization supplies the complete grammar/UTF-8 check.
enum LogbookBackupJSON {
    private struct Frame { var object: Bool; var key: Bool; var keys = Set<String>() }
    static func object(_ data: Data) throws -> LogbookJSON {
        try data.withUnsafeBytes { (raw: UnsafeRawBufferPointer) throws -> Void in
            let bytes = raw.bindMemory(to: UInt8.self)
            var frames: [Frame] = [], index = 0
            while index < bytes.count {
                let char = bytes[index]
                if char == 34 {
                    let start = index; index += 1
                    var escaped = false, complete = false
                    while index < bytes.count {
                        let next = bytes[index]; index += 1
                        if next == 92 { escaped = true; index += 1 }
                        else if next == 34 { complete = true; break }
                    }
                    guard complete, index <= bytes.count else { throw LogbookFailure("恢复JSON字符串不完整。") }
                    if let last = frames.indices.last, frames[last].object, frames[last].key {
                        let key: String
                        if escaped {
                            guard let decoded = try JSONSerialization.jsonObject(with: Data(bytes[start..<index]), options: [.fragmentsAllowed]) as? String else { throw LogbookFailure("恢复JSON字段名无效。") }
                            key = decoded
                        } else { key = String(decoding: bytes[(start + 1)..<(index - 1)], as: UTF8.self) }
                        guard frames[last].keys.count < 100000, frames[last].keys.insert(key).inserted else { throw LogbookFailure("恢复JSON字段重复或数量过多。") }
                        frames[last].key = false
                    }
                    continue
                }
                if char == 123 || char == 91 {
                    guard frames.count < 256 else { throw LogbookFailure("恢复JSON嵌套超过处理上限。") }
                    frames.append(Frame(object: char == 123, key: char == 123))
                } else if char == 125 || char == 93 {
                    guard let last = frames.last, last.object == (char == 125) else { throw LogbookFailure("恢复JSON结构无效。") }
                    frames.removeLast()
                } else if char == 44, let last = frames.indices.last, frames[last].object { frames[last].key = true }
                index += 1
            }
            guard frames.isEmpty else { throw LogbookFailure("恢复JSON结构不完整。") }
        }
        guard let object = try JSONSerialization.jsonObject(with: data) as? LogbookJSON else { throw LogbookFailure("恢复JSON必须为对象。") }
        return object
    }
    /// Extract only the two already-validated top-level body values. Their raw
    /// numeric/escape spelling must survive restoration into the v1 body column.
    static func body(_ data: Data) throws -> String {
        try data.withUnsafeBytes { (raw: UnsafeRawBufferPointer) throws -> String in
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
            var at = space(0), fields: [(String, String)] = []
            guard at < bytes.count, bytes[at] == 123 else { throw LogbookFailure("正文词元对象无效。") }; at += 1
            while true {
                at = space(at); guard at < bytes.count else { throw LogbookFailure("正文词元字段不完整。") }
                if bytes[at] == 125 { break }
                let keyEnd = try stringEnd(at), keyData = Data(bytes[at..<keyEnd])
                guard let key = try JSONSerialization.jsonObject(with: keyData, options: [.fragmentsAllowed]) as? String else { throw LogbookFailure("正文词元字段名无效。") }
                at = space(keyEnd); guard at < bytes.count, bytes[at] == 58 else { throw LogbookFailure("正文词元字段分隔无效。") }; at = space(at + 1)
                let until = try end(at)
                if key == "rawContent" || key == "manualContent" { fields.append((key, String(decoding: bytes[at..<until], as: UTF8.self))) }
                at = space(until); guard at < bytes.count else { throw LogbookFailure("正文词元对象不完整。") }
                if bytes[at] == 125 { break }
                guard bytes[at] == 44 else { throw LogbookFailure("正文词元字段分隔无效。") }; at += 1
            }
            return "{" + fields.sorted { $0.0 < $1.0 }.map { "\"" + $0.0 + "\":" + $0.1 }.joined(separator: ",") + "}"
        }
    }
}

struct LogbookBackupProof {
    let bytes: Int
    let sha256: String
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
        var metadata: LogbookJSON?, offline = 0, metadataBytes = 2
        let newline = Data([10])
        func consume() throws {
            guard line.count > 1, line.count <= LogbookLimits.snapshotRequestBytes + 1, metadata == nil else { throw LogbookFailure("恢复候选顺序或长度无效。") }
            let kind = line.first!, json = Data(line.dropFirst()), value = try LogbookBackupJSON.object(json)
            if kind == 82 {
                try LogbookValidation.record(value)
                var row = value
                row.removeValue(forKey: "rawContent"); row.removeValue(forKey: "manualContent")
                metadataBytes += try logbookData(row).count + 1
                guard metadataBytes <= LogbookLimits.snapshotRequestBytes else { throw LogbookFailure("恢复元数据超过处理上限。") }
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
            guard line.count <= LogbookLimits.snapshotRequestBytes + 1 else { throw LogbookFailure("单场完整数据或元数据超过64MiB。") }
        }
        let digest = hash.finalize().map { String(format: "%02x", $0) }.joined()
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
        func seal() throws {
            if let output { try output.synchronize(); try output.close(); self.output = nil }
            let actual = try LogbookBackupSession.fileProof(url, maximumBytes: bytes)
            guard actual.bytes == bytes else { throw LogbookFailure("备份暂存长度不完整。") }
            proof = actual
        }
    }
    let id = UUID().uuidString.lowercased()
    let expected: Int
    let bookmark: Data
    let restoring: Bool
    let includeArchives: Bool
    let available: () throws -> Int
    private let directory: URL
    private let maximumInputBytes: Int
    private var inputBytes = 0, outputBytes = 0, maximumOutputBytes = 0
    private var ready = false, closed = false
    private var entries: [String: Entry] = [:]
    struct Attachment { let key: String; let name: String; let mime: String; let proof: LogbookBackupProof }
    private(set) var restorePreview: LogbookRestoreCandidate.Preview?
    private(set) var attachments: [Attachment] = []
    init(directory: URL, expected: Int, bookmark: Data, restoring: Bool, includeArchives: Bool,
         available: (() throws -> Int)? = nil) throws {
        self.directory = directory; self.expected = expected; self.bookmark = bookmark
        self.restoring = restoring; self.includeArchives = includeArchives
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        self.available = available ?? { try LogbookCapacity.available(directory) }
        for file in try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)
            where file.lastPathComponent.range(of: "^coc-backup-[a-f0-9-]+-[0-9]+\\.part$", options: .regularExpression) != nil {
            try Self.delete(file)
        }
        maximumInputBytes = try LogbookCapacity.maximum(available: self.available, copies: restoring ? 6 : 3)
    }
    deinit { try? close() }
    func require(_ token: String?) throws { guard !closed, token == id else { throw LogbookFailure("备份暂存租约已失效。") } }
    private func create(_ key: String) throws -> Entry {
        if let entry = entries[key] { return entry }
        guard entries.count < 2002 else { throw LogbookFailure("备份暂存条目过多。") }
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
        if key.hasPrefix("zip:"), entry.bytes + chunk.count > LogbookLimits.archiveFileBytes { throw LogbookFailure("单个归档附件超过64MiB。") }
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
        guard restoring, !ready, !closed, selected.count <= 1999 else { throw LogbookFailure("恢复预览状态或附件数无效。") }
        try verify("candidate", expected: candidate)
        let input = try FileHandle(forReadingFrom: file("candidate")); defer { try? input.close() }
        let preview = try LogbookRestoreCandidate.inspect(input, proof: candidate)
        var keep: Set<String> = ["source", "candidate"], checked: [Attachment] = [], total = 0
        for value in selected {
            try LogbookValidation.shape(value, "zipPath,name,mime,bytes,sha256")
            guard let path = value["zipPath"] as? String, let name = value["name"] as? String, let mime = value["mime"] as? String else { throw LogbookFailure("恢复附件类型无效。") }
            let key = "zip:" + path, proof = try Self.requestProof(value)
            guard key.utf8.count <= 4096, !name.isEmpty, name.count <= 255, name != ".", name != "..", !name.contains("/"), !name.contains("\\"),
                  !name.unicodeScalars.contains(where: { $0.value < 32 }), !mime.isEmpty, mime.count <= 128, proof.bytes <= LogbookLimits.archiveFileBytes,
                  keep.insert(key).inserted else { throw LogbookFailure("恢复附件名称、大小或重复引用无效。") }
            total += proof.bytes
            guard total <= LogbookLimits.attachmentTotalBytes else { throw LogbookFailure("恢复附件合计超过128MiB。") }
            try verify(key, expected: proof); checked.append(Attachment(key: key, name: name, mime: mime, proof: proof))
        }
        try finish(keeping: keep); restorePreview = preview; attachments = checked
    }
    static func fileProof(_ url: URL, maximumBytes: Int) throws -> LogbookBackupProof {
        let input = try FileHandle(forReadingFrom: url); defer { try? input.close() }
        var hash = SHA256(), bytes = 0
        while let chunk = try input.read(upToCount: 65536), !chunk.isEmpty {
            bytes += chunk.count; guard bytes <= maximumBytes else { throw LogbookFailure("备份文件长度已变化。") }; hash.update(data: chunk)
        }
        return LogbookBackupProof(bytes: bytes, sha256: hash.finalize().map { String(format: "%02x", $0) }.joined())
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
