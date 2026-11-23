chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") }).catch((error) => {
    console.error("Could not open Bookmark Review:", error);
  });
});
