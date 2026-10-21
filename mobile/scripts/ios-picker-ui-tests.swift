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

    // Files retains offscreen browsing pages in its accessibility tree. An
    // existing firstMatch can belong to an earlier page and cannot be tapped.
    private func visiblePickerItem(_ query: XCUIElementQuery) -> XCUIElement? {
        // Folder-mode Files cells may have accessible children without being
        // accessibility-bound elements themselves. Resolve query matches by
        // index while retaining the hit-test filter for hidden browsing pages.
        query.allElementsBoundByIndex.first { $0.isHittable }
    }

    // Do not evaluate remote File Provider queries inside an XCTest waiter:
    // its timeout can interrupt a snapshot while the provider is changing pages.
    private func waitForPickerCondition(in app: XCUIApplication, timeout: TimeInterval, _ condition: () -> Bool) {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if condition() { return }
            RunLoop.current.run(until: Date().addingTimeInterval(0.25))
        }
        XCTFail(app.debugDescription)
    }

    private func waitForPickerItem(_ query: XCUIElementQuery, in app: XCUIApplication, timeout: TimeInterval = 15) throws -> XCUIElement {
        waitForPickerCondition(in: app, timeout: timeout) {
            self.visiblePickerItem(query) != nil
        }
        return try XCTUnwrap(visiblePickerItem(query), app.debugDescription)
    }

    private func enterPublicPickerFolder(_ app: XCUIApplication) throws {
        let folder = app.cells.matching(identifier: "COC-Picker-Public-Test, Folder")
        let container = app.cells.matching(identifier: "COC 跑团记录簿, Container")
        waitForPickerCondition(in: app, timeout: 20) {
            self.visiblePickerItem(folder) != nil || self.visiblePickerItem(container) != nil
        }
        if visiblePickerItem(folder) == nil {
            try waitForPickerItem(container, in: app).tap()
        }
        try waitForPickerItem(folder, in: app).tap()
        // Verify navigation, not just the existence of a label on a retained page.
        let location = app.buttons.matching(NSPredicate(format: "label == %@", "COC-Picker-Public-Test, Actions Menu"))
        _ = try waitForPickerItem(location, in: app)
    }

    private func pickPublicCoc7(_ app: XCUIApplication) throws {
        app.webViews.buttons["导入七版角色卡"].firstMatch.tap()
        let file = app.cells.matching(NSPredicate(format: "label BEGINSWITH %@", "public-coc7"))
        let folder = app.cells.matching(identifier: "COC-Picker-Public-Test, Folder")
        let container = app.cells.matching(identifier: "COC 跑团记录簿, Container")
        XCTAssertTrue(app.navigationBars["FullDocumentManagerViewControllerNavigationBar"].firstMatch.waitForExistence(timeout: 20), app.debugDescription)
        waitForPickerCondition(in: app, timeout: 20) {
            self.visiblePickerItem(file) != nil || self.visiblePickerItem(folder) != nil || self.visiblePickerItem(container) != nil
        }
        if visiblePickerItem(file) == nil {
            try enterPublicPickerFolder(app)
        }
        try waitForPickerItem(file, in: app).tap()
        let title = app.webViews.staticTexts["导入七版角色卡预览"].firstMatch
        if !title.waitForExistence(timeout: 3) {
            let open = app.buttons.matching(NSPredicate(format: "label IN %@", ["Open", "打开"]))
            if let button = visiblePickerItem(open) { button.tap() }
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
        try pickPublicCoc7(app)
        XCTAssertTrue(web.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "6项技能、4项物品")).firstMatch.exists, app.debugDescription)
        XCTAssertEqual(web.textFields["居住地"].firstMatch.value as? String, "公开居住地", app.debugDescription)
        XCTAssertEqual(web.textFields["故乡"].firstMatch.value as? String, "公开故乡", app.debugDescription)
        web.buttons["取消编辑"].firstMatch.tap()
        let saved = web.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "公开七版调查员")).firstMatch
        XCTAssertFalse(saved.exists, app.debugDescription)
        try pickPublicCoc7(app)
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
        try enterPublicPickerFolder(app)
        let open = app.buttons.matching(NSPredicate(format: "label IN %@", ["Open", "打开"]))
        try waitForPickerItem(open, in: app, timeout: 10).tap()
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
        try exercisePublicNameCandidates(stress: false)
    }

    func testPublicNameCandidateRepeatedSwitchFocusAndKeyboard() throws {
        try exercisePublicNameCandidates(stress: true)
    }

    func testPublicNameCandidatesSecondLaunchWithNativeKeyboard() throws {
        try exercisePublicNameCandidates(stress: false)
    }

    func testPublicNameCandidatesThirdLaunchWithNativeKeyboard() throws {
        try exercisePublicNameCandidates(stress: false)
    }

    private func attachNameValue(_ element: XCUIElement, app: XCUIApplication, stage: String) {
        let value = element.value as? String ?? "<nil>"
        let points = value.unicodeScalars.map { String($0.value, radix: 16) }.joined(separator: " ")
        let attachment = XCTAttachment(string: "stage=\(stage)\nvalue=\(String(reflecting: value))\ncodePoints=\(points)\nkeyboard=\(app.keyboards.firstMatch.exists)")
        attachment.name = "public-name-" + stage
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    private func tapPublicCandidate(_ element: XCUIElement, app: XCUIApplication, stage: String) {
        let frame = element.frame
        let attachment = XCTAttachment(string: "stage=\(stage)\ntimeMs=\(Date().timeIntervalSince1970 * 1000)\nlabel=\(String(reflecting: element.label))\nframe=\(frame)\ncenter=\(frame.midX),\(frame.midY)\nkeyboard=\(app.keyboards.firstMatch.frame)")
        attachment.name = "public-candidate-target-" + stage
        attachment.lifetime = .keepAlways
        add(attachment)
        element.tap()
    }

    private func exercisePublicNameCandidates(stress: Bool) throws {
        let app = XCUIApplication(bundleIdentifier: "coc.logbook")
        app.launchArguments = ["--coc-picker-ui", "--coc-picker-ui-fresh", "--coc-name-trace", "-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
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
        let pc1Input = web.textFields["PC1"].firstMatch
        XCTAssertTrue(pc1Input.waitForExistence(timeout: 10), app.debugDescription)
        attachNameValue(pc1Input, app: app, stage: "pc1-typed")
        XCTAssertEqual(pc1Input.value as? String, "Public Alpha", app.debugDescription)
        dismissFixtureKeyboard(app)
        attachNameValue(pc1Input, app: app, stage: "pc1-blurred")
        XCTAssertEqual(pc1Input.value as? String, "Public Alpha", app.debugDescription)
        web.buttons["＋ 添加参与者"].firstMatch.tap()
        let pc2 = editable(web, "PC2")
        XCTAssertTrue(pc2.waitForExistence(timeout: 10), app.debugDescription)
        pc2.tap(); app.typeText("Public Beta")
        let pc2Input = web.textFields["PC2"].firstMatch
        XCTAssertTrue(pc2Input.waitForExistence(timeout: 10), app.debugDescription)
        attachNameValue(pc2Input, app: app, stage: "pc2-typed")
        XCTAssertEqual(pc2Input.value as? String, "Public Beta", app.debugDescription)
        dismissFixtureKeyboard(app)
        attachNameValue(pc2Input, app: app, stage: "pc2-blurred")
        XCTAssertEqual(pc2Input.value as? String, "Public Beta", app.debugDescription)
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
        tapPublicCandidate(autoBeta, app: app, stage: "auto-beta")
        attachNameValue(name, app: app, stage: "auto-beta-before-focus")
        name.tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 10), app.debugDescription)
        let nameInput = web.textFields["姓名"].firstMatch
        XCTAssertTrue(nameInput.waitForExistence(timeout: 10), app.debugDescription)
        let autoValue = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == %@", "Public Beta"), object: nameInput)
        attachNameValue(nameInput, app: app, stage: "auto-beta-after-focus")
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
        tapPublicCandidate(beta, app: app, stage: "focused-beta")
        let betaValue = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == %@", "Public Beta"), object: nameInput)
        XCTAssertEqual(XCTWaiter.wait(for: [betaValue], timeout: 10), .completed, app.debugDescription)
        nameInput.tap()
        let alpha = menu.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH %@", "Public Alpha")).firstMatch
        XCTAssertTrue(alpha.waitForExistence(timeout: 10), app.debugDescription)
        tapPublicCandidate(alpha, app: app, stage: "switch-alpha")
        let alphaValue = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == %@", "Public Alpha"), object: nameInput)
        XCTAssertEqual(XCTWaiter.wait(for: [alphaValue], timeout: 10), .completed, app.debugDescription)
        if stress {
            for cycle in 0..<6 {
                for expected in ["Public Alpha", "Public Beta", "Public Beta", "Public Alpha"] {
                    nameInput.tap()
                    XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 10), app.debugDescription)
                    // WebKit exposes the option wrapper as "Name, Name" on this runtime.
                    // Match that observed accessibility form; the input value stays exact.
                    let option = menu.descendants(matching: .any).matching(NSPredicate(format: "label IN %@", [expected, expected + ", " + expected])).firstMatch
                    XCTAssertTrue(option.waitForExistence(timeout: 10), app.debugDescription)
                    tapPublicCandidate(option, app: app, stage: "cycle-\(cycle)-\(expected)")
                    attachNameValue(nameInput, app: app, stage: "cycle-\(cycle)-\(expected)")
                    let exact = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == %@", expected), object: nameInput)
                    XCTAssertEqual(XCTWaiter.wait(for: [exact], timeout: 10), .completed, app.debugDescription)
                }
                let occupation = web.textFields["职业"].firstMatch
                occupation.tap()
                dismissFixtureKeyboard(app)
                XCTAssertFalse(app.keyboards.firstMatch.exists, app.debugDescription)
                nameInput.tap()
                XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 10), app.debugDescription)
                attachNameValue(nameInput, app: app, stage: "cycle-\(cycle)-focus-return")
                XCTAssertEqual(nameInput.value as? String, "Public Alpha", app.debugDescription)
            }
        }
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
        attachNameValue(web.textFields["姓名"].firstMatch, app: app, stage: "saved-after-restart")
        XCTAssertEqual(XCTWaiter.wait(for: [storedValue], timeout: 10), .completed, app.debugDescription)
        web.buttons["取消编辑"].firstMatch.tap()
    }

}
