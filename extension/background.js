chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(["capturing"], (data) => {
    if (data.capturing === undefined) {
      chrome.storage.local.set({ capturing: true });
    }
  });
});
