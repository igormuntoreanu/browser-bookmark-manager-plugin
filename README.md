# Bookmark Review

A browser extension that reviews bookmarks locally and lets you organize them with individual confirmations:

- Duplicates with exactly the same saved URL. Similar addresses are not considered duplicates.
- Possible similar links based on standard URL formatting and selected common tracking parameters. These are suggestions, not guaranteed duplicates.
- Groups of two or more bookmarks from the same HTTP or HTTPS website. These are ideas, not a judgment that you need a folder.
- Title cleanup where leading, trailing, or repeated whitespace can be removed; titles can also be edited manually.
- An optional link check for one selected HTTP or HTTPS bookmark at a time.

See the illustrated user and test guide in [web](docs/index.html) or [PDF](docs/bookmark-review-guide.pdf) format for installation, screenshots, safety notes, and step-by-step manual tests. The web version includes an animation.

Creating a folder, moving, renaming, or deleting a bookmark requires its own confirmation. Folder creation does not move bookmarks, and no duplicates are deleted automatically. Export a backup using your browser's bookmark manager before making changes: there is no undo in the extension, and synced changes can affect other devices. If a bookmark or its destination changed since the scan, scan again before applying the change.

In Chrome, open `chrome://bookmarks/`, use the bookmark manager's three-dot menu, and choose **Export bookmarks**. Keep the exported file private. The extension does not create or restore backups.

Bookmark analysis stays on your device. A link check contacts the selected website only after you confirm and, if necessary, grant browser permission for that site. The request sends the address (including its query) to the site and may reveal your IP address. It uses `HEAD` without cookies, does not follow redirects, and times out after 10 seconds. A failed request or HTTP error does not prove a link is broken; some sites reject checks or require sign-in. Granted website access remains until removed in the browser's extension settings.

## Try it in Chrome

1. Open `chrome://extensions` in Chrome.
2. Turn on **Developer mode**.
3. Choose **Load unpacked** and select this project folder (the folder containing `manifest.json`).
4. Click the extension's puzzle-piece icon and select **Bookmark Review**. The report opens in a new tab.
5. After changing code, return to the extensions page and click the extension's reload button.

The browser asks for bookmark access so the extension can read and, only after confirmation, change your collection. It requests optional website access only when you confirm a link check. You can remove the extension from the extensions page at any time.

This is a development version and is not yet published. A basic scan has been smoke-tested in Edge; Chrome and Brave still need hands-on testing. The browsers use similar extension technology, but each needs separate testing before claiming full support or publishing.

## Run the tests

Install Node.js if necessary, then run `node --test` from this folder. No packages or build step are needed.
