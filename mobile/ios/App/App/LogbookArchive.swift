import Foundation
import CryptoKit
import Darwin

final class LogbookArchive {
    let preferences: UserDefaults
    private let registryURL: URL
    private let registryLock = NSRecursiveLock()
    private let nameLock = NSLock()
    init(directory: URL, preferences: UserDefaults = .standard) throws {
        self.preferences = preferences; registryURL = directory.appendingPathComponent("documents.json")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    }
    static func digest(_ bytes: Data) -> String { SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined() }
    func bookmark() throws -> Data {
        guard let bookmark = preferences.data(forKey: "coc.archive.bookmark") else { throw LogbookFailure("请先选择本机保存文件夹。") }
        return bookmark
    }
    func access<T>(_ bookmark: Data, _ action: (URL) throws -> T) throws -> T {
        var stale = false
        let url = try URL(resolvingBookmarkData: bookmark, options: [.withoutUI], relativeTo: nil, bookmarkDataIsStale: &stale)
        guard !stale else { throw LogbookFailure("文件夹授权已失效，请重新选择；原数据未改变。") }
        let scoped = url.startAccessingSecurityScopedResource(); defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        let values = try url.resourceValues(forKeys: [.isDirectoryKey, .isUbiquitousItemKey])
        guard url.isFileURL, values.isDirectory == true, values.isUbiquitousItem != true else { throw LogbookFailure("请选择“我的 iPhone”中的本机文件夹。") }
        guard FileManager.default.isReadableFile(atPath: url.path), FileManager.default.isWritableFile(atPath: url.path) else { throw LogbookFailure("文件夹不可读写，请重新确认保存位置。") }
        return try action(url)
    }
    func requirePermission() throws { try access(bookmark()) { _ in () } }
    func location() -> LogbookJSON {
        let bookmark = preferences.data(forKey: "coc.archive.bookmark")
        let valid = bookmark.map { data in (try? access(data) { _ in true }) == true } ?? false
        return ["uri": bookmark.map(Self.digest) ?? "", "label": preferences.string(forKey: "coc.archive.label") ?? "尚未选择", "valid": valid]
    }
    /// Called only after an explicit local-folder choice; existing contents are never replaced.
    func chooseLocalDirectory(_ documents: URL) throws -> LogbookJSON {
        let folder = documents.appendingPathComponent("归档", isDirectory: true)
        if FileManager.default.fileExists(atPath: folder.path) {
            let values = try folder.resourceValues(forKeys: [.isDirectoryKey, .isSymbolicLinkKey])
            guard values.isDirectory == true, values.isSymbolicLink != true else {
                throw LogbookFailure("本机归档位置不是普通文件夹；原文件未改变，请选择其他位置。")
            }
        } else {
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        }
        return try choose(folder)
    }
    func choose(_ url: URL) throws -> LogbookJSON {
        let scoped = url.startAccessingSecurityScopedResource(); defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        let bookmark = try url.bookmarkData(options: [.minimalBookmark], includingResourceValuesForKeys: nil, relativeTo: nil)
        try access(bookmark) { directory in
            let probe = directory.appendingPathComponent("coc-write-check-" + UUID().uuidString + ".txt")
            let bytes = Data("COC archive write check".utf8)
            try bytes.write(to: probe, options: [.withoutOverwriting])
            defer { try? FileManager.default.removeItem(at: probe) }
            guard try Data(contentsOf: probe) == bytes else { throw LogbookFailure("文件夹回读校验失败。") }
        }
        let previous = preferences.data(forKey: "coc.archive.bookmark"), label = preferences.string(forKey: "coc.archive.label"), automatic = preferences.dictionary(forKey: "coc.automatic-backup")
        preferences.set(bookmark, forKey: "coc.archive.bookmark"); preferences.set(url.lastPathComponent, forKey: "coc.archive.label")
        if previous != bookmark { preferences.removeObject(forKey: "coc.automatic-backup") }
        guard preferences.synchronize() else {
            preferences.set(previous, forKey: "coc.archive.bookmark"); preferences.set(label, forKey: "coc.archive.label")
            preferences.set(automatic, forKey: "coc.automatic-backup")
            throw LogbookFailure("文件夹授权未保存，请重试。")
        }
        return location()
    }
    private func registry() throws -> [LogbookJSON] {
        if !FileManager.default.fileExists(atPath: registryURL.path) { return [] }
        guard let rows = try JSONSerialization.jsonObject(with: Data(contentsOf: registryURL)) as? [LogbookJSON] else { throw LogbookFailure("归档文件登记损坏；未清空登记。") }
        var ids: Set<String> = []
        for row in rows {
            guard let document = row["document"] as? LogbookJSON, let uri = document["uri"] as? String, uri.hasPrefix("coc-ios-document://"), ids.insert(uri).inserted,
                  document["name"] is String, document["bytes"] is NSNumber, document["sha256"] is String, row["mime"] is String,
                  let bookmark = row["bookmark"] as? String, Data(base64Encoded: bookmark) != nil else { throw LogbookFailure("归档文件登记不完整；未清空登记。") }
        }
        return rows
    }
    private func persist(_ rows: [LogbookJSON]) throws { try logbookData(rows).write(to: registryURL, options: [.atomic]) }
    func documents(all: Bool) throws -> [LogbookJSON] {
        registryLock.lock(); defer { registryLock.unlock() }
        let rows = try registry().reversed().map { $0["document"] as! LogbookJSON }
        return all ? rows : Array(rows.prefix(30))
    }
    static func validateName(_ name: String) throws {
        guard !name.isEmpty, name.utf16.count <= 255, name != ".", name != "..", !name.contains("/"), !name.contains("\\"), !name.unicodeScalars.contains(where: { $0.value < 32 || $0.value == 127 }) else { throw LogbookFailure("文件名不合法。") }
    }
    private func readBounded(_ url: URL) throws -> Data {
        let handle = try FileHandle(forReadingFrom: url); defer { try? handle.close() }
        var result = Data()
        while let chunk = try handle.read(upToCount: 65536), !chunk.isEmpty {
            guard result.count + chunk.count <= logbookMaximumBytes else { throw LogbookFailure("文件超过 64 MB。") }
            result.append(chunk)
        }
        return result
    }
    func readPicked(_ url: URL) throws -> Data {
        let scoped = url.startAccessingSecurityScopedResource(); defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        var failure: NSError?, outcome: Result<Data, Error>?
        NSFileCoordinator().coordinate(readingItemAt: url, options: [], error: &failure) { coordinated in outcome = Result { try self.readBounded(coordinated) } }
        if let failure { throw failure }
        guard let outcome else { throw LogbookFailure("系统文件读取未完成。") }
        return try outcome.get()
    }
    private func reserve(_ directory: URL, _ requested: String) throws -> (URL, Int32) {
        nameLock.lock(); defer { nameLock.unlock() }
        let existing = Set(try FileManager.default.contentsOfDirectory(atPath: directory.path).map { $0.precomposedStringWithCanonicalMapping.lowercased() })
        let name = requested as NSString, ext = name.pathExtension
        let stem = ext.isEmpty ? requested : name.deletingPathExtension
        for index in 1...100000 {
            let candidate = index == 1 ? requested : stem + " (\(index))" + (ext.isEmpty ? "" : "." + ext)
            if existing.contains(candidate.precomposedStringWithCanonicalMapping.lowercased()) { continue }
            let file = directory.appendingPathComponent(candidate, isDirectory: false)
            let descriptor = Darwin.open(file.path, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, S_IRUSR | S_IWUSR)
            if descriptor >= 0 { return (file, descriptor) }
            if errno != EEXIST { throw LogbookFailure("无法创建新文件；未覆盖已有文件。") }
        }
        throw LogbookFailure("同名文件过多，请更换文件名。")
    }
    func write(name: String, mime: String, bytes: Data, purpose: String, bookmark: Data? = nil) throws -> LogbookJSON {
        try Self.validateName(name)
        guard bytes.count <= logbookMaximumBytes else { throw LogbookFailure("文件超过 64 MB。") }
        let captured = try bookmark ?? self.bookmark()
        return try access(captured) { directory in
            var failure: NSError?, outcome: Result<LogbookJSON, Error>?
            NSFileCoordinator().coordinate(writingItemAt: directory, options: [.forMerging], error: &failure) { directory in
                outcome = Result {
                    let (file, descriptor) = try self.reserve(directory, name)
                    do {
                        let handle = FileHandle(fileDescriptor: descriptor, closeOnDealloc: true)
                        do { try handle.write(contentsOf: bytes); try handle.synchronize(); try handle.close() } catch { try? handle.close(); throw error }
                        let actual = try self.readBounded(file)
                        guard actual == bytes else { throw LogbookFailure("文件回读校验失败。") }
                        let document: LogbookJSON = ["uri": "coc-ios-document://" + UUID().uuidString, "name": file.lastPathComponent, "bytes": actual.count, "sha256": Self.digest(actual), "purpose": purpose]
                        self.registryLock.lock(); defer { self.registryLock.unlock() }
                        var rows = try self.registry()
                        rows.append(["document": document, "mime": mime, "bookmark": captured.base64EncodedString(), "archive": Self.digest(captured), "createdAt": Date().timeIntervalSince1970 * 1000])
                        try self.persist(rows)
                        return document
                    } catch { try? FileManager.default.removeItem(at: file); throw error }
                }
            }
            if let failure { throw failure }
            guard let outcome else { throw LogbookFailure("系统文件保存未完成。") }
            return try outcome.get()
        }
    }
    private func known(_ uri: String) throws -> LogbookJSON {
        guard let row = try registry().first(where: { ($0["document"] as? LogbookJSON)?["uri"] as? String == uri }) else { throw LogbookFailure("仅能打开本应用登记的文件。") }
        return row
    }
    func read(_ uri: String) throws -> (Data, String, String) {
        registryLock.lock(); defer { registryLock.unlock() }
        let row = try known(uri)
        guard let document = row["document"] as? LogbookJSON, let name = document["name"] as? String, let encoded = row["bookmark"] as? String, let bookmark = Data(base64Encoded: encoded) else { throw LogbookFailure("文件登记无效。") }
        try Self.validateName(name)
        return try access(bookmark) { directory in
            let bytes = try self.readPicked(directory.appendingPathComponent(name))
            guard Self.digest(bytes) == document["sha256"] as? String, bytes.count == (document["bytes"] as? NSNumber)?.intValue else { throw LogbookFailure("文件已改变或无法读取，请重新导出。") }
            return (bytes, name, row["mime"] as? String ?? "application/octet-stream")
        }
    }
    func removeOwned(_ uri: String) throws {
        registryLock.lock(); defer { registryLock.unlock() }
        let row = try known(uri), document = row["document"] as! LogbookJSON
        let bookmark = Data(base64Encoded: row["bookmark"] as! String)!
        try access(bookmark) { directory in
            let file = directory.appendingPathComponent(document["name"] as! String)
            var failure: NSError?, outcome: Result<Void, Error>?
            NSFileCoordinator().coordinate(writingItemAt: file, options: [.forDeleting], error: &failure) { file in
                outcome = Result {
                    let bytes = try self.readBounded(file)
                    guard Self.digest(bytes) == document["sha256"] as? String, bytes.count == (document["bytes"] as? NSNumber)?.intValue else { throw LogbookFailure("旧文件已改变，已保留。") }
                    try FileManager.default.removeItem(at: file)
                }
            }
            if let failure { throw failure }
            guard let outcome else { throw LogbookFailure("文件删除未完成。") }
            try outcome.get()
        }
        try persist(try registry().filter { ($0["document"] as? LogbookJSON)?["uri"] as? String != uri })
    }
    func rotateAutomatic(bookmark: Data) -> String {
        registryLock.lock(); defer { registryLock.unlock() }
        do {
            let rows = try registry().filter { $0["archive"] as? String == Self.digest(bookmark) && ($0["document"] as? LogbookJSON)?["purpose"] as? String == "auto" }
            var warning = ""
            for row in rows.dropLast(10) {
                do { try removeOwned((row["document"] as! LogbookJSON)["uri"] as! String) }
                catch { warning = "部分旧备份已改变或无法访问，已保留。" }
            }
            return warning
        } catch { return "自动备份已保存，但旧备份登记读取失败。" }
    }
}
