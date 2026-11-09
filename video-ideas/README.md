# Video Ideas

Michael's master list of video ideas from the Soul Knowledge books.

- `app.html` — the page published as the "Video Ideas" Claude artifact (https://claude.ai/artifact/2hbUZtzrw6KDoWYqgdsRVn). The ideas and edits are saved in that artifact's own database, not in this file.
- `icon-1024.png` — app icon, made with Codex.
- `ios/` — iPhone app that opens the list full screen. Build: `cd ios && xcodegen generate && xcodebuild -project VideoIdeas.xcodeproj -scheme VideoIdeas -destination 'generic/platform=iOS' -derivedDataPath build/DerivedData -allowProvisioningUpdates build`, then `xcrun devicectl device install app --device <phone id> "build/DerivedData/Build/Products/Debug-iphoneos/Video Ideas.app"`.
