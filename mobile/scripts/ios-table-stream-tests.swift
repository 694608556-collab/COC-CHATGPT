import Foundation
import CryptoKit

extension IOSNativeChecks {
    static func tableStreamChecks(root: URL, fixture: LogbookJSON) throws {
        let MiB = 1024 * 1024, free = { 8 * 1024 * 1024 * 1024 }
        let base = root.appendingPathComponent("table-tests"), source = root.appendingPathComponent("table-public.csv")
        try Data("模组名,场次名,手动保存内容\n公开夹具,第一场,完整正文\n".utf8).write(to: source)
        let store = try LogbookStore(url: root.appendingPathComponent("table-db/state.sqlite"), available: free)
        _ = try store.replace(fixture, expected: 0)
        let originalBodies = try store.rows("SELECT id,body FROM records ORDER BY position")
        let oldModule = (fixture["modules"] as! [LogbookJSON])[0]
        func owner(_ kind: String = "record-table") throws -> LogbookTableSession {
            let value = try LogbookTableSession(directory: base, expected: store.revision(), bookmark: Data("public-bookmark".utf8), kind: kind, available: free)
            let input = try FileHandle(forReadingFrom: source); defer { try? input.close() }
            _ = try value.capture(input, name: "公开.csv"); return value
        }
        func row(_ module: String, _ name: String, _ manual: String, link: String = "") -> LogbookJSON {
            ["sheet": "公开表格", "moduleName": module, "sessionName": name, "link": link, "manualContent": manual, "kps": ["KP"], "pairs": [["pc": "PC", "pl": "PL"]]]
        }
        func frame(_ value: LogbookJSON, sheet: Int = 0, row: Int = 0, prefix: String = "T", warnings: [String]? = nil) throws -> Data {
            var wrapper: LogbookJSON = ["sheetOrder": sheet, "rowOrder": row, "value": value]
            if let warnings { wrapper["warnings"] = warnings }
            var bytes = Data(prefix.utf8); bytes.append(try logbookData(wrapper)); bytes.append(10); return bytes
        }
        func append(_ bytes: Data, to session: LogbookTableSession, key: String = "candidate", next: inout Int) throws {
            for start in stride(from: 0, to: bytes.count, by: LogbookLimits.transferChunkBytes) {
                try session.append(key: key, chunkIndex: next, bytes: bytes.subdata(in: start..<min(bytes.count, start + LogbookLimits.transferChunkBytes))); next += 1
            }
        }
        func preview(_ bytes: Data, _ session: LogbookTableSession) throws -> LogbookJSON {
            var next = 0; try append(bytes, to: session, next: &next)
            return try session.preview(LogbookBackupProof(bytes: bytes.count, sha256: LogbookArchive.digest(bytes)), store: store)
        }
        // Out-of-order physical sheets must apply in workbook order. Repeated
        // manual rows update a newly added record, not create duplicate bodies.
        let ordered = try owner()
        var bytes = try frame(row("公开新团", "同名", "最终正文\n😀\u{0000}完整"), sheet: 2)
        bytes.append(try frame(row("公开新团", "同名", "第一份正文"), sheet: 0))
        bytes.append(try frame(row("公开新团", "同名", "中间正文"), sheet: 1))
        let result = try preview(bytes, ordered)
        try require(result["added"] as? Int == 1 && result["updated"] as? Int == 2, "table sorted coordinates and new manual coalescing")
        try require(try store.revision() == 1 && store.rows("SELECT id,body FROM records ORDER BY position") == originalBodies, "table preview never mutates production")
        try ordered.prepareCommit(store: store)
        try require(!FileManager.default.fileExists(atPath: ordered.directory.path), "table cleanup precedes publication")
        _ = try store.importTableStream(ordered); try ordered.close()
        let saved = try store.rows("SELECT body FROM records WHERE json_extract(metadata,'$.name')='同名'")
        try require(saved.count == 1 && logbookObject(saved[0][0])["manualContent"] as? String == "最终正文\n😀\u{0000}完整", "table final complete manual content")
        try require(Array(try store.rows("SELECT id,body FROM records ORDER BY position").prefix(originalBodies.count)) == originalBodies, "table import preserves every previous body byte")

        let duplicate = try owner()
        let link = "https://log.weizaima.com/?key=public-table"
        var links = try frame(row(oldModule["name"] as! String, "链接一", "", link: link))
        links.append(try frame(row(oldModule["name"] as! String, "链接二", "", link: link), row: 1))
        let duplicates = try preview(links, duplicate)
        try require(duplicates["added"] as? Int == 1 && duplicates["skipped"] as? Int == 1, "table duplicate links skip after first candidate")
        try duplicate.close()

        let invalid = try owner()
        try rejects("table rejects external URL") { _ = try preview(frame(row("公开", "坏链接", "", link: "https://example.com/?key=x")), invalid) }
        try invalid.close()
        let changedSource = try owner(); _ = try preview(frame(row("公开", "来源变化", "正文")), changedSource)
        try Data("changed".utf8).write(to: changedSource.sourceURL)
        try rejects("table source hash changes reject before publication") { try changedSource.prepareCommit(store: store) }; try changedSource.close()
        let changedIndex = try owner(); _ = try preview(frame(row("公开", "候选变化", "正文")), changedIndex)
        let tamper = try FileHandle(forWritingTo: changedIndex.directory.appendingPathComponent("index.sqlite"))
        try tamper.seekToEnd(); try tamper.write(contentsOf: Data([1])); try tamper.close()
        try rejects("table sealed index proof changes reject") { try changedIndex.prepareCommit(store: store) }; try changedIndex.close()
        let cleanupFailure = try owner(); _ = try preview(frame(row("公开", "清理失败", "正文")), cleanupFailure)
        let unexpectedFile = cleanupFailure.directory.appendingPathComponent("user-unowned-file")
        try Data("public keep".utf8).write(to: unexpectedFile)
        try rejects("table cleanup failure blocks commit") { try cleanupFailure.prepareCommit(store: store) }
        try require(FileManager.default.fileExists(atPath: unexpectedFile.path), "table cleanup preserves unowned file")
        try FileManager.default.removeItem(at: unexpectedFile); try cleanupFailure.close()
        let coordinates = try owner(); let repeated = try frame(row("公开", "重复坐标", "正文"))
        try rejects("table duplicate frame coordinates") { _ = try preview(repeated + repeated, coordinates) }; try coordinates.close()
        let unknown = try owner(); var unexpected = row("公开", "未知权限", "正文"); unexpected["rawContent"] = [:]
        try rejects("table row cannot restore arbitrary raw body") { _ = try preview(frame(unexpected), unknown) }; try unknown.close()

        let before = try store.rows("SELECT id,body FROM records ORDER BY position"), revision = try store.revision()
        let rollback = try owner(); _ = try preview(frame(row("回滚公开团", "事务", "必须回滚")), rollback)
        try rollback.prepareCommit(store: store)
        try store.execute("CREATE TRIGGER fail_table_root BEFORE UPDATE ON state BEGIN SELECT RAISE(ABORT,'public injected failure'); END")
        try rejects("table production SQLite failure rolls back") { _ = try store.importTableStream(rollback) }
        try rollback.close(); try store.execute("DROP TRIGGER fail_table_root")
        try require(try store.revision() == revision && store.rows("SELECT id,body FROM records ORDER BY position") == before, "table transaction preserves revision and bodies on failure")
        let revoked = try owner(); _ = try preview(frame(row("授权回滚", "事务", "必须回滚")), revoked); try revoked.prepareCommit(store: store)
        var authorizations = 0
        try rejects("table permission loss before COMMIT rolls back") {
            _ = try store.importTableStream(revoked) { authorizations += 1; if authorizations == 2 { throw LogbookFailure("public permission revoked") } }
        }
        try revoked.close()
        try require(try store.revision() == revision && store.rows("SELECT id,body FROM records ORDER BY position") == before, "table final authorization rollback")
        let stale = try owner(); _ = try preview(frame(row("过期", "事务", "正文")), stale)
        _ = try store.mutate(expected: revision) { $0["exportedAt"] = logbookNow() }
        try rejects("table CAS rejects stale preview") { try stale.prepareCommit(store: store) }; try stale.close()

        // Total SST >64MiB stays on disk; byte offsets may split UTF-8 and NUL.
        let strings = try owner(); var stringChunk = 0
        let text = String(repeating: "s", count: MiB) + "😀\u{0000}尾"
        for number in 0..<65 {
            var bytes = try logbookData([number, text]); bytes.append(10)
            try append(bytes, to: strings, key: "strings", next: &stringChunk)
        }
        let tail = try strings.readString(64, offset: MiB + 1)
        let all = Data(text.utf8)
        try require(tail["bytes"] as? Int == all.count && tail["done"] as? Bool == true && Data(base64Encoded: tail["base64"] as! String) == all.subdata(in: (MiB + 1)..<all.count), "SST above 64MiB bounded UTF8 byte-offset reading")
        try rejects("SST missing index") { _ = try strings.readString(65, offset: 0) }; try strings.close()

        // Candidate total exceeds64MiB while each complete record is1MiB.
        let large = try owner(); var chunk = 0, total = 0, hash = SHA256()
        let body = String(repeating: "B", count: MiB)
        for number in 0..<65 {
            let bytes = try frame(row("公开大表", "完整场次\(number)", body), row: number)
            try append(bytes, to: large, next: &chunk); total += bytes.count; hash.update(data: bytes)
        }
        try require(total > 64 * MiB, "public table candidate exceeds former quota")
        let largeProof = LogbookBackupProof(bytes: total, sha256: hash.finalize().map { String(format: "%02x", $0) }.joined())
        let largePreview = try large.preview(largeProof, store: store)
        try require(largePreview["added"] as? Int == 65, "large table preview retains all records")
        try large.prepareCommit(store: store); _ = try store.importTableStream(large); try large.close()
        try require(try store.rows("SELECT COUNT(*) FROM records WHERE json_extract(metadata,'$.name') LIKE '完整场次%'")[0][0] == "65", "large table writes every record")
        try require(try store.rows("SELECT MIN(length(json_extract(body,'$.manualContent'))),MAX(length(json_extract(body,'$.manualContent'))) FROM records WHERE json_extract(metadata,'$.name') LIKE '完整场次%'")[0] == [String(MiB), String(MiB)], "large table complete body lengths")

        // This exercises the removed50000 entity gate without retaining bodies
        // or a candidate array. Empty-body records remain individually tiny.
        try autoreleasepool {
            let many = try owner(); var next = 0, total = 0, hash = SHA256()
            for number in 0..<50001 {
                try autoreleasepool {
                    let bytes = try frame(row("公开数量测试", "数量\(number)", ""), row: number)
                    try append(bytes, to: many, next: &next); total += bytes.count; hash.update(data: bytes)
                }
            }
            let proof = LogbookBackupProof(bytes: total, sha256: hash.finalize().map { String(format: "%02x", $0) }.joined())
            let result = try many.preview(proof, store: store)
            try require(result["added"] as? Int == 50001, "table has no50000 candidate entity quota")
            try many.prepareCommit(store: store); _ = try store.importTableStream(many); try many.close()
            try require(try store.rows("SELECT COUNT(*) FROM records WHERE json_extract(metadata,'$.name') LIKE '数量%'")[0][0] == "50001", "table commits every entity beyond50000")
        }

        let paged = try owner(); var pages = Data()
        for number in 0..<105 { pages.append(try frame(row("分页", "页\(number)", "完整"), row: number)) }
        let pagePreview = try preview(pages, paged)
        try require((pagePreview["names"] as! [String]).count == 100 && pagePreview["namesCount"] as? Int == 105, "table initial preview bounded at100")
        try require((try paged.page("names", offset: 100, limit: 100)["values"] as! [String]).count == 5, "table remaining preview page")
        try paged.close()

        var card = (fixture["characters"] as! [LogbookJSON])[0]; card["id"] = UUID().uuidString.lowercased()
        let characters = try owner("character-table")
        let cards = try preview(frame(card, prefix: "C", warnings: ["公开识别提醒"]), characters)
        try require(cards["added"] as? Int == 1 && cards["warningsCount"] as? Int == 1, "character stream retains recognition warnings")
        try characters.prepareCommit(store: store); _ = try store.importTableStream(characters); try characters.close()

        // Body-free metadata itself may exceed64MiB. Neither overview nor the
        // next transaction imposes the former whole-library metadata ceiling.
        try autoreleasepool {
            let metadata = try owner(); var next = 0, total = 0, hash = SHA256()
            let longName = String(repeating: "N", count: 128 * 1024)
            for number in 0..<513 {
                try autoreleasepool {
                    let bytes = try frame(row("公开元数据测试", longName + String(number), ""), row: number)
                    try append(bytes, to: metadata, next: &next); total += bytes.count; hash.update(data: bytes)
                }
            }
            let proof = LogbookBackupProof(bytes: total, sha256: hash.finalize().map { String(format: "%02x", $0) }.joined())
            _ = try metadata.preview(proof, store: store); try metadata.prepareCommit(store: store)
            _ = try store.importTableStream(metadata); try metadata.close()
            let summary = try store.metadata()!
            try require(try logbookData(summary).count > 64 * MiB, "metadata overview above64MiB remains readable")
            let current = try store.revision()
            _ = try store.mutate(expected: current) { $0["exportedAt"] = logbookNow() }
            try require(try store.revision() == current + 1, "metadata above64MiB does not block later transaction")
        }

        let cancelled = try owner(), cancelledDirectory = cancelled.directory; try cancelled.close()
        try require(!FileManager.default.fileExists(atPath: cancelledDirectory.path), "table exact owner cancellation cleanup")
        let abandoned = try owner(); try LogbookTableSession.cleanupStale(base)
        try require(!FileManager.default.fileExists(atPath: abandoned.directory.path), "table owned restart cleanup"); try abandoned.close()
        try rejects("table unavailable capacity") { _ = try LogbookTableSession(directory: base, expected: 0, bookmark: Data(), kind: "record-table", available: { 0 }) }
        try autoreleasepool {
            let largeSource = root.appendingPathComponent("public-large-table.csv")
            try Data().write(to: largeSource, options: [.withoutOverwriting])
            let output = try FileHandle(forWritingTo: largeSource)
            for _ in 0..<65 { try output.write(contentsOf: Data(repeating: 65, count: MiB)) }
            try output.close()
            let captured = try LogbookTableSession(directory: base, expected: store.revision(), bookmark: Data(), kind: "record-table", available: free)
            let input = try FileHandle(forReadingFrom: largeSource)
            let proof = try captured.capture(input, name: "公开65MiB.csv"); try input.close()
            try require(proof["bytes"] as? Int == 65 * MiB, "picked table source has no64MiB total cap")
            try captured.close(); try FileManager.default.removeItem(at: largeSource)
        }
    }
}
