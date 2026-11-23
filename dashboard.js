"use strict";

const scanButton = document.getElementById("scan");
const status = document.getElementById("status");
const results = document.getElementById("results");
const search = document.getElementById("search");
const actionStatus = document.getElementById("action-status");
const dialog = document.getElementById("confirmation");
const dialogForm = document.getElementById("confirmation-form");
const dialogTitle = document.getElementById("dialog-title");
const dialogDetails = document.getElementById("dialog-details");
const dialogFields = document.getElementById("dialog-fields");
const dialogError = document.getElementById("dialog-error");
const dialogCancel = document.getElementById("dialog-cancel");
const dialogConfirm = document.getElementById("dialog-confirm");
let report;
let confirmAction;
let actionRunning = false;

function element(tag, text, className) {
  const node = document.createElement(tag);
  node.textContent = text;
  if (className) node.className = className;
  return node;
}

function button(text, handler, className = "secondary") {
  const node = element("button", text, className);
  node.type = "button";
  node.addEventListener("click", handler);
  return node;
}

function openDialog(title, description, confirmLabel, action) {
  dialogTitle.textContent = title;
  dialogDetails.replaceChildren();
  dialogFields.replaceChildren();
  dialogError.textContent = "";
  for (const line of description) dialogDetails.append(element("p", line, "preserve-space"));
  dialogConfirm.textContent = confirmLabel;
  confirmAction = action;
  dialog.showModal();
}

function bookmarkDescription(bookmark) {
  return [`Bookmark: ${bookmark.title || "(Untitled)"}`, `Address: ${bookmark.url}`, `Current folder: ${bookmark.folder}`];
}

function addTextField(labelText, value) {
  const label = element("label", labelText);
  const input = document.createElement("input");
  input.type = "text";
  input.value = value;
  input.required = true;
  label.append(input);
  dialogFields.append(label);
  return input;
}

function addDestinationField() {
  const label = element("label", "Destination folder");
  const select = document.createElement("select");
  select.required = true;
  const placeholder = element("option", "Choose a folder");
  placeholder.value = "";
  select.append(placeholder);
  for (const folder of report.destinations) {
    const option = element("option", folder.path);
    option.value = folder.id;
    select.append(option);
  }
  label.append(select);
  dialogFields.append(label);
  return select;
}

function selectedDestination(select) {
  const destination = report.destinations.find((folder) => folder.id === select.value);
  if (!destination) throw new Error("Choose a destination folder.");
  return destination;
}

async function freshReport() {
  return BookmarkAnalysis.analyze(await chrome.bookmarks.getTree());
}

function requireFreshBookmark(fresh, original) {
  const current = fresh.bookmarks.find((item) => item.id === original.id);
  if (!current || current.title !== original.title || current.url !== original.url ||
      current.parentId !== original.parentId || current.folder !== original.folder || current.unmodifiable) {
    throw new Error("This bookmark changed or is no longer editable. Cancel and scan again before trying.");
  }
}

function requireFreshDestination(fresh, original) {
  const current = fresh.destinations.find((folder) => folder.id === original.id);
  if (!current || current.path !== original.path || current.parentId !== original.parentId) {
    throw new Error("The destination folder changed or is no longer editable. Cancel and scan again.");
  }
}

function removeBookmark(bookmark) {
  openDialog("Delete this bookmark?", [
    ...bookmarkDescription(bookmark),
    "Only this copy will be deleted. Deletion cannot be undone here and may sync to other devices. Export a backup first."
  ], "Delete bookmark", async () => {
    requireFreshBookmark(await freshReport(), bookmark);
    await chrome.bookmarks.remove(bookmark.id);
    return "Bookmark deleted.";
  });
}

function renameBookmark(bookmark, suggestion = bookmark.title) {
  openDialog("Rename this bookmark?", bookmarkDescription(bookmark), "Rename bookmark", async () => {
    const newTitle = input.value;
    if (!newTitle.trim()) throw new Error("Enter a nonempty title.");
    if (newTitle === bookmark.title) throw new Error("The title has not changed.");
    requireFreshBookmark(await freshReport(), bookmark);
    await chrome.bookmarks.update(bookmark.id, { title: newTitle });
    return "Bookmark renamed.";
  });
  const input = addTextField("New title", suggestion);
}

