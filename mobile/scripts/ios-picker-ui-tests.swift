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
    func testPublicNameCandidatesWithNativeKeyboard() throws {
        let app = XCUIApplication(bundleIdentifier: "coc.logbook")
        app.launchArguments = ["--coc-picker-ui", "--coc-picker-ui-fresh", "-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launch()
        let web = app.webViews
        let local = web.buttons["使用本机归档文件夹"].firstMatch
        XCTAssertTrue(local.waitForExistence(timeout: 30), app.debugDescription)
        local.tap()
        let add = web.buttons["新增模组"].firstMatch
        XCTAssertTrue(add.waitForExistence(timeout: 30), app.debugDescription)
        add.tap()
        let title = "Public Keyboard " + String(UUID().uuidString.prefix(6))
        let moduleName = web.textFields["模组名称"].firstMatch
        XCTAssertTrue(moduleName.waitForExistence(timeout: 10), app.debugDescription)
        moduleName.tap(); moduleName.typeText(title)
        web.buttons["＋ 添加参与者"].firstMatch.tap()
        let pc1 = web.comboBoxes["PC1"].firstMatch
        XCTAssertTrue(pc1.waitForExistence(timeout: 10), app.debugDescription)
        pc1.tap(); pc1.typeText("Public Alpha")
        web.buttons["＋ 添加参与者"].firstMatch.tap()
        let pc2 = web.comboBoxes["PC2"].firstMatch
        XCTAssertTrue(pc2.waitForExistence(timeout: 10), app.debugDescription)
        pc2.tap(); pc2.typeText("Public Beta")
        web.buttons["保存修改"].firstMatch.tap()
        XCTAssertTrue(add.waitForExistence(timeout: 15), app.debugDescription)
        web.buttons["角色卡"].firstMatch.tap()
        web.buttons["新建七版角色"].firstMatch.tap()
        let moduleCheck = web.descendants(matching: .any).matching(NSPredicate(format: "label == %@", String(title))).firstMatch
        XCTAssertTrue(moduleCheck.waitForExistence(timeout: 10), app.debugDescription)
        moduleCheck.tap()
        let name = web.comboBoxes["姓名"].firstMatch
        XCTAssertTrue(name.waitForExistence(timeout: 10), app.debugDescription)
        name.tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 10), app.debugDescription)
        let beta = web.staticTexts["Public Beta"].firstMatch
        XCTAssertTrue(beta.waitForExistence(timeout: 10), app.debugDescription)
        XCTAssertGreaterThanOrEqual(beta.frame.minY, app.frame.minY + 40)
        XCTAssertLessThanOrEqual(beta.frame.maxY, app.keyboards.firstMatch.frame.minY)
        beta.tap()
        XCTAssertEqual(name.value as? String, "Public Beta", app.debugDescription)
        name.tap()
        let alpha = web.staticTexts["Public Alpha"].firstMatch
        XCTAssertTrue(alpha.waitForExistence(timeout: 10), app.debugDescription)
        alpha.tap()
        XCTAssertEqual(name.value as? String, "Public Alpha", app.debugDescription)
        web.buttons["保存修改"].firstMatch.tap()
        XCTAssertTrue(web.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Public Alpha'")).firstMatch.waitForExistence(timeout: 15), app.debugDescription)
    }

}
