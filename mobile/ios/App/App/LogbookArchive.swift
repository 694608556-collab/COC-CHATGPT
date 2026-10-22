import Foundation
import CryptoKit
import Darwin

final class LogbookArchive {
    let preferences: UserDefaults
    // Versioned reference contains no absolute container path and grants no external access.
    private static let localReference = Data("coc-owned-archive:v1:documents/archive".utf8)
    private let documentsDirectory: () throws -> URL
    private let registryURL: URL
    private let registryLock = NSRecursiveLock()
    private let nameLock = NSLock()
    init(directory: URL, preferences: UserDefaults = .standard,
         documentsDirectory: @escaping () throws -> URL = {
             try FileManager.default.url(for: .documentDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
         }) throws {
        self.documentsDirectory = documentsDirectory
        self.preferences = preferences; registryURL = directory.appendingPathComponent("documents.json")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    }
    static func digest(_ bytes: Data) -> String { SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined() }
    static func backupName(_ date: Date = Date(), extension ext: String = "json") -> String {
        let formatter = DateFormatter(); formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX"); formatter.timeZone = .current; formatter.dateFormat = "yyyyMMdd"
        return formatter.string(from: date) + "COC跑团记录簿." + ext
    }
    static func backupAvailable(_ existing: Set<String>, _ requested: String) throws -> String? {
        guard let pattern = try? NSRegularExpression(pattern: "^(\\d{8}COC跑团记录簿)\\.(json|zip)$", options: .caseInsensitive),
              let match = pattern.firstMatch(in: requested, range: NSRange(requested.startIndex..., in: requested)),
              let stemRange = Range(match.range(at: 1), in: requested), let extensionRange = Range(match.range(at: 2), in: requested) else { return nil }
        let stem = String(requested[stemRange]), ext = String(requested[extensionRange])
        let names = try NSRegularExpression(pattern: "^" + NSRegularExpression.escapedPattern(for: stem) + "(\\d*)\\.(json|zip)$", options: .caseInsensitive)
        var maximum = -1
        for name in existing {
            guard let found = names.firstMatch(in: name, range: NSRange(name.startIndex..., in: name)), let range = Range(found.range(at: 1), in: name) else { continue }
            let digits = String(name[range])
            guard let number = Int(digits.isEmpty ? "0" : digits), number < Int.max else { throw LogbookFailure("备份文件序号无效，请更换保存目录。") }
            maximum = max(maximum, number)
        }
        return stem + (maximum < 0 ? "" : String(maximum + 1)) + "." + ext
    }
    func bookmark() throws -> Data {
        guard let bookmark = preferences.data(forKey: "coc.archive.bookmark") else { throw LogbookFailure("请先选择本机保存文件夹。") }
        return bookmark
    }
    func access<T>(_ bookmark: Data, _ action: (URL) throws -> T) throws -> T {
        if bookmark == Self.localReference {
            // Resolve against this installation, never a previous installation's container UUID.
            let folder = try documentsDirectory().appendingPathComponent("归档", isDirectory: true)
            try validateLocalDirectory(folder)
            return try action(folder)
        }
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
    private func validateLocalDirectory(_ folder: URL) throws {
        let values = try folder.resourceValues(forKeys: [.isDirectoryKey, .isSymbolicLinkKey])
        guard folder.isFileURL, values.isDirectory == true, values.isSymbolicLink != true else {
            throw LogbookFailure("本机归档位置不是普通文件夹；原文件未改变，请选择其他位置。")
        }
        guard FileManager.default.isReadableFile(atPath: folder.path), FileManager.default.isWritableFile(atPath: folder.path) else {
            throw LogbookFailure("本机归档文件夹不可读写；原数据未改变。")
        }
    }
    /// User explicitly selects the app-owned Documents folder; no external bookmark is needed.
    /// Existing external bookmarks and registry entries retain their original interpretation.
    func chooseLocalDirectory() throws -> LogbookJSON {
        let folder = try Self.archiveStep("L1：定位本机目录") { try documentsDirectory().appendingPathComponent("归档", isDirectory: true) }
        try Self.archiveStep("L2：创建或检查本机目录") {
            if !FileManager.default.fileExists(atPath: folder.path) {
                try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            }
            try validateLocalDirectory(folder)
        }
        try Self.archiveStep("L3：本机目录读写回读") { try verifyWritable(folder) }
        return try saveChoice(Self.localReference, label: folder.lastPathComponent)
    }
    /// Reports only a fixed stage and error code, never paths, URLs or file contents.
    static func archiveStep<T>(_ stage: String, _ action: () throws -> T) throws -> T {
        do { return try action() }
        catch let failure as LogbookFailure { throw failure }
        catch {
            let code = (error as NSError).code
            throw LogbookFailure("归档配置失败（\(stage)，系统错误 \(code)）；原数据未改变。")
        }
    }
    private func verifyWritable(_ directory: URL) throws {
        let probe = directory.appendingPathComponent("coc-write-check-" + UUID().uuidString + ".txt")
        let bytes = Data("COC archive write check".utf8)
        try bytes.write(to: probe, options: [.withoutOverwriting])
        defer { try? FileManager.default.removeItem(at: probe) }
        guard try Data(contentsOf: probe) == bytes else { throw LogbookFailure("文件夹回读校验失败。") }
    }
    func choose(_ url: URL) throws -> LogbookJSON {
        let scoped = url.startAccessingSecurityScopedResource(); defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        let bookmark = try Self.archiveStep("E1：创建自选目录授权") {
            try url.bookmarkData(options: [.minimalBookmark], includingResourceValuesForKeys: nil, relativeTo: nil)
        }
        try Self.archiveStep("E2：解析授权并检查读写") { try access(bookmark) { try verifyWritable($0) } }
        return try saveChoice(bookmark, label: url.lastPathComponent)
    }
    private func saveChoice(_ bookmark: Data, label selectedLabel: String) throws -> LogbookJSON {
        let previous = preferences.data(forKey: "coc.archive.bookmark"), label = preferences.string(forKey: "coc.archive.label"), automatic = preferences.dictionary(forKey: "coc.automatic-backup")
        preferences.set(bookmark, forKey: "coc.archive.bookmark"); preferences.set(selectedLabel, forKey: "coc.archive.label")
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
    private func readComplete(_ url: URL) throws -> Data {
        let handle = try FileHandle(forReadingFrom: url); defer { try? handle.close() }
        var result = Data()
        while let chunk = try handle.read(upToCount: 65536), !chunk.isEmpty {
            result.append(chunk)
        }
        return result
    }
    func readPicked(_ url: URL) throws -> Data {
        let scoped = url.startAccessingSecurityScopedResource(); defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        var failure: NSError?, outcome: Result<Data, Error>?
        NSFileCoordinator().coordinate(readingItemAt: url, options: [], error: &failure) { coordinated in outcome = Result { try self.readComplete(coordinated) } }
        if let failure { throw failure }
        guard let outcome else { throw LogbookFailure("系统文件读取未完成。") }
        return try outcome.get()
    }
    private func reserve(_ directory: URL, _ requested: String) throws -> (URL, Int32) {
        nameLock.lock(); defer { nameLock.unlock() }
        var existing = Set(try FileManager.default.contentsOfDirectory(atPath: directory.path).map { $0.precomposedStringWithCanonicalMapping.lowercased() })
        let name = requested as NSString, ext = name.pathExtension
        let stem = ext.isEmpty ? requested : name.deletingPathExtension
        var index = 0
        while index < Int.max {
            index += 1
            let candidate = try Self.backupAvailable(existing, requested) ?? (index == 1 ? requested : stem + " (\(index))" + (ext.isEmpty ? "" : "." + ext))
            if existing.contains(candidate.precomposedStringWithCanonicalMapping.lowercased()) { continue }
            let file = directory.appendingPathComponent(candidate, isDirectory: false)
            let descriptor = Darwin.open(file.path, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, S_IRUSR | S_IWUSR)
            if descriptor >= 0 { return (file, descriptor) }
            if errno != EEXIST { throw LogbookFailure("无法创建新文件；未覆盖已有文件。") }
            existing.insert(candidate.precomposedStringWithCanonicalMapping.lowercased())
        }
        throw LogbookFailure("同名文件过多，请更换文件名。")
    }
    func write(name: String, mime: String, bytes: Data, purpose: String, bookmark: Data? = nil) throws -> LogbookJSON {
        return try publish(name: name, mime: mime, purpose: purpose, bookmark: bookmark,
                           proof: (bytes.count, Self.digest(bytes))) { output in try output.write(contentsOf: bytes) }
    }
    static func fileProof(_ url: URL, maximumBytes: Int? = nil) throws -> (Int, String) {
        let input = try FileHandle(forReadingFrom: url); defer { try? input.close() }
        var total = 0, hash = SHA256()
        while let chunk = try input.read(upToCount: 65536), !chunk.isEmpty {
            total += chunk.count
            if let maximumBytes { guard total <= maximumBytes else { throw LogbookFailure("文件超过已验证完整长度。") } }
            hash.update(data: chunk)
        }
        return (total, hash.finalize().map { String(format: "%02x", $0) }.joined())
    }
    func writeFile(name: String, mime: String, source: URL, purpose: String, bookmark: Data) throws -> LogbookJSON {
        let proof = try Self.fileProof(source)
        return try publish(name: name, mime: mime, purpose: purpose, bookmark: bookmark, proof: proof) { output in
            let input = try FileHandle(forReadingFrom: source); defer { try? input.close() }
            var written = 0
            while let chunk = try input.read(upToCount: 65536), !chunk.isEmpty {
                written += chunk.count
                guard written <= proof.0 else { throw LogbookFailure("备份暂存已变化。") }
                try output.write(contentsOf: chunk)
            }
            guard written == proof.0 else { throw LogbookFailure("备份暂存不完整。") }
        }
    }
    private func publish(name: String, mime: String, purpose: String, bookmark: Data?, proof: (Int, String), write: @escaping (FileHandle) throws -> Void) throws -> LogbookJSON {
        try Self.validateName(name)
        guard proof.0 >= 0 else { throw LogbookFailure("归档文件长度无效。") }
        let captured = try bookmark ?? self.bookmark()
        return try access(captured) { directory in
            try LogbookCapacity.require(available: { try LogbookCapacity.available(directory) }, additional: LogbookCapacity.estimate(proof.0, copies: 1))
            var failure: NSError?, outcome: Result<LogbookJSON, Error>?
            NSFileCoordinator().coordinate(writingItemAt: directory, options: [.forMerging], error: &failure) { directory in
                outcome = Result {
                    let (file, descriptor) = try self.reserve(directory, name)
                    do {
                        let handle = FileHandle(fileDescriptor: descriptor, closeOnDealloc: true)
                        do { try write(handle); try handle.synchronize(); try handle.close() } catch { try? handle.close(); throw error }
                        let actual = try Self.fileProof(file, maximumBytes: proof.0)
                        try LogbookCapacity.require(available: { try LogbookCapacity.available(directory) }, additional: 0)
                        guard actual == proof else { throw LogbookFailure("文件回读校验失败。") }
                        let document: LogbookJSON = ["uri": "coc-ios-document://" + UUID().uuidString, "name": file.lastPathComponent, "bytes": actual.0, "sha256": actual.1, "purpose": purpose]
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
    /// Registered source only; keeps security scope and coordinator alive for the entire copy.
    func withDocument<T>(_ uri: String, _ action: (URL, LogbookJSON, String) throws -> T) throws -> T {
        registryLock.lock(); defer { registryLock.unlock() }
        let row = try known(uri), document = row["document"] as! LogbookJSON
        let name = document["name"] as! String, bookmark = Data(base64Encoded: row["bookmark"] as! String)!
        try Self.validateName(name)
        return try access(bookmark) { directory in
            var failure: NSError?, outcome: Result<T, Error>?
            NSFileCoordinator().coordinate(readingItemAt: directory.appendingPathComponent(name), options: [], error: &failure) { file in
                outcome = Result {
                    let proof = try Self.fileProof(file, maximumBytes: (document["bytes"] as? NSNumber)?.intValue)
                    guard proof.0 == (document["bytes"] as? NSNumber)?.intValue, proof.1 == document["sha256"] as? String else { throw LogbookFailure("已登记文件缺失或改变；未省略。") }
                    return try action(file, document, row["mime"] as? String ?? "application/octet-stream")
                }
            }
            if let failure { throw failure }
            guard let outcome else { throw LogbookFailure("文件协调读取未完成。") }
            return try outcome.get()
        }
    }
    func withPicked<T>(_ url: URL, _ action: (FileHandle) throws -> T) throws -> T {
        let scoped = url.startAccessingSecurityScopedResource(); defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        var failure: NSError?, outcome: Result<T, Error>?
        NSFileCoordinator().coordinate(readingItemAt: url, options: [], error: &failure) { file in
            outcome = Result { let input = try FileHandle(forReadingFrom: file); defer { try? input.close() }; return try action(input) }
        }
        if let failure { throw failure }
        guard let outcome else { throw LogbookFailure("所选备份读取未完成。") }
        return try outcome.get()
    }
    /// A bounded-memory verified private copy for system preview/share.
    func copyForPresentation(_ uri: String, directory: URL) throws -> URL {
        try withDocument(uri) { source, document, _ in
            let bytes = (document["bytes"] as! NSNumber).intValue
            try LogbookCapacity.require(available: { try LogbookCapacity.available(directory) }, additional: LogbookCapacity.estimate(bytes, copies: 1))
            let target = directory.appendingPathComponent(document["name"] as! String)
            do {
                try FileManager.default.copyItem(at: source, to: target)
                let proof = try Self.fileProof(target, maximumBytes: bytes)
                guard proof.0 == bytes, proof.1 == document["sha256"] as? String else { throw LogbookFailure("展示文件回读校验失败。") }
                return target
            } catch { if FileManager.default.fileExists(atPath: target.path) { try FileManager.default.removeItem(at: target) }; throw error }
        }
    }
    func removeNewImport(_ saved: LogbookJSON) throws {
        registryLock.lock(); defer { registryLock.unlock() }
        guard let uri = saved["uri"] as? String, let row = try registry().first(where: { ($0["document"] as? LogbookJSON)?["uri"] as? String == uri }),
              let document = row["document"] as? LogbookJSON, document["purpose"] as? String == "import",
              try logbookData(document) == logbookData(saved) else { throw LogbookFailure("本次新附件登记已变化，已保留。") }
        try removeOwned(uri)
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
                    let proof = try Self.fileProof(file, maximumBytes: (document["bytes"] as? NSNumber)?.intValue)
                    guard proof.1 == document["sha256"] as? String, proof.0 == (document["bytes"] as? NSNumber)?.intValue else { throw LogbookFailure("旧文件已改变，已保留。") }
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