function moveBookmark(bookmark) {
  openDialog("Move this bookmark?", [
    ...bookmarkDescription(bookmark),
    "Only this bookmark will move. The change may sync to other devices."
  ], "Move bookmark", async () => {
    const destination = selectedDestination(select);
    if (destination.id === bookmark.parentId) throw new Error("The bookmark is already in that folder.");
    const fresh = await freshReport();
    requireFreshBookmark(fresh, bookmark);
    requireFreshDestination(fresh, destination);
    await chrome.bookmarks.move(bookmark.id, { parentId: destination.id });
    return `Bookmark moved to ${destination.path}.`;
  });
  const select = addDestinationField();
}

function createFolder(host) {
  openDialog("Create a folder?", [
    `Website idea: ${host}`,
    "This creates one empty folder. No bookmarks will move until you confirm each move separately."
  ], "Create folder", async () => {
    const title = input.value;
    if (!title.trim()) throw new Error("Enter a nonempty folder name.");
    const destination = selectedDestination(select);
    const fresh = await freshReport();
    requireFreshDestination(fresh, destination);
    if (fresh.destinations.some((folder) => folder.parentId === destination.id && folder.title === title)) {
      throw new Error("A folder with this name already exists here. Choose another name or location.");
    }
    await chrome.bookmarks.create({ parentId: destination.id, title });
    return `Folder "${title}" created in ${destination.path}.`;
  });
  const input = addTextField("New folder name", host);
  const select = addDestinationField();
}

function checkBookmark(bookmark) {
  let url;
  try {
    url = new URL(bookmark.url);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error();
  } catch {
    openDialog("Cannot check this address", [
      ...bookmarkDescription(bookmark),
      "Only HTTP and HTTPS addresses without embedded credentials can be checked."
    ], "Close", async () => "No link was checked.");
    return;
  }
  openDialog("Contact this website?", [
    ...bookmarkDescription(bookmark),
    "A HEAD request will contact this website and may reveal your IP address and the address, including its query. Cookies and login credentials are not sent. Redirects are not followed.",
    "Your browser may ask for access to this website. That permission remains until you remove it in the extension's settings. A failed check does not prove a bookmark is broken."
  ], "Check this link", async () => {
    const permission = chrome.permissions.request({ origins: [`${url.protocol}//${url.hostname}/*`] });
    if (!await permission) throw new Error("Website access was not granted; no request was sent.");
    requireFreshBookmark(await freshReport(), bookmark);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(url.href, {
        method: "HEAD", credentials: "omit", redirect: "manual", referrerPolicy: "no-referrer",
        cache: "no-store", signal: controller.signal
      });
      if (response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400)) {
        return "The website returned a redirect. It was not followed; check the bookmark manually.";
      }
      return `Link check returned HTTP ${response.status}. Some websites reject checks or require sign-in; verify manually.`;
    } finally {
      clearTimeout(timeout);
    }
  });
}

function bookmarkList(items, allowDelete = false) {
  const list = document.createElement("ul");
  list.className = "bookmark-list";
  for (const item of items) {
    const row = document.createElement("li");
    row.append(
      element("strong", item.title || "(Untitled)"),
      element("span", item.url, "url"),
      element("span", `Folder: ${item.folder}`, "folder")
    );
    const actions = document.createElement("div");
    actions.className = "row-actions";
    if (!item.unmodifiable) {
      if (allowDelete) actions.append(button("Delete this copy", () => removeBookmark(item), "danger"));
      actions.append(button("Rename", () => renameBookmark(item)), button("Move", () => moveBookmark(item)));
    } else {
      actions.append(element("span", "Managed bookmark: changes are unavailable.", "folder"));
    }
    actions.append(button("Check link", () => checkBookmark(item)));
    row.append(actions);
    list.append(row);
  }
  return list;
}

