import Foundation
import Capacitor
import UIKit
import UniformTypeIdentifiers
import QuickLook
import Network

@objc(LogbookPlugin)
public final class LogbookPlugin: CAPPlugin, CAPBridgedPlugin, UIDocumentPickerDelegate, UIAdaptivePresentationControllerDelegate, QLPreviewControllerDataSource, QLPreviewControllerDelegate {
    public let identifier = "LogbookPlugin"
    public let jsName = "Logbook"
    public let pluginMethods: [CAPPluginMethod] = ["appendBackupStage", "finishBackupPreview", "commitBackupRestore", "cancelBackupStage", "createBackupStream", "finishBackupExport", "beginFetchBatch", "stageFetchResult", "finishFetchBatch", "cancelFetchBatch", "beginSnapshotEdit", "appendSnapshotEdit", "cancelSnapshotEdit", "claimFirstLaunchIntro", "getOverview", "getState", "getStatus", "getRecordContent", "commitSettings", "commitModule", "commitEntity", "commitAction", "commitTable", "commitTableDelta", "commitEdit", "commitRestore", "selectArchive", "openBackup", "writeArchive", "readDocument", "listDocuments", "openDocument", "shareDocument", "fetchLog", "automaticBackup"].map { CAPPluginMethod(name: $0, returnType: CAPPluginReturnPromise)! }
    private let work = DispatchQueue(label: "coc.logbook.storage", qos: .userInitiated)
    private let backupWriter = DispatchQueue(label: "coc.logbook.automatic-backup", qos: .utility)
    private let logFetch = LogbookFetch()
    private let monitor = NWPathMonitor()
    private var connected = true
    private var store: LogbookStore?
    private var archive: LogbookArchive?
    private var backupRunning = false
    private var pickerCall: CAPPluginCall?
    private var activePicker: UIDocumentPickerViewController?
    private var choosingFolder = false
    private var previewURL: URL?
    private var cleanedShareDirectory = false
    private func shareDirectory() throws -> URL {
        let base = FileManager.default.temporaryDirectory.appendingPathComponent("coc-share-staging", isDirectory: true)
        try FileManager.default.createDirectory(at: base, withIntermediateDirectories: true)
        if !cleanedShareDirectory {
            for entry in try FileManager.default.contentsOfDirectory(at: base, includingPropertiesForKeys: [.isSymbolicLinkKey])
                where entry.lastPathComponent.range(of: "^share-[a-f0-9-]+$", options: .regularExpression) != nil {
                guard entry.resolvingSymlinksInPath().deletingLastPathComponent() == base.resolvingSymlinksInPath(),
                      try entry.resourceValues(forKeys: [.isSymbolicLinkKey]).isSymbolicLink != true else { throw LogbookFailure("私有展示暂存引用异常，未清理原文件。") }
                try FileManager.default.removeItem(at: entry)
            }
            cleanedShareDirectory = true
        }
        return base.appendingPathComponent("share-" + UUID().uuidString.lowercased(), isDirectory: true)
    }
    public override func load() {
        monitor.pathUpdateHandler = { [weak self] path in self?.work.async { self?.connected = path.status == .satisfied } }
        monitor.start(queue: DispatchQueue(label: "coc.logbook.network"))
    }
    deinit { monitor.cancel(); logFetch.close() }
    private func resources() throws -> (LogbookStore, LogbookArchive) {
        let directory = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true).appendingPathComponent("COCLogbook", isDirectory: true)
        if store == nil { store = try LogbookStore(url: directory.appendingPathComponent("logbook.sqlite")) }
        if archive == nil { archive = try LogbookArchive(directory: directory) }
        return (store!, archive!)
    }
    private func run(_ call: CAPPluginCall, _ action: @escaping (LogbookStore, LogbookArchive) throws -> LogbookJSON) {
        work.async {
            do { let (store, archive) = try self.resources(); call.resolve(try action(store, archive)) }
            catch { call.reject(error.localizedDescription) }
        }
    }
    private func expected(_ call: CAPPluginCall) throws -> Int {
        guard LogbookValidation.number(call.options["expectedRevision"]), let value = call.options["expectedRevision"] as? NSNumber, value.doubleValue >= 0, value.doubleValue < 9007199254740991, value.doubleValue.rounded(.down) == value.doubleValue else { throw LogbookFailure("数据版本参数不合法。") }
        return value.intValue
    }
    private func state(_ store: LogbookStore, _ archive: LogbookArchive) throws -> LogbookJSON {
        var result: LogbookJSON = ["backupStreamVersion": 1, "storageUsage": try store.storageUsage(), "tableDeltaVersion": 1, "revision": try store.revision(), "archive": archive.location(), "networkConnected": connected, "lastAutoBackupAt": 0]
        if let saved = archive.preferences.dictionary(forKey: "coc.automatic-backup") { result["lastAutoBackupAt"] = saved["savedAt"]; result["lastAutoBackupRevision"] = saved["revision"] }
        return result
    }
    private func systemTheme(_ theme: String?) {
        DispatchQueue.main.async {
            guard let controller = self.bridge?.viewController as? CAPBridgeViewController else { return }
            let dark = theme == "dark"
            controller.statusBarStyle = dark ? .lightContent : .darkContent
            controller.overrideUserInterfaceStyle = dark ? .dark : .light
            controller.setNeedsStatusBarAppearanceUpdate()
        }
    }
    @objc func claimFirstLaunchIntro(_ call: CAPPluginCall) {
        run(call) { _, archive in
            let preferences = archive.preferences, key = "coc.presentation.first-welcome-shown"
            let show = !preferences.bool(forKey: key)
            if show { preferences.set(true, forKey: key); guard preferences.synchronize() else { throw LogbookFailure("首次欢迎状态未保存。") } }
            return ["show": show]
        }
    }
    private var backupSession: LogbookBackupSession?
    private func backupDirectory() throws -> URL {
        try FileManager.default.url(for: .cachesDirectory, in: .userDomainMask, appropriateFor: nil, create: true).appendingPathComponent("backup-stream-staging", isDirectory: true)
    }
    private func backupOwner(_ call: CAPPluginCall) throws -> LogbookBackupSession {
        guard let owner = backupSession else { throw LogbookFailure("备份租约已失效，请重新选择。") }
        try owner.require(call.getString("id")); return owner
    }
    private func checkBackup(_ owner: LogbookBackupSession, _ store: LogbookStore, _ archive: LogbookArchive, revision: Bool) throws {
        guard try archive.bookmark() == owner.bookmark else { throw LogbookFailure("保存位置已变化，请重新预览。") }
        try archive.requirePermission()
        if revision { try store.check(owner.expected) }
    }
    private func backupRun(_ call: CAPPluginCall, _ action: @escaping (LogbookStore, LogbookArchive) throws -> LogbookJSON) {
        work.async {
            do { let (store, archive) = try self.resources(); call.resolve(try action(store, archive)) }
            catch {
                var message = error.localizedDescription
                if let owner = self.backupSession, owner.id == call.getString("id") {
                    do { try owner.close(); self.backupSession = nil }
                    catch { message += " 私有暂存清理失败，请重开后重试。" }
                }
                call.reject(message)
            }
        }
    }
    private func backupFile(_ owner: LogbookBackupSession, _ key: String) throws -> LogbookJSON {
        let proof = try owner.proof(key)
        return ["fileUri": try owner.file(key).absoluteString, "bytes": proof.bytes, "sha256": proof.sha256]
    }
    private func openRestoreStream(_ call: CAPPluginCall, _ url: URL, _ store: LogbookStore, _ archive: LogbookArchive) throws -> LogbookJSON {
        guard backupSession == nil else { throw LogbookFailure("已有备份任务，请先关闭预览。") }
        let revision = try expected(call); try store.check(revision); try archive.requirePermission()
        let owner = try LogbookBackupSession(directory: backupDirectory(), expected: revision, bookmark: archive.bookmark(), restoring: true, includeArchives: false)
        backupSession = owner
        do {
            _ = try archive.withPicked(url) { try owner.capture("source", input: $0) }
            try checkBackup(owner, store, archive, revision: true)
            let input = try FileHandle(forReadingFrom: owner.file("source")); defer { try? input.close() }
            let magic = try input.read(upToCount: 2)
            var source = try backupFile(owner, "source")
            source["id"] = owner.id; source["revision"] = revision; source["format"] = magic == Data([0x50, 0x4b]) ? "zip" : "json"
            source["maximumStageBytes"] = try owner.beginOutput()
            return ["cancelled": false, "name": url.lastPathComponent, "source": source]
        } catch {
            do { try owner.close(); backupSession = nil }
            catch { throw LogbookFailure("所选备份未导入，私有暂存清理失败，请重开后重试。") }
            throw error
        }
    }
    @objc func appendBackupStage(_ call: CAPPluginCall) {
        backupRun(call) { store, archive in
            let owner = try self.backupOwner(call); try self.checkBackup(owner, store, archive, revision: owner.restoring)
            guard let key = call.getString("key"), let index = call.getInt("index"), let encoded = call.getString("base64"),
                  encoded.utf8.count <= LogbookLimits.encodedChunkBytes, let bytes = Data(base64Encoded: encoded) else { throw LogbookFailure("备份暂存分段无效。") }
            try owner.append(key: key, index: index, chunk: bytes); return [:]
        }
    }
    @objc func finishBackupPreview(_ call: CAPPluginCall) {
        backupRun(call) { store, archive in
            let owner = try self.backupOwner(call); try self.checkBackup(owner, store, archive, revision: true)
            guard let candidate = call.getObject("candidate"), let selected = call.options["attachments"] as? [LogbookJSON] else { throw LogbookFailure("恢复候选证明缺失。") }
            try owner.verifySources()
            try owner.previewRestore(candidate: LogbookBackupSession.requestProof(candidate), selected: selected)
            return ["id": owner.id, "revision": owner.expected, "offlineRecords": owner.restorePreview!.offlineRecords]
        }
    }
    @objc func cancelBackupStage(_ call: CAPPluginCall) {
        run(call) { _, _ in
            if let owner = self.backupSession, owner.id == call.getString("id") { try owner.close(); self.backupSession = nil }
            return [:]
        }
    }
    @objc func commitBackupRestore(_ call: CAPPluginCall) {
        backupRun(call) { store, archive in
            let owner = try self.backupOwner(call); try owner.requireReady()
            guard owner.restoring, call.getBool("confirmed") == true, let preview = owner.restorePreview else { throw LogbookFailure("需要明确确认完整覆盖。") }
            try self.checkBackup(owner, store, archive, revision: true)
            let required = try LogbookCapacity.estimate(preview.proof.bytes, copies: 6) + LogbookCapacity.estimate(store.logicalBytes(), copies: 2)
            try LogbookCapacity.require(available: owner.available, additional: required)
            try owner.verifySources()
            var imported: [LogbookJSON] = []
            do {
                for file in owner.attachments {
                    try owner.verify(file.key, expected: file.proof)
                    imported.append(try archive.writeFile(name: file.name, mime: file.mime, source: owner.file(file.key), purpose: "import", bookmark: owner.bookmark))
                }
                try self.checkBackup(owner, store, archive, revision: true)
                let input = try FileHandle(forReadingFrom: owner.file("candidate")); defer { try? input.close() }
                _ = try LogbookRestoreCandidate.inspect(input, proof: preview.proof); try input.seek(toOffset: 0)
                // Cleanup is part of the precondition. The open descriptor is the
                // only candidate reference retained during the CAS transaction.
                try owner.close(); self.backupSession = nil
                let revision = try store.restoreCandidate(input, preview: preview, expected: owner.expected, restoreSettings: call.getBool("restoreSettings") == true) {
                    try self.checkBackup(owner, store, archive, revision: false)
                }
                return ["revision": revision]
            } catch {
                var cleanupFailed = false
                for file in imported { do { try archive.removeNewImport(file) } catch { cleanupFailed = true } }
                if cleanupFailed { throw LogbookFailure(error.localizedDescription + " 部分本次新附件无法清理或已变化，已保留；原业务库未覆盖。") }
                throw error
            }
        }
    }
    @objc func createBackupStream(_ call: CAPPluginCall) {
        run(call) { store, archive in
            guard self.backupSession == nil else { throw LogbookFailure("已有备份任务，请先关闭预览。") }
            let revision = try self.expected(call); try store.check(revision); try archive.requirePermission()
            let include = call.getBool("includeArchives") == true
            let owner = try LogbookBackupSession(directory: self.backupDirectory(), expected: revision, bookmark: archive.bookmark(), restoring: false, includeArchives: include)
            self.backupSession = owner
            do {
                _ = try owner.captureJSON { write in try store.writeBackup(expected: revision, maximumBytes: owner.sourceBudget, sink: write) }
                var files: [LogbookJSON] = [], total = 0
                if include {
                    for document in try archive.documents(all: true).reversed() {
                        let purpose = document["purpose"] as? String ?? "", name = document["name"] as? String ?? ""
                        if purpose != "export" && purpose != "import" && (!purpose.isEmpty || ["before-", "auto-backup-", "coc-android-backup-"].contains(where: name.hasPrefix)) { continue }
                        let proof = try LogbookBackupSession.requestProof(document)
                        total += proof.bytes
                        guard proof.bytes <= LogbookLimits.archiveFileBytes, total <= LogbookLimits.attachmentTotalBytes, files.count < 1999 else { throw LogbookFailure("完整归档附件超过独立处理上限；未省略原文件。") }
                        let key = "archive:\(files.count)"
                        try archive.withDocument(document["uri"] as! String) { url, _, _ in
                            let input = try FileHandle(forReadingFrom: url); defer { try? input.close() }
                            _ = try owner.capture(key, input: input, expected: proof)
                        }
                        var file = try self.backupFile(owner, key); file["name"] = name; files.append(file)
                    }
                }
                try self.checkBackup(owner, store, archive, revision: true)
                var source = try self.backupFile(owner, "source"); source["canonicalVersion"] = 1
                return ["id": owner.id, "revision": revision, "source": source, "files": files, "maximumBytes": try owner.beginOutput()]
            } catch {
                do { try owner.close(); self.backupSession = nil }
                catch { throw LogbookFailure("备份未发布，私有暂存清理失败，请重开后重试。") }
                throw error
            }
        }
    }
    @objc func finishBackupExport(_ call: CAPPluginCall) {
        backupRun(call) { store, archive in
            let owner = try self.backupOwner(call)
            guard !owner.restoring, let name = call.getString("name") else { throw LogbookFailure("备份任务用途或文件名无效。") }
            try self.checkBackup(owner, store, archive, revision: false)
            let key = owner.includeArchives ? "output" : "source"
            if owner.includeArchives {
                guard let value = call.getObject("proof") else { throw LogbookFailure("完整ZIP证明缺失。") }
                try owner.verify(key, expected: LogbookBackupSession.requestProof(value))
            }
            try owner.verifySources(); try owner.verify(key, expected: owner.proof(key))
            var saved = try archive.writeFile(name: name, mime: owner.includeArchives ? "application/zip" : "application/json", source: owner.file(key), purpose: "backup", bookmark: owner.bookmark)
            do { try owner.close(); self.backupSession = nil }
            catch { saved["warning"] = "备份已完整保存，但私有暂存清理失败，请重开后重试。" }
            return saved
        }
    }

    private var fetchBatch: LogbookFetchBatch?
    private var snapshotUpload: LogbookSnapshotUpload?
    private var stagingDirectory: URL?
    private func fetchDirectory() throws -> URL {
        if let stagingDirectory { return stagingDirectory }
        let base = try FileManager.default.url(for: .cachesDirectory, in: .userDomainMask, appropriateFor: nil, create: true).appendingPathComponent("ios-fetch-staging", isDirectory: true)
        // Only our private interrupted fetch candidates, never database or archive files.
        if FileManager.default.fileExists(atPath: base.path) { try FileManager.default.removeItem(at: base) }
        try FileManager.default.createDirectory(at: base, withIntermediateDirectories: true)
        stagingDirectory = base
        return base
    }
    @objc func beginFetchBatch(_ call: CAPPluginCall) {
        run(call) { store, archive in
            guard self.fetchBatch == nil, let ids = call.options["ids"] as? [String] else { throw LogbookFailure("已有批量检测或目标无效。") }
            try archive.requirePermission()
            let batch = try LogbookFetchBatch(directory: self.fetchDirectory(), store: store, ids: ids, expected: self.expected(call), bookmark: archive.bookmark())
            self.fetchBatch = batch
            return ["id": batch.id]
        }
    }
    @objc func beginSnapshotEdit(_ call: CAPPluginCall) {
        run(call) { store, archive in
            let expected = try self.expected(call)
            try store.check(expected); try archive.requirePermission()
            guard self.snapshotUpload == nil, let batch = self.fetchBatch, batch.expected == expected,
                  let bytes = call.getInt("bytes"), let hash = call.getString("sha256") else { throw LogbookFailure("正文暂存请求无效。") }
            let upload = try LogbookSnapshotUpload(directory: self.fetchDirectory(), expected: expected, bytes: bytes, sha256: hash)
            self.snapshotUpload = upload
            return ["id": upload.id]
        }
    }
    @objc func appendSnapshotEdit(_ call: CAPPluginCall) {
        run(call) { _, _ in
            guard let upload = self.snapshotUpload, call.getString("id") == upload.id,
                  let index = call.getInt("index"), let base64 = call.getString("base64") else { throw LogbookFailure("正文暂存标识无效。") }
            try upload.append(index: index, base64: base64)
            return [:]
        }
    }
    @objc func stageFetchResult(_ call: CAPPluginCall) {
        run(call) { store, archive in
            guard let batch = self.fetchBatch, batch.id == call.getString("batchId"),
                  let upload = self.snapshotUpload, upload.id == call.getString("id"),
                  try archive.bookmark() == batch.bookmark else { throw LogbookFailure("检测暂存或保存位置已变化。") }
            try store.check(batch.expected); try archive.requirePermission()
            try batch.stage(upload)
            self.snapshotUpload = nil
            return [:]
        }
    }
    @objc func finishFetchBatch(_ call: CAPPluginCall) {
        run(call) { store, archive in
            guard let batch = self.fetchBatch, batch.id == call.getString("id"), self.snapshotUpload == nil,
                  try archive.bookmark() == batch.bookmark else { throw LogbookFailure("检测暂存或保存位置已变化。") }
            try archive.requirePermission()
            let result = try store.finishFetch(batch)
            self.fetchBatch = nil
            return ["revision": result.0, "exportedAt": result.1]
        }
    }
    @objc func cancelSnapshotEdit(_ call: CAPPluginCall) {
        run(call) { _, _ in
            if self.snapshotUpload?.id == call.getString("id") { try self.snapshotUpload?.close(); self.snapshotUpload = nil }
            return [:]
        }
    }
    @objc func cancelFetchBatch(_ call: CAPPluginCall) {
        run(call) { _, _ in
            if self.fetchBatch?.id == call.getString("id") { try self.snapshotUpload?.close(); try self.fetchBatch?.close(); self.snapshotUpload = nil; self.fetchBatch = nil }
            return [:]
        }
    }
    @objc func getOverview(_ call: CAPPluginCall) {
        run(call) { store, archive in
            var result = try self.state(store, archive); result["json"] = NSNull()
            if let snapshot = try store.metadata() {
                result["json"] = try logbookText(snapshot)
                #if DEBUG && targetEnvironment(simulator)
                PublicNameTrace.overview(snapshot, revision: try store.revision())
                #endif
                self.systemTheme((snapshot["settings"] as? LogbookJSON)?["theme"] as? String)
            } else { self.systemTheme("light") }
            result["deferredRecordIds"] = try store.deferredIDs(); return result
        }
    }
    @objc func getState(_ call: CAPPluginCall) {
        run(call) { store, archive in
            var result = try self.state(store, archive); result["json"] = NSNull()
            if let snapshot = try store.fullSnapshot() { result["json"] = try logbookText(snapshot) }
            return result
        }
    }
    @objc func getStatus(_ call: CAPPluginCall) { run(call) { try self.state($0, $1) } }
    @objc func getRecordContent(_ call: CAPPluginCall) {
        run(call) { store, _ in
            let expected = try self.expected(call); try store.check(expected)
            guard let ids = call.options["ids"] as? [String], !ids.isEmpty, Set(ids).count == ids.count, ids.count <= 50000, let snapshot = try store.fullSnapshot(selected: ids) else { throw LogbookFailure("所选场次无效或尚未保存。") }
            try store.check(expected); return ["json": try logbookText(snapshot), "revision": expected]
        }
    }
    private func mutate(_ call: CAPPluginCall, _ operation: @escaping (inout LogbookJSON) throws -> Void) {
        run(call) { store, archive in
            try archive.requirePermission()
            let (revision, now) = try store.mutate(expected: self.expected(call), operation)
            if call.methodName == "commitSettings" { self.systemTheme(call.getObject("settings")?["theme"] as? String) }
            return ["revision": revision, "exportedAt": now]
        }
    }
    @objc func commitSettings(_ call: CAPPluginCall) {
        mutate(call) { data in
            guard let settings = call.getObject("settings"), try logbookData(settings).count <= 16384 else { throw LogbookFailure("设置缺失或过大。") }
            try LogbookValidation.settings(settings); data["settings"] = settings
        }
    }
    @objc func commitModule(_ call: CAPPluginCall) {
        mutate(call) { data in
            guard let value = call.getObject("value"), try logbookData(value).count <= 1024 * 1024 else { throw LogbookFailure("模组数据缺失或过大。") }
            try LogbookMutations.module(value, data: &data)
        }
    }
    @objc func commitEntity(_ call: CAPPluginCall) {
        mutate(call) { data in
            guard let edit = call.getObject("edit"), try logbookData(edit).count <= LogbookLimits.entityRequestBytes else { throw LogbookFailure("编辑数据缺失或过大。") }
            try LogbookMutations.entity(edit, data: &data)
        }
    }
    @objc func commitAction(_ call: CAPPluginCall) {
        mutate(call) { data in guard let action = call.getObject("action") else { throw LogbookFailure("操作参数缺失。") }; try LogbookMutations.action(action, data: &data) }
    }
    @objc func commitTableDelta(_ call: CAPPluginCall) {
        let timing = call.getBool("measure") == true ? LogbookTableTiming() : nil
        run(call) { store, archive in
            timing?.mark("queueAndResources")
            let expected = try self.expected(call); try store.check(expected); try archive.requirePermission()
            let bookmark = try archive.bookmark()
            timing?.mark("authorization")
            guard let json = call.getString("json"), json.utf8.count <= LogbookLimits.tableRequestBytes else { throw LogbookFailure("表格差量缺失或超过 64 MiB。") }
            timing?.mark("inputSize")
            let delta = try logbookObject(json)
            timing?.mark("candidateParse")
            let result = try store.importTableDelta(delta, expected: expected, timing: timing) {
                guard try archive.bookmark() == bookmark else { throw LogbookFailure("保存位置已变化，未保存。") }
                try archive.requirePermission()
            }
            var response: LogbookJSON = ["revision": result.0, "exportedAt": result.1]
            if let timing { response["timing"] = timing.result() }
            return response
        }
    }
    @objc func commitTable(_ call: CAPPluginCall) {
        let timing = call.getBool("measure") == true ? LogbookTableTiming() : nil
        run(call) { store, archive in
            timing?.mark("queueAndResources")
            let expected = try self.expected(call); try store.check(expected); try archive.requirePermission()
            let bookmark = try archive.bookmark()
            timing?.mark("authorization")
            guard let json = call.getString("json"), json.utf8.count <= LogbookLimits.tableRequestBytes else { throw LogbookFailure("表格数据缺失或超过 64 MB。") }
            timing?.mark("inputSize")
            let candidate = try logbookObject(json)
            timing?.mark("candidateParse")
            let result = try store.mutate(expected: expected, timing: timing) { data in
                guard try archive.bookmark() == bookmark else { throw LogbookFailure("保存位置已变化，未保存。") }
                try archive.requirePermission()
                // A fresh store has platform defaults; retain the candidate's validated defaults only for its first save.
                if try store.metadata() == nil { data["settings"] = candidate["settings"] }
                try LogbookMutations.table(candidate, data: &data)
            }
            var response: LogbookJSON = ["revision": result.0, "exportedAt": result.1]
            if let timing { response["timing"] = timing.result() }
            return response
        }
    }
    @objc func commitEdit(_ call: CAPPluginCall) { commitSnapshot(call, restoring: false) }
    @objc func commitRestore(_ call: CAPPluginCall) { commitSnapshot(call, restoring: true) }
    private func commitSnapshot(_ call: CAPPluginCall, restoring: Bool) {
        run(call) { store, archive in
            if restoring && call.getBool("confirmed") != true { throw LogbookFailure("需要明确确认覆盖数据。") }
            let expected = try self.expected(call); try store.check(expected)
            guard let json = call.getString("json"), json.utf8.count <= LogbookLimits.snapshotRequestBytes else { throw LogbookFailure("数据缺失或超过 64 MB。") }
            let snapshot = try logbookObject(json); try LogbookValidation.snapshot(snapshot); try archive.requirePermission()
            let attachments = restoring ? (call.options["attachments"] as? [LogbookJSON] ?? []) : []
            guard attachments.count <= 2000 else { throw LogbookFailure("归档附件数量过多。") }
            var imported: [String] = [], total = 0
            do {
                for attachment in attachments {
                    guard let encoded = attachment["base64"] as? String, let bytes = Data(base64Encoded: encoded), let name = attachment["name"] as? String, let mime = attachment["mime"] as? String else { throw LogbookFailure("归档附件不合法。") }
                    total += bytes.count; guard total <= LogbookLimits.attachmentTotalBytes else { throw LogbookFailure("归档附件超过 128 MB。") }
                    let document = try archive.write(name: name, mime: mime, bytes: bytes, purpose: "import")
                    imported.append(document["uri"] as! String)
                }
                let revision = try store.replace(snapshot, expected: expected)
                self.systemTheme((snapshot["settings"] as? LogbookJSON)?["theme"] as? String)
                return ["revision": revision]
            } catch { for uri in imported { try? archive.removeOwned(uri) }; throw error }
        }
    }
    private func presentPicker(_ call: CAPPluginCall, folder: Bool) {
        DispatchQueue.main.async {
            guard self.pickerCall == nil, let controller = self.bridge?.viewController, controller.presentedViewController == nil else { call.reject("请先关闭当前系统窗口。"); return }
            self.pickerCall = call; self.choosingFolder = folder
            let picker = UIDocumentPickerViewController(forOpeningContentTypes: folder ? [.folder] : [.data], asCopy: !folder)
            #if DEBUG && targetEnvironment(simulator)
            if !folder, ProcessInfo.processInfo.arguments.contains("--coc-picker-ui"),
               let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first {
                picker.directoryURL = documents.appendingPathComponent("COC-Picker-Public-Test", isDirectory: true)
            }
            #endif
            picker.allowsMultipleSelection = false; picker.delegate = self
            self.activePicker = picker
            if folder, let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first {
                do { try FileManager.default.createDirectory(at: documents, withIntermediateDirectories: true); picker.directoryURL = documents }
                catch { self.pickerCall = nil; self.activePicker = nil; call.reject("本机文件位置无法打开。"); return }
            }
            controller.present(picker, animated: true) { picker.presentationController?.delegate = self }
        }
    }
    @objc func selectArchive(_ call: CAPPluginCall) {
        guard call.getBool("localFolder") == true else { presentPicker(call, folder: true); return }
        DispatchQueue.main.async {
            guard self.pickerCall == nil, let controller = self.bridge?.viewController, controller.presentedViewController == nil else {
                call.reject("请先关闭当前系统窗口。"); return
            }
            self.pickerCall = call
            self.work.async {
                let result: Result<LogbookJSON, Error> = Result {
                    let (_, archive) = try LogbookArchive.archiveStep("L0：打开应用内部存储") { try self.resources() }
                    return ["cancelled": false, "archive": try archive.chooseLocalDirectory()]
                }
                DispatchQueue.main.async {
                    self.pickerCall = nil
                    switch result {
                    case .success(let value): call.resolve(value)
                    case .failure(let error): call.reject(error.localizedDescription)
                    }
                }
            }
        }
    }
    @objc func openBackup(_ call: CAPPluginCall) {
        #if DEBUG && targetEnvironment(simulator)
        if ProcessInfo.processInfo.arguments.contains("--coc-ios-scale"), let uri = call.getString("publicRestoreDocument") {
            run(call) { store, archive in
                try archive.withDocument(uri) { url, document, _ in
                    guard call.getBool("stream") == true, call.getString("kind") == "backup", document["purpose"] as? String == "backup",
                          (document["name"] as? String ?? "").hasPrefix("public-capacity-") else { throw LogbookFailure("仅限隔离模拟器的公开容量夹具。") }
                    return try self.openRestoreStream(call, url, store, archive)
                }
            }
            return
        }
        #endif
        presentPicker(call, folder: false)
    }
    public func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        guard controller === activePicker else { return }
        let call = pickerCall; pickerCall = nil; activePicker = nil
        controller.delegate = nil
        controller.dismiss(animated: true)
        call?.resolve(["cancelled": true])
    }
    public func presentationControllerDidDismiss(_ presentationController: UIPresentationController) {
        if let picker = activePicker, presentationController.presentedViewController === picker {
            documentPickerWasCancelled(picker)
        }
    }
    public func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        guard controller === activePicker, let call = pickerCall else { return }
        let folder = choosingFolder; pickerCall = nil; activePicker = nil
        controller.delegate = nil
        controller.dismiss(animated: true)
        guard let url = urls.first else { call.resolve(["cancelled": true]); return }
        run(call) { store, archive in
            if folder { return ["cancelled": false, "archive": try archive.choose(url)] }
            if call.getBool("stream") == true, (call.getString("kind") ?? "backup") == "backup" { return try self.openRestoreStream(call, url, store, archive) }
            return ["cancelled": false, "name": url.lastPathComponent, "base64": try archive.readPicked(url).base64EncodedString()]
        }
    }
    @objc func writeArchive(_ call: CAPPluginCall) {
        run(call) { _, archive in
            guard let name = call.getString("name"), let mime = call.getString("mime"), let encoded = call.getString("base64"), encoded.count <= 90 * 1024 * 1024, let bytes = Data(base64Encoded: encoded) else { throw LogbookFailure("文件参数不合法。") }
            let purpose = call.getString("purpose") ?? "export"
            guard ["export", "backup"].contains(purpose) else { throw LogbookFailure("文件用途不合法。") }
            return try archive.write(name: name, mime: mime, bytes: bytes, purpose: purpose)
        }
    }
    @objc func listDocuments(_ call: CAPPluginCall) { run(call) { _, archive in ["documents": try archive.documents(all: call.getBool("all") == true)] } }
    @objc func readDocument(_ call: CAPPluginCall) {
        run(call) { _, archive in
            let (bytes, name, mime) = try archive.read(call.getString("uri") ?? "")
            return ["base64": bytes.base64EncodedString(), "name": name, "mime": mime]
        }
    }
    @objc func openDocument(_ call: CAPPluginCall) { launch(call, sharing: false) }
    @objc func shareDocument(_ call: CAPPluginCall) { launch(call, sharing: true) }
    private func launch(_ call: CAPPluginCall, sharing: Bool) {
        work.async {
            do {
                let (_, archive) = try self.resources()
                let directory = try self.shareDirectory()
                try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
                let file: URL
                do { file = try archive.copyForPresentation(call.getString("uri") ?? "", directory: directory) }
                catch { try FileManager.default.removeItem(at: directory); throw error }
                DispatchQueue.main.async {
                    guard let controller = self.bridge?.viewController, controller.presentedViewController == nil else { try? FileManager.default.removeItem(at: directory); call.reject("请先关闭当前系统窗口。"); return }
                    if sharing {
                        let share = UIActivityViewController(activityItems: [file], applicationActivities: nil)
                        share.completionWithItemsHandler = { _, _, _, _ in self.work.async { try? FileManager.default.removeItem(at: directory) } }
                        share.popoverPresentationController?.sourceView = controller.view
                        share.popoverPresentationController?.sourceRect = CGRect(x: controller.view.bounds.midX, y: controller.view.bounds.midY, width: 1, height: 1)
                        controller.present(share, animated: true) { call.resolve() }
                    } else {
                        self.previewURL = file
                        let preview = QLPreviewController(); preview.dataSource = self; preview.delegate = self
                        controller.present(preview, animated: true) { call.resolve() }
                    }
                }
            } catch { call.reject(error.localizedDescription) }
        }
    }
    public func previewControllerDidDismiss(_ controller: QLPreviewController) {
        let file = previewURL; previewURL = nil
        if let file { work.async { try? FileManager.default.removeItem(at: file.deletingLastPathComponent()) } }
    }
    public func numberOfPreviewItems(in controller: QLPreviewController) -> Int { previewURL == nil ? 0 : 1 }
    public func previewController(_ controller: QLPreviewController, previewItemAt index: Int) -> QLPreviewItem { previewURL! as NSURL }
    @objc func fetchLog(_ call: CAPPluginCall) {
        guard let raw = call.getString("url"), let url = URL(string: raw) else { call.reject("日志网址无效。"); return }
        logFetch.start(url) { result in
            switch result { case .success(let value): call.resolve(value); case .failure(let error): call.reject(error.localizedDescription) }
        }
    }
    @objc func automaticBackup(_ call: CAPPluginCall) {
        work.async {
            do {
                guard !self.backupRunning else { throw LogbookFailure("自动备份正在进行。") }
                let (store, archive) = try self.resources(), expected = try self.expected(call)
                try store.check(expected); try archive.requirePermission()
                let bookmark = try archive.bookmark()
                let backupDirectory = try FileManager.default.url(for: .cachesDirectory, in: .userDomainMask, appropriateFor: nil, create: true).appendingPathComponent("automatic-backup-staging", isDirectory: true)
                try FileManager.default.createDirectory(at: backupDirectory, withIntermediateDirectories: true)
                for entry in try FileManager.default.contentsOfDirectory(at: backupDirectory, includingPropertiesForKeys: [.isSymbolicLinkKey])
                    where entry.lastPathComponent.range(of: "^[a-fA-F0-9-]+\\.backup$", options: .regularExpression) != nil {
                    guard entry.resolvingSymlinksInPath().deletingLastPathComponent() == backupDirectory.resolvingSymlinksInPath(),
                          try entry.resourceValues(forKeys: [.isSymbolicLinkKey]).isSymbolicLink != true else { throw LogbookFailure("私有自动备份暂存引用异常。") }
                    try FileManager.default.removeItem(at: entry)
                }
                let source = try store.backupFile(expected: expected, directory: backupDirectory)
                self.backupRunning = true
                self.backupWriter.async {
                    defer { self.work.async { self.backupRunning = false } }
                    do {
                        let document = try archive.writeFile(name: "auto-backup-\(Int(Date().timeIntervalSince1970 * 1000)).json", mime: "application/json", source: source, purpose: "auto", bookmark: bookmark)
                        let savedAt = try self.work.sync { () throws -> Int in
                            guard try archive.bookmark() == bookmark else { throw LogbookFailure("保存位置已变化；文件保留，未标记新位置已备份。") }
                            let savedAt = Int(Date().timeIntervalSince1970 * 1000)
                            archive.preferences.set(["savedAt": savedAt, "revision": expected], forKey: "coc.automatic-backup")
                            guard archive.preferences.synchronize() else { throw LogbookFailure("备份已写入，但成功状态未保存。") }
                            return savedAt
                        }
                        var warning = archive.rotateAutomatic(bookmark: bookmark)
                        do { try FileManager.default.removeItem(at: source) }
                        catch { warning += " 自动备份已完整保存，但私有暂存清理失败，请重开后重试。" }
                        call.resolve(["document": document, "savedAt": savedAt, "revision": expected, "warning": warning])
                    } catch {
                        var message = error.localizedDescription
                        do { if FileManager.default.fileExists(atPath: source.path) { try FileManager.default.removeItem(at: source) } }
                        catch { message += " 私有自动备份暂存清理失败，请重开后重试。" }
                        call.reject(message)
                    }
                }
            } catch { call.reject(error.localizedDescription) }
        }
    }
}
