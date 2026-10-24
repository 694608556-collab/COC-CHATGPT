import Foundation

/// Only public key spellings. Run the old proof for an observable baseline,
/// then require the new upload reader to retain the original Swift behavior.
@main struct IOSUploadKeyChecks {
    static func main() throws {
        let inputs = [#"{"\u00e9":1,"e\u0301":2}"#, #"{"nested":{"\u212b":1,"A\u030a":2}}"#]
        let observe = CommandLine.arguments.contains("--observe-baseline")
        var accepted = 0
        for text in inputs {
            let data = Data(text.utf8)
            do { _ = try LogbookBackupJSON.uploadObject(data, budget: 256 * 1024 * 1024); accepted += 1 }
            catch { }
        }
        print("PUBLIC_UPLOAD_UNICODE_KEYS baseline=\(observe) accepted=\(accepted) tested=\(inputs.count)")
        if !observe && accepted != 0 { throw LogbookFailure("Upload must retain canonical-equivalent duplicate key rejection") }
        let valid = Data(#"{"中文😀":"完整保留","nested":{"é":1}}"#.utf8)
        guard try logbookData(LogbookBackupJSON.uploadObject(valid, budget: 256 * 1024 * 1024)) == logbookData(LogbookBackupJSON.object(valid)) else { throw LogbookFailure("Valid Unicode keys must retain complete fallback") }
    }
}
