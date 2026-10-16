import Foundation
import CoreFoundation

enum LogbookValidation {
    static func fail(_ message: String = "数据字段不完整或类型不合法。") throws -> Never { throw LogbookFailure(message) }
    static func shape(_ value: LogbookJSON, _ required: String, _ optional: String = "") throws {
        let needed = Set(required.split(separator: ",").map(String.init))
        let allowed = needed.union(optional.split(separator: ",").map(String.init))
        guard needed.isSubset(of: Set(value.keys)), Set(value.keys).isSubset(of: allowed) else { try fail() }
    }
    static func strings(_ value: LogbookJSON, _ fields: String) throws {
        for key in fields.split(separator: ",").map(String.init) where value[key] != nil { guard value[key] is String else { try fail() } }
    }
    static func number(_ value: Any?) -> Bool {
        guard let value = value as? NSNumber else { return false }
        return CFGetTypeID(value) != CFBooleanGetTypeID() && value.doubleValue.isFinite
    }
    static func bool(_ value: Any?) -> Bool {
        guard let value = value as? NSNumber else { return false }
        return CFGetTypeID(value) == CFBooleanGetTypeID()
    }
    static func numbers(_ value: LogbookJSON, _ fields: String) throws {
        for key in fields.split(separator: ",").map(String.init) where value[key] != nil { guard number(value[key]) else { try fail() } }
    }
    static func objects(_ value: Any?) throws -> [LogbookJSON] { guard let rows = value as? [LogbookJSON] else { try fail() }; return rows }
    static func ids(_ rows: [LogbookJSON]) throws -> Set<String> {
        var result: Set<String> = []
        for row in rows { guard let id = row["id"] as? String, !id.isEmpty, result.insert(id).inserted else { try fail("实体标识无效或重复。") } }
        return result
    }
    static func settings(_ value: LogbookJSON) throws {
        try shape(value, "theme,filterPreset", "autoBackup")
        guard ["light", "dark"].contains(value["theme"] as? String ?? ""), let filters = value["filterPreset"] as? LogbookJSON else { try fail() }
        let keys = "hideDiceCommands,hideImages,hideOffTopic,hideTime,hidePlatformAccount,hideYearMonthDay,indentFirstLine,darkDisplay"
        try shape(filters, keys)
        guard filters.values.allSatisfy({ bool($0) }) else { try fail() }
        if let automatic = value["autoBackup"] {
            guard let automatic = automatic as? LogbookJSON else { try fail() }
            try shape(automatic, "enabled,interval,retention")
            guard bool(automatic["enabled"]), ["idle", "daily", "weekly"].contains(automatic["interval"] as? String ?? ""), number(automatic["retention"]), (automatic["retention"] as? NSNumber)?.intValue == 10 else { try fail() }
        }
    }
    static func module(_ value: LogbookJSON) throws {
        try shape(value, "id,name,playStatus,kps,pairs,order,collapsed,createdAt,updatedAt")
        try strings(value, "id,name,playStatus,createdAt,updatedAt"); try numbers(value, "order")
        guard value["kps"] is [String], bool(value["collapsed"]), ["running", "finished", "not_started"].contains(value["playStatus"] as? String ?? "") else { try fail() }
        for pair in try objects(value["pairs"]) { try shape(pair, "pc,pl", "characterId"); try strings(pair, "pc,pl,characterId") }
    }
    static func character(_ value: LogbookJSON) throws {
        try shape(value, "id,moduleIds,edition,basic,attrs,editionSnapshots,derived,occupationFormula,skills,weapons,items,background,story,createdAt,updatedAt", "moduleId,occupationPointOverride")
        try strings(value, "id,moduleId,occupationFormula,story,createdAt,updatedAt"); try numbers(value, "edition,occupationPointOverride")
        guard let edition = value["edition"] as? NSNumber, [6.0, 7.0].contains(edition.doubleValue), value["moduleIds"] is [String], let basic = value["basic"] as? LogbookJSON, let attrs = value["attrs"] as? LogbookJSON, let derived = value["derived"] as? LogbookJSON, let snapshots = value["editionSnapshots"] as? LogbookJSON, let background = value["background"] as? LogbookJSON, value["items"] is [String] else { try fail() }
        try shape(basic, "name,occupation,age,gender,birthplace,residence"); try strings(basic, "name,occupation,age,gender,birthplace,residence")
        try shape(attrs, "STR,CON,SIZ,DEX,APP,INT,POW,EDU"); try numbers(attrs, "STR,CON,SIZ,DEX,APP,INT,POW,EDU")
        try shape(derived, "hpCurrent,mpCurrent,sanCurrent,db", "luck6,luck7"); try strings(derived, "db"); try numbers(derived, "hpCurrent,mpCurrent,sanCurrent,luck6,luck7")
        for values in snapshots.values { guard let values = values as? LogbookJSON, values.values.allSatisfy({ number($0) }) else { try fail() } }
        guard background.values.allSatisfy({ $0 is String }) else { try fail() }
        for skill in try objects(value["skills"]) {
            try shape(skill, "id,name,base,occupation,interest,growth", "hidden,builtIn,mappingState")
            try strings(skill, "id,name,mappingState"); try numbers(skill, "base,occupation,interest,growth")
            for flag in ["hidden", "builtIn"] where skill[flag] != nil { guard bool(skill[flag]) else { try fail() } }
            if let mapping = skill["mappingState"] as? String { guard ["ok", "review", "unmapped"].contains(mapping) else { try fail() } }
        }
        for weapon in try objects(value["weapons"]) { guard weapon.values.allSatisfy({ $0 is String || number($0) }) else { try fail() } }
    }
    static func record(_ value: LogbookJSON) throws {
        try shape(value, "id,moduleId,name,sequenceNo,sourceType,status,dateSource,order,createdAt,updatedAt", "link,previousStatus,playDate,manualContent,lastError,rawContent,cacheSourceUrl,fetchedAt")
        try strings(value, "id,moduleId,name,sourceType,status,dateSource,createdAt,updatedAt,link,previousStatus,playDate,manualContent,lastError,cacheSourceUrl,fetchedAt")
        try numbers(value, "sequenceNo,order")
        guard let sequence = value["sequenceNo"] as? NSNumber, sequence.doubleValue >= 0, sequence.doubleValue.rounded(.down) == sequence.doubleValue, ["online", "manual"].contains(value["sourceType"] as? String ?? ""), ["pending", "valid", "invalid", "fetch_failed", "manual"].contains(value["status"] as? String ?? ""), ["parsed", "manual", "none"].contains(value["dateSource"] as? String ?? "") else { try fail() }
        if let previous = value["previousStatus"] as? String { guard ["pending", "valid", "invalid", "fetch_failed", "manual"].contains(previous) else { try fail() } }
        if let raw = value["rawContent"] {
            guard let raw = raw as? LogbookJSON, number(raw["parserVersion"]) else { try fail() }
            try shape(raw, "parserVersion,messages", "title,sourceUrl,responseHash"); try strings(raw, "title,sourceUrl,responseHash")
            for message in try objects(raw["messages"]) {
                try shape(message, "id,order,displayName,text,type,isDiceCommand,isOffTopic,images", "timestamp,platformAccount,raw")
                try strings(message, "id,displayName,text,type,timestamp,platformAccount"); try numbers(message, "order")
                guard bool(message["isDiceCommand"]), bool(message["isOffTopic"]) else { try fail() }
                for image in try objects(message["images"]) { try shape(image, "url", "alt"); try strings(image, "url,alt") }
            }
            if value["sourceType"] as? String == "online" {
                for url in [value["cacheSourceUrl"], raw["sourceUrl"]].compactMap({ $0 as? String }) where !url.isEmpty { guard url == value["link"] as? String else { try fail("正文来源与场次链接不一致。") } }
            }
        }
    }
    static func snapshot(_ value: LogbookJSON, metadataOnly: Bool = false) throws {
        try shape(value, "schemaVersion,exportedAt,modules,records,characters,settings")
        guard number(value["schemaVersion"]), (value["schemaVersion"] as? NSNumber)?.intValue == 2, value["exportedAt"] is String, let settings = value["settings"] as? LogbookJSON else { try fail("备份版本或结构不兼容。") }
        try self.settings(settings)
        let modules = try objects(value["modules"]), records = try objects(value["records"]), characters = try objects(value["characters"])
        let mids = try ids(modules), cids = try ids(characters); _ = try ids(records)
        for module in modules {
            try self.module(module)
            for pair in try objects(module["pairs"]) {
                if let id = pair["characterId"] as? String {
                    guard cids.contains(id) else { try fail("参与者关联失效。") }
                }
            }
        }
        for character in characters {
            try self.character(character)
            let linked = character["moduleIds"] as! [String]
            guard Set(linked).count == linked.count, Set(linked).isSubset(of: mids) else { try fail("角色模组关联失效或重复。") }
            if let id = character["moduleId"] as? String { guard mids.contains(id) else { try fail("角色归属失效。") } }
        }
        for record in records { try self.record(record); guard mids.contains(record["moduleId"] as! String) else { try fail("场次模组关联失效。") } }
    }
}
