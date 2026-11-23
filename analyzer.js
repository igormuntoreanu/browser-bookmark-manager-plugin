(function (root) {
  "use strict";

  function analyze(tree) {
    const bookmarks = [];
    const folders = [];

    function visit(node, folderPath, locked) {
      if (typeof node.url === "string") {
        bookmarks.push({
          id: node.id,
          title: node.title || "",
          url: node.url,
          parentId: node.parentId,
          folder: folderPath.join(" / ") || "Bookmarks",
          unmodifiable: locked || Boolean(node.unmodifiable)
        });
        return;
      }

      const nextFolders = node.title ? folderPath.concat(node.title) : folderPath;
      const nextLocked = locked || Boolean(node.unmodifiable);
      if (node.parentId !== undefined && !nextLocked) {
        folders.push({ id: node.id, parentId: node.parentId, title: node.title, path: nextFolders.join(" / ") });
      }
      for (const child of node.children || []) {
        visit(child, nextFolders, nextLocked);
      }
    }

    for (const node of tree) {
      visit(node, [], false);
    }

    const byUrl = new Map();
    const byHost = new Map();
    const bySimilarUrl = new Map();
    const titles = [];

    for (const bookmark of bookmarks) {
      if (!byUrl.has(bookmark.url)) byUrl.set(bookmark.url, []);
      byUrl.get(bookmark.url).push(bookmark);

      let parsedUrl;
      try {
        parsedUrl = new URL(bookmark.url);
      } catch {
        // Invalid URLs can still be checked for duplicates and title cleanup.
      }
      if (parsedUrl && (parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:")) {
        if (!byHost.has(parsedUrl.hostname)) byHost.set(parsedUrl.hostname, []);
        byHost.get(parsedUrl.hostname).push(bookmark);

        for (const key of Array.from(parsedUrl.searchParams.keys())) {
          if (/^(utm_(source|medium|campaign|term|content|id)|gclid|fbclid)$/i.test(key)) {
            parsedUrl.searchParams.delete(key);
          }
        }
        const similarUrl = parsedUrl.href;
        if (!bySimilarUrl.has(similarUrl)) bySimilarUrl.set(similarUrl, []);
        bySimilarUrl.get(similarUrl).push(bookmark);
      }

      const suggestedTitle = bookmark.title.trim().replace(/\s+/g, " ");
      if (suggestedTitle && suggestedTitle !== bookmark.title) {
        titles.push({ bookmark, suggestedTitle });
      }
    }

    return {
      bookmarkCount: bookmarks.length,
      bookmarks,
      destinations: folders,
      duplicates: Array.from(byUrl, ([url, items]) => ({ url, items }))
        .filter((group) => group.items.length > 1),
      similar: Array.from(bySimilarUrl, ([url, items]) => ({ url, items }))
        .filter((group) => new Set(group.items.map((item) => item.url)).size > 1),
      folders: Array.from(byHost, ([host, items]) => ({ host, items }))
        .filter((group) => group.items.length > 1),
      titles
    };
  }

  const api = { analyze };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.BookmarkAnalysis = api;
})(globalThis);
