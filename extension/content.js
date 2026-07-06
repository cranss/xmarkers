(() => {
  const BADGE_ID = "xmarkers-collector-badge";
  let observer = null;
  let scanTimer = null;
  let badgeEl = null;

  function isBookmarkPage() {
    return /\/i\/bookmarks/.test(location.pathname) ||
      !!document.querySelector('[aria-label^="Cronología:"]');
  }

  function getState(cb) {
    chrome.storage.local.get(["collections", "capturing", "activeFolderKey"], cb);
  }

  function setState(partial, cb) {
    chrome.storage.local.set(partial, cb);
  }

  function ensureCollection(state, folderName) {
    const key = XMarkersParser.folderKey(folderName);
    const collections = state.collections || {};
    if (!collections[key]) {
      collections[key] = {
        folder: folderName,
        folderKey: key,
        bookmarks: {},
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        estimatedTotal: null,
      };
    }
    return { collections, key, collection: collections[key] };
  }

  function captureArticle(article, collections) {
    const tweet = XMarkersParser.parseTweet(article);
    if (!tweet) return null;

    const folderName = XMarkersParser.detectFolder();
    const { collections: next, key, collection } = ensureCollection({ collections }, folderName);

    if (collection.bookmarks[tweet.id]) {
      return { collections: next, key, added: 0 };
    }

    collection.bookmarks[tweet.id] = { ...tweet, capturedAt: new Date().toISOString() };
    collection.updatedAt = new Date().toISOString();
    collection.folder = folderName;
    collection.estimatedTotal = XMarkersParser.estimateVirtualTotal();
    next[key] = collection;
    return { collections: next, key, added: 1 };
  }

  function scanVisible() {
    if (!isBookmarkPage()) return;

    getState((state) => {
      if (state.capturing === false) {
        updateBadge(state);
        return;
      }

      let collections = state.collections || {};
      let activeKey = state.activeFolderKey;
      let added = 0;

      document.querySelectorAll('article[data-testid="tweet"]').forEach((article) => {
        const result = captureArticle(article, collections);
        if (!result) return;
        collections = result.collections;
        activeKey = result.key;
        added += result.added;
      });

      const folderKey = XMarkersParser.folderKey(XMarkersParser.detectFolder());
      if (collections[folderKey]) {
        collections[folderKey].estimatedTotal = XMarkersParser.estimateVirtualTotal();
        activeKey = activeKey || folderKey;
      }

      if (added > 0 || !state.activeFolderKey) {
        setState({ collections, activeFolderKey: activeKey }, () => updateBadge());
      } else {
        updateBadge({ ...state, collections, activeFolderKey: activeKey });
      }
    });
  }

  function scheduleScan() {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(scanVisible, 150);
  }

  function createBadge() {
    if (document.getElementById(BADGE_ID)) return;
    badgeEl = document.createElement("div");
    badgeEl.id = BADGE_ID;
    badgeEl.innerHTML = `
      <style>
        #${BADGE_ID} {
          position: fixed;
          bottom: 20px;
          right: 20px;
          z-index: 999999;
          background: #0f1419;
          color: #e7e9ea;
          border: 1px solid #1d9bf0;
          border-radius: 12px;
          padding: 10px 14px;
          font: 600 13px/1.3 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          box-shadow: 0 4px 24px rgba(0,0,0,0.45);
          pointer-events: none;
          max-width: 220px;
        }
        #${BADGE_ID} .count { color: #1d9bf0; font-size: 18px; }
        #${BADGE_ID} .muted { color: #71767b; font-weight: 400; font-size: 11px; margin-top: 4px; }
        #${BADGE_ID}.paused { border-color: #71767b; }
        #${BADGE_ID}.paused .count { color: #71767b; }
      </style>
      <div class="count">0</div>
      <div class="label">capturados</div>
      <div class="muted"></div>
    `;
    document.documentElement.appendChild(badgeEl);
  }

  function updateBadge(preset) {
    const apply = (state) => {
      if (!isBookmarkPage()) {
        badgeEl?.remove();
        badgeEl = null;
        return;
      }
      createBadge();
      const key = state.activeFolderKey;
      const col = key && state.collections ? state.collections[key] : null;
      const count = col ? Object.keys(col.bookmarks).length : 0;
      const est = col?.estimatedTotal;
      const paused = state.capturing === false;

      badgeEl.classList.toggle("paused", paused);
      badgeEl.querySelector(".count").textContent = count;
      badgeEl.querySelector(".label").textContent = paused ? "captura pausada" : "capturados";
      const muted = badgeEl.querySelector(".muted");
      const parts = [col?.folder || "—"];
      if (est && est > count) parts.push(`~${est} est.`);
      muted.textContent = parts.join(" · ");
    };

    if (preset) apply(preset);
    else getState(apply);
  }

  function start() {
    if (!isBookmarkPage()) return;

    createBadge();
    scanVisible();

    observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.addedNodes.length) {
          scheduleScan();
          return;
        }
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    window.addEventListener("scroll", scheduleScan, { passive: true });
    setInterval(scanVisible, 3000);
  }

  function stop() {
    observer?.disconnect();
    observer = null;
    clearTimeout(scanTimer);
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.action === "scan") {
      scanVisible();
      sendResponse({ ok: true });
      return true;
    }
    if (msg.action === "getPageInfo") {
      getState((state) => {
        const key = state.activeFolderKey;
        const col = key && state.collections ? state.collections[key] : null;
        sendResponse({
          isBookmarkPage: isBookmarkPage(),
          folder: col?.folder || XMarkersParser.detectFolder(),
          count: col ? Object.keys(col.bookmarks).length : 0,
          estimatedTotal: col?.estimatedTotal ?? XMarkersParser.estimateVirtualTotal(),
          capturing: state.capturing !== false,
        });
      });
      return true;
    }
    return false;
  });

  chrome.storage.onChanged.addListener((changes) => {
    if (changes.capturing || changes.collections || changes.activeFolderKey) {
      updateBadge();
    }
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }

  let lastPath = location.pathname;
  setInterval(() => {
    if (location.pathname !== lastPath) {
      lastPath = location.pathname;
      scheduleScan();
      updateBadge();
    }
  }, 1000);
})();
