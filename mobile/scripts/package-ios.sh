#!/bin/bash
set -euo pipefail
mkdir -p ios/build
xcodebuild -version | tee ios/build/xcode-version.txt
xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Release \
  -destination 'generic/platform=iOS' -archivePath "$PWD/ios/build/COCLogbook.xcarchive" \
  archive CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY='' \
  | tee ios/build/archive.log
mkdir -p ios/build/ipa/Payload
cp -R ios/build/COCLogbook.xcarchive/Products/Applications/App.app ios/build/ipa/Payload/
python3 scripts/check-ios-package.py ios/build/ipa/Payload/App.app
(cd ios/build/ipa && ditto -c -k --sequesterRsrc --keepParent Payload ../coc-logbook-1.0.8-52-ios-arm64-unsigned.ipa)
shasum -a 256 ios/build/coc-logbook-1.0.8-52-ios-arm64-unsigned.ipa > ios/build/coc-logbook-1.0.8-52-ios-arm64-unsigned.ipa.sha256
cat > ios/build/INSTALL-IPA.txt <<'EOF'
真机 arm64 IPA，未带 Apple 开发证书或设备描述文件，不能直接安装。
请在自己的设备使用全能签及自己的有效企业证书签名后安装；保持原应用标识，不卸载或清库。
账号密码不要提交到仓库；安卓签名不能用于 iOS。
用户目标为 iPhone 14 Pro / iOS 27.0；尚无本包真机通过结论。
EOF
