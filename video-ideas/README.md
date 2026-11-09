# Video Ideas

Michael's master list of video ideas from the Soul Knowledge books.

- `app.html` — the page published as the "Video Ideas" Claude artifact (https://claude.ai/artifact/2hbUZtzrw6KDoWYqgdsRVn). The ideas and edits are saved in that artifact's own database, not in this file.
- `icon-1024.png` — app icon, made with Codex.
- `ios/` — iPhone app that opens the list full screen. Build: `cd ios && xcodegen generate && xcodebuild -project VideoIdeas.xcodeproj -scheme VideoIdeas -destination 'generic/platform=iOS' -derivedDataPath build/DerivedData -allowProvisioningUpdates build`, then `xcrun devicectl device install app --device <phone id> "build/DerivedData/Build/Products/Debug-iphoneos/Video Ideas.app"`.


## No-login webpage (Nov 9, 2026)

The list no longer needs a Claude sign-in. It now lives at **https://video-ideas-delta.vercel.app** (Vercel project `video-ideas`).

- `web/public/index.html`: the same page as `app.html`, but it saves to the site's own storage instead of Claude.
- `web/api/ideas.js`: reads and saves the list. The list is one private Vercel Blob file (`ideas.json`, store `video-ideas`). Changes are applied one at a time and checked against the latest copy, so two quick edits never overwrite each other.
- Privacy: every request needs the private key (env `VIDEO_IDEAS_KEY`). Open the page once with `#k=<key>` at the end of the link and it remembers the key. The key is in `~/.config/video-ideas/key` on Michael's Mac. It is never committed.
- Deploy: `cd web && npx vercel@latest deploy --prod`.
- iPhone app: opens the private link. `ios/VideoIdeas/Secrets.swift` (not in git) holds it; copy `Secrets.swift.example` to make it.
- The Claude page (artifact 2hbUZtzrw6KDoWYqgdsRVn) is now an old copy. Edits there do not reach the new list.