function showGroups(containerId, groups, heading, emptyMessage, options = {}) {
  const container = document.getElementById(containerId);
  container.replaceChildren();
  if (!groups.length) {
    container.append(element("p", emptyMessage, "empty"));
    return;
  }
  for (const group of groups) {
    const details = document.createElement("details");
    details.append(element("summary", heading(group)));
    if (options.folderIdea) {
      const controls = document.createElement("div");
      controls.className = "group-actions";
      controls.append(button("Create suggested folder", () => createFolder(group.host)));
      details.append(controls);
    }
    details.append(bookmarkList(group.items, options.allowDelete));
    container.append(details);
  }
}

function renderSearch() {
  const container = document.getElementById("search-results");
  const searchStatus = document.getElementById("search-status");
  container.replaceChildren();
  const query = search.value.trim().toLocaleLowerCase();
  if (query.length < 2) {
    searchStatus.textContent = "Enter at least two characters to search.";
    return;
  }
  const matches = report.bookmarks.filter((item) =>
    `${item.title} ${item.url} ${item.folder}`.toLocaleLowerCase().includes(query));
  searchStatus.textContent = `${matches.length} matches${matches.length > 50 ? "; showing the first 50" : ""}.`;
  container.append(bookmarkList(matches.slice(0, 50)));
}

function render(newReport) {
  report = newReport;
  document.getElementById("bookmark-count").textContent = report.bookmarkCount;
  document.getElementById("duplicate-count").textContent = report.duplicates.length;
  document.getElementById("similar-count").textContent = report.similar.length;
  document.getElementById("folder-count").textContent = report.folders.length;
  document.getElementById("title-count").textContent = report.titles.length;

  showGroups("duplicates", report.duplicates,
    (group) => `${group.items.length} bookmarks: ${group.url}`,
    "No exact duplicates found.", { allowDelete: true });
  showGroups("similar", report.similar,
    (group) => `${group.items.length} possible matches: ${group.url}`,
    "No possible matches found.", { allowDelete: true });
  showGroups("folders", report.folders,
    (group) => `${group.host} — ${group.items.length} bookmarks`,
    "No websites with multiple bookmarks found.", { folderIdea: true });

  const titles = document.getElementById("titles");
  titles.replaceChildren();
  if (!report.titles.length) titles.append(element("p", "No title cleanup suggestions found.", "empty"));
  for (const suggestion of report.titles) {
    const card = document.createElement("div");
    card.className = "title-card";
    card.append(
      element("p", `Current: ${suggestion.bookmark.title}`, "preserve-space"),
      element("p", `Suggested: ${suggestion.suggestedTitle}`),
      element("span", suggestion.bookmark.url, "url"),
      element("span", `Folder: ${suggestion.bookmark.folder}`, "folder")
    );
    if (!suggestion.bookmark.unmodifiable) {
      card.append(button("Review rename", () => renameBookmark(suggestion.bookmark, suggestion.suggestedTitle)));
    }
    titles.append(card);
  }
  renderSearch();
}

async function scan() {
  scanButton.disabled = true;
  results.hidden = true;
  status.textContent = "Reading your bookmarks...";
  try {
    render(await freshReport());
    results.hidden = false;
    status.textContent = `Scan complete: ${report.bookmarkCount} bookmarks reviewed.`;
  } catch (error) {
    console.error("Could not scan bookmarks:", error);
    status.textContent = `Could not scan bookmarks: ${(error && error.message) || String(error)}. Try scanning again.`;
  } finally {
    scanButton.disabled = false;
  }
}

dialogForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (actionRunning) return;
  actionRunning = true;
  dialogConfirm.disabled = true;
  dialogCancel.disabled = true;
  dialogError.textContent = "";
  try {
    const message = await confirmAction();
    dialog.close();
    await scan();
    actionStatus.textContent = `${message} ${status.textContent}`;
  } catch (error) {
    console.error("Action failed:", error);
    dialogError.textContent = `Could not complete the action: ${(error && error.message) || String(error)}`;
  } finally {
    actionRunning = false;
    dialogConfirm.disabled = false;
    dialogCancel.disabled = false;
  }
});
dialogCancel.addEventListener("click", () => dialog.close());
dialog.addEventListener("cancel", (event) => { if (actionRunning) event.preventDefault(); });
search.addEventListener("input", renderSearch);
scanButton.addEventListener("click", scan);
scan();
