import XCTest

final class PickerUITests: XCTestCase {
    func testFolderOpenReturnsAndSurvivesRestart() throws {
        let app = XCUIApplication(bundleIdentifier: "coc.logbook")
        app.launchArguments = ["--coc-picker-ui", "--coc-picker-ui-fresh", "-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launch()
        let choose = app.webViews.buttons["选择并确认保存位置"].firstMatch
        XCTAssertTrue(choose.waitForExistence(timeout: 30), app.debugDescription)
        choose.tap()
        let folder = app.staticTexts["COC-Picker-Public-Test"].firstMatch
        // iOS 27 may start at On My iPhone despite directoryURL. Enter the
        // observed application container rather than assuming the hint was honored.
        if !folder.waitForExistence(timeout: 3) {
            let container = app.cells["COC 跑团记录簿, Container"].firstMatch
            XCTAssertTrue(container.waitForExistence(timeout: 15), app.debugDescription)
            container.tap()
        }
        XCTAssertTrue(folder.waitForExistence(timeout: 20), app.debugDescription)
        folder.tap()
        let open = app.buttons.matching(NSPredicate(format: "label IN %@", ["Open", "打开"])).firstMatch
        XCTAssertTrue(open.waitForExistence(timeout: 10), app.debugDescription)
        open.tap()
        let gateGone = NSPredicate(format: "exists == false")
        expectation(for: gateGone, evaluatedWith: choose)
        waitForExpectations(timeout: 30)
        XCTAssertTrue(app.webViews.buttons["新增模组"].firstMatch.waitForExistence(timeout: 15), app.debugDescription)
        app.terminate()
        app.launchArguments.removeAll { $0 == "--coc-picker-ui-fresh" }
        app.launch()
        XCTAssertTrue(app.webViews.buttons["新增模组"].firstMatch.waitForExistence(timeout: 30), app.debugDescription)
        XCTAssertFalse(app.webViews.buttons["选择并确认保存位置"].firstMatch.exists)
    }

    func testExplicitLocalFolderReturnsAndSurvivesRestart() throws {
        let app = XCUIApplication(bundleIdentifier: "coc.logbook")
        app.launchArguments = ["--coc-picker-ui", "--coc-picker-ui-fresh"]
        app.launch()
        let local = app.webViews.buttons["使用本机归档文件夹"].firstMatch
        XCTAssertTrue(local.waitForExistence(timeout: 30), app.debugDescription)
        local.tap()
        let add = app.webViews.buttons["新增模组"].firstMatch
        XCTAssertTrue(add.waitForExistence(timeout: 30), app.debugDescription)
        XCTAssertFalse(app.webViews.buttons["选择并确认保存位置"].firstMatch.exists)
        app.terminate()
        app.launchArguments.removeAll { $0 == "--coc-picker-ui-fresh" }
        app.launch()
        XCTAssertTrue(app.webViews.buttons["新增模组"].firstMatch.waitForExistence(timeout: 30), app.debugDescription)
    }
}
