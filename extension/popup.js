const els = {
  notBookmark: document.getElementById("notBookmark"),
  main: document.getElementById("main"),
  folderSelect: document.getElementById("folderSelect"),
  count: document.getElementById("count"),
  folderLine: document.getElementById("folderLine"),
  estimateLine: document.getElementById("estimateLine"),
  warnIncomplete: document.getElementById("warnIncomplete"),
  statusDot: document.getElementById("statusDot"),
  statusText: document.getElementById("statusText"),
  toggleBtn: document.getElementById("toggleBtn"),
  scanBtn: document.getElementById("scanBtn"),
  exportBtn: document.getElementById("exportBtn"),
  clearBtn: document.getElementById("clearBtn"),
};

function getState() {
  return new Promise((resolve) => {
    chrome.storage.local.get(["collections", "capturing", "activeFolderKey"], resolve);
  });
}

function setState(data) {
  return new Promise((resolve) => chrome.storage.local.set(data, resolve));
}

function getActiveCollection(state) {
  const key = els.folderSelect.value || state.activeFolderKey;
  if (!key || !state.collections?.[key]) return null;
  return { key, collection: state.collections[key] };
}

async function pingTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !(tab.url?.includes("x.com") || tab.url?.includes("twitter.com"))) {
    return { isBookmarkPage: false };
  }
  try {
    return await chrome.tabs.sendMessage(tab.id, { action: "getPageInfo" });
  } catch {
    return { isBookmarkPage: false, noContentScript: true };
  }
}

function fillFolderSelect(state) {
  const keys = Object.keys(state.collections || {});
  const prev = els.folderSelect.value;
  els.folderSelect.innerHTML = "";
  if (!keys.length) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "Sin carpetas capturadas";
    els.folderSelect.appendChild(opt);
    return;
  }
  keys.sort((a, b) => {
    const da = state.collections[a].updatedAt || "";
    const db = state.collections[b].updatedAt || "";
    return db.localeCompare(da);
  }).forEach((key) => {
    const col = state.collections[key];
    const n = Object.keys(col.bookmarks || {}).length;
    const opt = document.createElement("option");
    opt.value = key;
    opt.textContent = `${col.folder} (${n})`;
    els.folderSelect.appendChild(opt);
  });
  if (prev && keys.includes(prev)) els.folderSelect.value = prev;
  else if (state.activeFolderKey && keys.includes(state.activeFolderKey)) {
    els.folderSelect.value = state.activeFolderKey;
  }
}

async function refresh() {
  const state = await getState();
  const page = await pingTab();

  fillFolderSelect(state);

  const onBookmarks = page.isBookmarkPage;
  els.notBookmark.hidden = onBookmarks;
  els.main.style.opacity = onBookmarks ? "1" : "0.55";

  const active = getActiveCollection(state);
  const count = active ? Object.keys(active.collection.bookmarks).length : 0;
  const capturing = state.capturing !== false;

  els.count.textContent = count;
  els.folderLine.textContent = active?.collection.folder || "Ninguna carpeta activa";
  els.statusDot.classList.toggle("paused", !capturing);
  els.statusText.textContent = capturing ? "Capturando" : "Pausado";
  els.toggleBtn.textContent = capturing ? "Pausar" : "Reanudar";

  const est = active?.collection.estimatedTotal || page.estimatedTotal;
  if (est && est > count) {
    els.estimateLine.textContent = `Estimado en carpeta: ~${est} posts`;
    els.warnIncomplete.hidden = false;
    els.warnIncomplete.textContent = `Solo ${count} de ~${est}. Sigue haciendo scroll en X hasta llegar al final.`;
  } else {
    els.estimateLine.textContent = est ? `Total estimado: ~${est}` : "";
    els.warnIncomplete.hidden = count === 0 ? false : true;
    if (count === 0 && onBookmarks) {
      els.warnIncomplete.hidden = false;
      els.warnIncomplete.textContent = "Haz scroll en la carpeta para ir capturando posts.";
    }
  }

  els.exportBtn.disabled = count === 0;
  els.clearBtn.disabled = !active;
}

els.folderSelect.addEventListener("change", async () => {
  await setState({ activeFolderKey: els.folderSelect.value });
  refresh();
});

els.toggleBtn.addEventListener("click", async () => {
  const state = await getState();
  await setState({ capturing: state.capturing === false });
  refresh();
});

els.scanBtn.addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) {
    try { await chrome.tabs.sendMessage(tab.id, { action: "scan" }); } catch { /* ignore */ }
  }
  setTimeout(refresh, 300);
});

els.exportBtn.addEventListener("click", async () => {
  const state = await getState();
  const active = getActiveCollection(state);
  if (!active) return;

  const data = XMarkersParser.toExportFormat(active.collection);
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const filename = `xmarkers-${XMarkersParser.folderKey(active.collection.folder)}.json`;

  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
});

els.clearBtn.addEventListener("click", async () => {
  const state = await getState();
  const active = getActiveCollection(state);
  if (!active) return;
  if (!confirm(`¿Borrar ${Object.keys(active.collection.bookmarks).length} posts de "${active.collection.folder}"?`)) return;

  const collections = { ...state.collections };
  delete collections[active.key];
  await setState({
    collections,
    activeFolderKey: Object.keys(collections)[0] || null,
  });
  refresh();
});

chrome.storage.onChanged.addListener(() => refresh());
document.addEventListener("DOMContentLoaded", refresh);
