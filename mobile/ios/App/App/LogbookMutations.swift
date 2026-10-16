import Foundation

enum LogbookMutations {
    private static func replace(_ rows: inout [LogbookJSON], _ value: LogbookJSON) {
        if let index = rows.firstIndex(where: { $0["id"] as? String == value["id"] as? String }) { rows[index] = value } else { rows.append(value) }
    }
    static func module(_ proposed: LogbookJSON, data: inout LogbookJSON) throws {
        try LogbookValidation.module(proposed)
        var value = proposed
        let id = value["id"] as! String, name = (value["name"] as! String).trimmingCharacters(in: .whitespacesAndNewlines)
        guard !id.isEmpty, !name.isEmpty else { throw LogbookFailure("请填写模组名称。") }
        var modules = data["modules"] as! [LogbookJSON], characters = data["characters"] as! [LogbookJSON]
        let known = try LogbookValidation.ids(characters)
        let linked = Set((value["pairs"] as! [LogbookJSON]).compactMap { $0["characterId"] as? String })
        guard linked.isSubset(of: known) else { throw LogbookFailure("角色关联已失效。") }
        value["name"] = name; value["kps"] = (value["kps"] as! [String]).map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
        value["createdAt"] = modules.first(where: { $0["id"] as? String == id })?["createdAt"] ?? value["createdAt"]
        value["updatedAt"] = logbookNow(); replace(&modules, value)
        for index in characters.indices where linked.contains(characters[index]["id"] as! String) {
            var ids = characters[index]["moduleIds"] as! [String]
            if !ids.contains(id) { ids.append(id); characters[index]["moduleIds"] = ids }
            if characters[index]["moduleId"] == nil { characters[index]["moduleId"] = id }
        }
        data["modules"] = modules; data["characters"] = characters
    }
    static func entity(_ edit: LogbookJSON, data: inout LogbookJSON) throws {
        try LogbookValidation.shape(edit, "kind,value")
        guard let kind = edit["kind"] as? String, var value = edit["value"] as? LogbookJSON else { throw LogbookFailure("编辑请求不完整。") }
        let modules = data["modules"] as! [LogbookJSON]
        if kind == "character" {
            try LogbookValidation.character(value)
            var basic = value["basic"] as! LogbookJSON
            let name = (basic["name"] as! String).trimmingCharacters(in: .whitespacesAndNewlines)
            guard !name.isEmpty else { throw LogbookFailure("请填写角色姓名。") }
            let ids = value["moduleIds"] as! [String]
            guard Set(ids).count == ids.count, Set(ids).isSubset(of: try LogbookValidation.ids(modules)) else { throw LogbookFailure("关联模组已失效或重复。") }
            basic["name"] = name; value["basic"] = basic
            value["moduleId"] = ids.first
            var characters = data["characters"] as! [LogbookJSON]
            value["createdAt"] = characters.first(where: { $0["id"] as? String == value["id"] as? String })?["createdAt"] ?? value["createdAt"]
            value["updatedAt"] = logbookNow(); replace(&characters, value); data["characters"] = characters
            // Character association never creates or renames module PC/PL entries.
        } else if kind == "record" {
            try LogbookValidation.shape(value, "id,moduleId,name,sequenceNo,sourceType,status,dateSource,order,createdAt,updatedAt", "link,previousStatus,playDate,manualContent,lastError")
            try LogbookValidation.record(value)
            guard (try LogbookValidation.ids(modules)).contains(value["moduleId"] as! String) else { throw LogbookFailure("所属模组不存在。") }
            var records = data["records"] as! [LogbookJSON]
            let old = records.first { $0["id"] as? String == value["id"] as? String }
            let unchanged = old != nil && old?["sourceType"] as? String == value["sourceType"] as? String && (old?["link"] as? String ?? "") == (value["link"] as? String ?? "")
            if value["sourceType"] as? String == "online" {
                if !unchanged {
                    guard let link = value["link"] as? String, let url = URLComponents(string: link), url.host == "log.weizaima.com", ["http", "https"].contains(url.scheme ?? ""), url.user == nil, url.password == nil, url.port == nil, url.queryItems?.contains(where: { $0.name == "key" && !($0.value ?? "").isEmpty }) == true else { throw LogbookFailure("请输入包含 key 参数的完整海豹日志网址。") }
                }
                guard !records.contains(where: { $0["id"] as? String != value["id"] as? String && $0["moduleId"] as? String == value["moduleId"] as? String && $0["link"] as? String == value["link"] as? String }) else { throw LogbookFailure("同一模组已有此来源链接。") }
                value.removeValue(forKey: "manualContent")
            }
            if let old {
                value["createdAt"] = old["createdAt"]
                if unchanged { for key in ["cacheSourceUrl", "fetchedAt"] { value[key] = old[key] } }
                else { value.removeValue(forKey: "lastError"); value["status"] = value["sourceType"] as? String == "manual" ? "manual" : "pending" }
            }
            value["updatedAt"] = logbookNow(); replace(&records, value); data["records"] = records
        } else { throw LogbookFailure("不支持此编辑类型。") }
    }
    static func action(_ action: LogbookJSON, data: inout LogbookJSON) throws {
        guard let type = action["type"] as? String else { throw LogbookFailure("操作类型缺失。") }
        var modules = data["modules"] as! [LogbookJSON], records = data["records"] as! [LogbookJSON], characters = data["characters"] as! [LogbookJSON]
        if type == "clear" { modules = []; records = []; characters = [] }
        else if type == "delete-records" {
            guard let ids = action["ids"] as? [String], !ids.isEmpty, Set(ids).count == ids.count, Set(ids).isSubset(of: try LogbookValidation.ids(records)) else { throw LogbookFailure("场次选择无效或已变化。") }
            let selected = Set(ids); records.removeAll { selected.contains($0["id"] as! String) }
        } else if type == "delete" {
            guard let kind = action["kind"] as? String, let id = action["id"] as? String else { throw LogbookFailure("删除目标缺失。") }
            let source = kind == "module" ? modules : kind == "record" ? records : characters
            guard source.contains(where: { $0["id"] as? String == id }) else { throw LogbookFailure("目标已不存在。") }
            if kind == "module" {
                modules.removeAll { $0["id"] as? String == id }; records.removeAll { $0["moduleId"] as? String == id }
                for index in characters.indices {
                    let ids = (characters[index]["moduleIds"] as! [String]).filter { $0 != id }
                    characters[index]["moduleIds"] = ids; characters[index]["moduleId"] = ids.first
                }
            } else if kind == "record" { records.removeAll { $0["id"] as? String == id } }
            else if kind == "character" {
                characters.removeAll { $0["id"] as? String == id }
                for index in modules.indices {
                    modules[index]["pairs"] = (modules[index]["pairs"] as! [LogbookJSON]).map { pair -> LogbookJSON in var pair = pair; if pair["characterId"] as? String == id { pair.removeValue(forKey: "characterId") }; return pair }
                }
            } else { throw LogbookFailure("删除类型无效。") }
        } else if type == "reorder" {
            guard let kind = action["kind"] as? String, ["module", "record"].contains(kind), let id = action["id"] as? String, let target = action["targetId"] as? String else { throw LogbookFailure("排序参数无效。") }
            let source = kind == "module" ? modules : records
            guard let selected = source.first(where: { $0["id"] as? String == id }) else { throw LogbookFailure("目标已不存在。") }
            var ordered = source.filter { kind == "module" || $0["moduleId"] as? String == selected["moduleId"] as? String }.sorted { ($0["order"] as! NSNumber).doubleValue < ($1["order"] as! NSNumber).doubleValue }
            guard let from = ordered.firstIndex(where: { $0["id"] as? String == id }), let to = ordered.firstIndex(where: { $0["id"] as? String == target }) else { throw LogbookFailure("只能在同一列表内排序。") }
            let moved = ordered.remove(at: from); ordered.insert(moved, at: to)
            let order = Dictionary(uniqueKeysWithValues: ordered.enumerated().map { ($0.element["id"] as! String, $0.offset) })
            let changed = source.map { row -> LogbookJSON in var row = row; if let index = order[row["id"] as! String] { row["order"] = index }; return row }
            if kind == "module" { modules = changed } else { records = changed }
        } else if type == "reset" {
            guard let id = action["id"] as? String, let index = records.firstIndex(where: { $0["id"] as? String == id }) else { throw LogbookFailure("场次已不存在。") }
            if records[index]["sourceType"] as? String == "online" { records[index]["previousStatus"] = records[index]["status"]; records[index]["status"] = "pending"; records[index].removeValue(forKey: "lastError") }
        } else { throw LogbookFailure("不支持此列表操作。") }
        data["modules"] = modules; data["records"] = records; data["characters"] = characters
    }
}
