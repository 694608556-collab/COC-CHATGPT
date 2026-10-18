import XCTest

final class PickerUITests: XCTestCase {
    func testFolderOpenReturnsAndSurvivesRestart() throws {
        let app = XCUIApplication(bundleIdentifier: "coc.logbook")
        app.launchArguments = ["--coc-picker-ui", "-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launch()
        let choose = app.webViews.buttons["选择并确认保存位置"].firstMatch
        XCTAssertTrue(choose.waitForExistence(timeout: 30), app.debugDescription)
        choose.tap()
        let folder = app.staticTexts["COC-Picker-Public-Test"].firstMatch
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
        app.launch()
        XCTAssertTrue(app.webViews.buttons["新增模组"].firstMatch.waitForExistence(timeout: 30), app.debugDescription)
        XCTAssertFalse(app.webViews.buttons["选择并确认保存位置"].firstMatch.exists)
    }
}
