# CI-only XCUITest target. The shipped application target and signing remain unchanged.
require 'xcodeproj'
project = Xcodeproj::Project.open('ios/App/App.xcodeproj')
target = project.new_target(:ui_test_bundle, 'PickerUITests', :ios, '15.0')
target.add_dependency(project.targets.find { |t| t.name == 'App' })
file = project.main_group.new_file('../../scripts/ios-picker-ui-tests.swift')
target.source_build_phase.add_file_reference(file)
target.build_configurations.each do |config|
  config.build_settings['PRODUCT_BUNDLE_IDENTIFIER'] = 'coc.logbook.pickeruitests'
  config.build_settings['PRODUCT_NAME'] = '$(TARGET_NAME)'
  config.build_settings['TARGETED_DEVICE_FAMILY'] = '1,2'
  config.build_settings['GENERATE_INFOPLIST_FILE'] = 'YES'
  config.build_settings['TEST_TARGET_NAME'] = 'App'
  config.build_settings['SWIFT_VERSION'] = '5.0'
  config.build_settings['CODE_SIGN_IDENTITY'] = '-'
end
project.save
scheme = Xcodeproj::XCScheme.new
scheme.add_build_target(project.targets.find { |t| t.name == 'App' })
scheme.add_build_target(target)
scheme.add_test_target(target)
scheme.save_as('ios/App/App.xcodeproj', 'PickerUITests', true)
