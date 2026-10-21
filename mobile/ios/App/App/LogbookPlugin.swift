import Foundation
import Capacitor
import UIKit
import UniformTypeIdentifiers
import QuickLook
import Network

@objc(LogbookPlugin)
public final class LogbookPlugin: CAPPlugin, CAPBridgedPlugin, UIDocumentPickerDelegate, UIAdaptivePresentationControllerDelegate, QLPreviewControllerDataSource {
    public let identifier = "LogbookPlugin"
    public let jsName = "Logbook"
    public let pluginMethods: [CAPPluginMethod] = ["beginFetchBatch", "stageFetchResult", "finishFetchBatch", "cancelFetchBatch", "beginSnapshotEdit", "appendSnapshotEdit", "cancelSnapshotEdit", "claimFirstLaunchIntro", "getOverview", "getState", "getStatus", "getRecordContent", "commitSettings", "commitModule", "commitEntity", "commitAction", "commitTable", "commitTableDelta", "commitEdit", "commitRestore", "selectArchive", "openBackup", "writeArchive", "readDocument", "listDocuments", "openDocument", "shareDocument", "fetchLog", "automaticBackup"].map { CAPPluginMethod(name: $0, returnType: CAPPluginReturnPromise)! }
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
        var result: LogbookJSON = ["tableDeltaVersion": 1, "revision": try store.revision(), "archive": archive.location(), "networkConnected": connected, "lastAutoBackupAt": 0]
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
            if self.snapshotUpload?.id == call.getString("id") { self.snapshotUpload = nil }
            return [:]
        }
    }
    @objc func cancelFetchBatch(_ call: CAPPluginCall) {
        run(call) { _, _ in
            if self.fetchBatch?.id == call.getString("id") { self.snapshotUpload = nil; self.fetchBatch = nil }
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
            guard let edit = call.getObject("edit"), try logbookData(edit).count <= logbookMaximumBytes else { throw LogbookFailure("编辑数据缺失或过大。") }
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
            guard let json = call.getString("json"), json.utf8.count <= logbookMaximumBytes else { throw LogbookFailure("表格差量缺失或超过 64 MiB。") }
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
            guard let json = call.getString("json"), json.utf8.count <= logbookMaximumBytes else { throw LogbookFailure("表格数据缺失或超过 64 MB。") }
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
            guard let json = call.getString("json"), json.utf8.count <= logbookMaximumBytes else { throw LogbookFailure("数据缺失或超过 64 MB。") }
            let snapshot = try logbookObject(json); try LogbookValidation.snapshot(snapshot); try archive.requirePermission()
            let attachments = restoring ? (call.options["attachments"] as? [LogbookJSON] ?? []) : []
            guard attachments.count <= 2000 else { throw LogbookFailure("归档附件数量过多。") }
            var imported: [String] = [], total = 0
            do {
                for attachment in attachments {
                    guard let encoded = attachment["base64"] as? String, let bytes = Data(base64Encoded: encoded), let name = attachment["name"] as? String, let mime = attachment["mime"] as? String else { throw LogbookFailure("归档附件不合法。") }
                    total += bytes.count; guard total <= 128 * 1024 * 1024 else { throw LogbookFailure("归档附件超过 128 MB。") }
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
    @objc func openBackup(_ call: CAPPluginCall) { presentPicker(call, folder: false) }
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
        run(call) { _, archive in
            if folder { return ["cancelled": false, "archive": try archive.choose(url)] }
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
                let (_, archive) = try self.resources(), (bytes, name, _) = try archive.read(call.getString("uri") ?? "")
                let directory = FileManager.default.temporaryDirectory.appendingPathComponent("coc-share-" + UUID().uuidString, isDirectory: true)
                try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
                let file = directory.appendingPathComponent(name); try bytes.write(to: file, options: [.withoutOverwriting])
                DispatchQueue.main.async {
                    guard let controller = self.bridge?.viewController, controller.presentedViewController == nil else { call.reject("请先关闭当前系统窗口。"); return }
                    if sharing {
                        let share = UIActivityViewController(activityItems: [file], applicationActivities: nil)
                        share.popoverPresentationController?.sourceView = controller.view
                        share.popoverPresentationController?.sourceRect = CGRect(x: controller.view.bounds.midX, y: controller.view.bounds.midY, width: 1, height: 1)
                        controller.present(share, animated: true) { call.resolve() }
                    } else {
                        self.previewURL = file
                        let preview = QLPreviewController(); preview.dataSource = self
                        controller.present(preview, animated: true) { call.resolve() }
                    }
                }
            } catch { call.reject(error.localizedDescription) }
        }
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
                let backupDirectory = try FileManager.default.url(for: .cachesDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
                let source = try store.backupFile(expected: expected, directory: backupDirectory)
                self.backupRunning = true
                self.backupWriter.async {
                    defer { try? FileManager.default.removeItem(at: source); self.work.async { self.backupRunning = false } }
                    do {
                        let document = try archive.writeFile(name: "auto-backup-\(Int(Date().timeIntervalSince1970 * 1000)).json", mime: "application/json", source: source, purpose: "auto", bookmark: bookmark)
                        let savedAt = try self.work.sync { () throws -> Int in
                            guard try archive.bookmark() == bookmark else { throw LogbookFailure("保存位置已变化；文件保留，未标记新位置已备份。") }
                            let savedAt = Int(Date().timeIntervalSince1970 * 1000)
                            archive.preferences.set(["savedAt": savedAt, "revision": expected], forKey: "coc.automatic-backup")
                            guard archive.preferences.synchronize() else { throw LogbookFailure("备份已写入，但成功状态未保存。") }
                            return savedAt
                        }
                        call.resolve(["document": document, "savedAt": savedAt, "revision": expected, "warning": archive.rotateAutomatic(bookmark: bookmark)])
                    } catch { call.reject(error.localizedDescription) }
                }
            } catch { call.reject(error.localizedDescription) }
        }
    }
}
