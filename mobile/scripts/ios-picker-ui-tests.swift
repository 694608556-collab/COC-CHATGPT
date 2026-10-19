import XCTest

final class PickerUITests: XCTestCase {
    override func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    private func dismissFixtureKeyboard(_ app: XCUIApplication) {
        let done = app.buttons["Done"].firstMatch
        if done.exists { done.tap() }
    }

    private func editable(_ web: XCUIElementQuery, _ label: String) -> XCUIElement {
        // Match the editable accessibility node without assuming WebKit's native
        // role mapping. Exclude static label nodes, which also expose a value.
        web.descendants(matching: .any).matching(NSPredicate(format: "label == %@ AND value != nil AND elementType != %d", label, XCUIElement.ElementType.staticText.rawValue)).firstMatch
    }

    private func pickPublicCoc7(_ app: XCUIApplication) {
        app.webViews.buttons["导入七版角色卡"].firstMatch.tap()
        let file = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "public-coc7")).firstMatch
        if !file.waitForExistence(timeout: 5) {
            let container = app.cells["COC 跑团记录簿, Container"].firstMatch
            if container.waitForExistence(timeout: 5) { container.tap() }
            let folder = app.staticTexts["COC-Picker-Public-Test"].firstMatch
            if folder.waitForExistence(timeout: 5) { folder.tap() }
        }
        XCTAssertTrue(file.waitForExistence(timeout: 15), app.debugDescription)
        file.tap()
        let title = app.webViews.staticTexts["导入七版角色卡预览"].firstMatch
        if !title.waitForExistence(timeout: 3) {
            let open = app.buttons.matching(NSPredicate(format: "label IN %@", ["Open", "打开"])).firstMatch
            if open.exists { open.tap() }
        }
        XCTAssertTrue(title.waitForExistence(timeout: 15), app.debugDescription)
    }

    func testCoc7ImportPickerCancelSaveAndRestart() throws {
        let app = XCUIApplication(bundleIdentifier: "coc.logbook")
        app.launchArguments = ["--coc-picker-ui", "--coc-picker-ui-fresh", "-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launch()
        let web = app.webViews
        let local = web.buttons["使用本机归档文件夹"].firstMatch
        XCTAssertTrue(local.waitForExistence(timeout: 30), app.debugDescription)
        local.tap()
        XCTAssertTrue(web.buttons["新增模组"].firstMatch.waitForExistence(timeout: 30), app.debugDescription)
        web.buttons["角色卡"].firstMatch.tap()
        pickPublicCoc7(app)
        XCTAssertTrue(web.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "6项技能、4项物品")).firstMatch.exists, app.debugDescription)
        XCTAssertEqual(web.textFields["居住地"].firstMatch.value as? String, "公开居住地", app.debugDescription)
        XCTAssertEqual(web.textFields["故乡"].firstMatch.value as? String, "公开故乡", app.debugDescription)
        web.buttons["取消编辑"].firstMatch.tap()
        let saved = web.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "公开七版调查员")).firstMatch
        XCTAssertFalse(saved.exists, app.debugDescription)
        pickPublicCoc7(app)
        web.buttons["保存修改"].firstMatch.tap()
        XCTAssertTrue(saved.waitForExistence(timeout: 15), app.debugDescription)
        app.terminate()
        app.launchArguments.removeAll { $0 == "--coc-picker-ui-fresh" }
        app.launch()
        XCTAssertTrue(web.buttons["新增模组"].firstMatch.waitForExistence(timeout: 30), app.debugDescription)
        web.buttons["角色卡"].firstMatch.tap()
        XCTAssertTrue(saved.waitForExistence(timeout: 15), app.debugDescription)
        saved.tap()
        XCTAssertTrue(web.staticTexts["取悦"].firstMatch.exists, app.debugDescription)
        XCTAssertFalse(web.staticTexts["会计"].firstMatch.exists, app.debugDescription)
        let story = web.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "公开经历首段")).firstMatch
        XCTAssertTrue(story.exists, app.debugDescription)
        XCTAssertTrue(story.label.contains("公开经历尾段"), app.debugDescription)
        XCTAssertTrue(web.staticTexts["公开末行背包"].firstMatch.exists, app.debugDescription)
    }

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
        dismissFixtureKeyboard(app)
        web.buttons["＋ 添加参与者"].firstMatch.tap()
        let pc1 = editable(web, "PC1")
        XCTAssertTrue(pc1.waitForExistence(timeout: 10), app.debugDescription)
        pc1.tap(); app.typeText("Public Alpha")
        dismissFixtureKeyboard(app)
        web.buttons["＋ 添加参与者"].firstMatch.tap()
        let pc2 = editable(web, "PC2")
        XCTAssertTrue(pc2.waitForExistence(timeout: 10), app.debugDescription)
        pc2.tap(); app.typeText("Public Beta")
        dismissFixtureKeyboard(app)
        web.buttons["保存修改"].firstMatch.tap()
        XCTAssertTrue(add.waitForExistence(timeout: 15), app.debugDescription)
        web.buttons["角色卡"].firstMatch.tap()
        web.buttons["新建七版角色"].firstMatch.tap()
        let moduleCheck = web.descendants(matching: .any).matching(NSPredicate(format: "label == %@", String(title))).firstMatch
        XCTAssertTrue(moduleCheck.waitForExistence(timeout: 10), app.debugDescription)
        moduleCheck.tap()
        let name = editable(web, "姓名")
        XCTAssertTrue(name.waitForExistence(timeout: 10), app.debugDescription)
        let menu = web.descendants(matching: .any).matching(identifier: "模组PC姓名候选").firstMatch
        // 模组关联后直接出现姓名下方候选，不依赖先点击姓名或唤起键盘。
        XCTAssertTrue(menu.waitForExistence(timeout: 10), app.debugDescription)
        XCTAssertGreaterThanOrEqual(menu.frame.minY, name.frame.maxY, app.debugDescription)
        XCTAssertFalse(app.keyboards.firstMatch.exists, app.debugDescription)
        let autoBeta = menu.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH %@", "Public Beta")).firstMatch
        XCTAssertTrue(autoBeta.waitForExistence(timeout: 10), app.debugDescription)
        autoBeta.tap()
        name.tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 10), app.debugDescription)
        let nameInput = web.textFields["姓名"].firstMatch
        XCTAssertTrue(nameInput.waitForExistence(timeout: 10), app.debugDescription)
        let autoValue = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == %@", "Public Beta"), object: nameInput)
        XCTAssertEqual(XCTWaiter.wait(for: [autoValue], timeout: 10), .completed, app.debugDescription)
        let beta = menu.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH %@", "Public Beta")).firstMatch
        XCTAssertTrue(beta.waitForExistence(timeout: 10), app.debugDescription)
        XCTAssertGreaterThanOrEqual(beta.frame.minY, app.frame.minY + 40)
        XCTAssertLessThanOrEqual(beta.frame.maxY, app.keyboards.firstMatch.frame.minY)
        XCTAssertTrue(menu.waitForExistence(timeout: 10), app.debugDescription)
        XCTAssertGreaterThanOrEqual(menu.frame.minY, nameInput.frame.maxY, app.debugDescription)
        XCTAssertGreaterThanOrEqual(menu.frame.height, 98, app.debugDescription)
        XCTAssertGreaterThanOrEqual(beta.frame.minY, menu.frame.minY)
        XCTAssertLessThanOrEqual(beta.frame.maxY, menu.frame.maxY, app.debugDescription)
        beta.tap()
        let betaValue = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == %@", "Public Beta"), object: nameInput)
        XCTAssertEqual(XCTWaiter.wait(for: [betaValue], timeout: 10), .completed, app.debugDescription)
        nameInput.tap()
        let alpha = menu.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH %@", "Public Alpha")).firstMatch
        XCTAssertTrue(alpha.waitForExistence(timeout: 10), app.debugDescription)
        alpha.tap()
        let alphaValue = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == %@", "Public Alpha"), object: nameInput)
        XCTAssertEqual(XCTWaiter.wait(for: [alphaValue], timeout: 10), .completed, app.debugDescription)
        web.buttons["保存修改"].firstMatch.tap()
        XCTAssertTrue(web.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Public Alpha'")).firstMatch.waitForExistence(timeout: 15), app.debugDescription)
        app.terminate()
        app.launchArguments.removeAll { $0 == "--coc-picker-ui-fresh" }
        app.launch()
        XCTAssertTrue(add.waitForExistence(timeout: 30), app.debugDescription)
        web.buttons["角色卡"].firstMatch.tap()
        let saved = web.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Public Alpha'")).firstMatch
        XCTAssertTrue(saved.waitForExistence(timeout: 15), app.debugDescription)
        saved.tap()
        web.buttons["编辑角色卡"].firstMatch.tap()
        let reopened = editable(web, "姓名")
        XCTAssertTrue(reopened.waitForExistence(timeout: 10), app.debugDescription)
        reopened.tap()
        let storedValue = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == %@", "Public Alpha"), object: web.textFields["姓名"].firstMatch)
        XCTAssertEqual(XCTWaiter.wait(for: [storedValue], timeout: 10), .completed, app.debugDescription)
        web.buttons["取消编辑"].firstMatch.tap()
    }

}
