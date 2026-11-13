import {
  captureWindow, makeWorkspace, parseStore, upsertWorkspace, removeWorkspace, mergeImported,
  parseWorkspacesImport, exportWorkspaces, rotateSession, type Workspace, type WorkspaceStore, type WorkspaceWindow,
} from '../logic/workspace.js';
import { STORAGE_KEYS } from '../modules/manifests.js';
import { getKey, setKey } from './state.js';

export async function getStore(): Promise<WorkspaceStore> {
  return parseStore(await getKey<unknown>(STORAGE_KEYS.workspaces, null));
}
async function putStore(s: WorkspaceStore): Promise<void> {
  await setKey(STORAGE_KEYS.workspaces, s);
}

async function captureOne(win: chrome.windows.Window): Promise<WorkspaceWindow> {
  const groups = chrome.tabGroups ? await chrome.tabGroups.query({ windowId: win.id }) : [];
  return captureWindow(
    (win.tabs ?? []).map((t) => ({ url: t.url, pendingUrl: t.pendingUrl, title: t.title, pinned: t.pinned, groupId: t.groupId })),
    groups.map((g) => ({ id: g.id, title: g.title, color: g.color, collapsed: g.collapsed }))
  );
}

/** Captures one window (windowId) or all normal windows. */
export async function capture(windowId?: number): Promise<WorkspaceWindow[]> {
  const wins =
    windowId !== undefined
      ? [await chrome.windows.get(windowId, { populate: true })]
      : await chrome.windows.getAll({ populate: true, windowTypes: ['normal'] });
  const out: WorkspaceWindow[] = [];
  for (const w of wins) {
    if (w.incognito) continue;
    const c = await captureOne(w);
    if (c.tabs.length) out.push(c);
  }
  return out;
}

export async function saveWorkspace(name: string, windowId?: number): Promise<Workspace | null> {
  const windows = await capture(windowId);
  if (!windows.length) return null;
  const ws = makeWorkspace(name, windows, Date.now());
  await putStore(upsertWorkspace(await getStore(), ws));
  return ws;
}

export async function deleteWorkspace(id: string): Promise<void> {
  await putStore(removeWorkspace(await getStore(), id));
}

export async function renameWorkspace(id: string, name: string): Promise<void> {
  const s = await getStore();
  await putStore({ ...s, saved: s.saved.map((w) => (w.id === id ? { ...w, name: name.trim() || w.name } : w)) });
}

export async function autosaveSession(): Promise<boolean> {
  const windows = await capture();
  if (!windows.length) return false; // never overwrite a good autosave with an empty browser
  const s = await getStore();
  await putStore({ ...s, lastSession: makeWorkspace('Last session', windows, Date.now(), 'last-session') });
  return true;
}

export async function rotateOnStartup(): Promise<void> {
  await putStore(rotateSession(await getStore()));
}

/** Opens each saved window as a new window, restoring pinned state and tab groups (title, color, collapsed). */
export async function restoreWorkspace(ws: Workspace): Promise<number[]> {
  const windowIds: number[] = [];
  for (const w of ws.windows) {
    const win = await chrome.windows.create({ url: w.tabs.map((t) => t.url), focused: true });
    if (!win?.id) continue;
    windowIds.push(win.id);
    const tabs = win.tabs ?? (await chrome.tabs.query({ windowId: win.id }));
    for (let i = 0; i < w.tabs.length && i < tabs.length; i++) {
      if (w.tabs[i].pinned) await chrome.tabs.update(tabs[i].id!, { pinned: true });
    }
    if (chrome.tabGroups) {
      for (let g = 0; g < w.groups.length; g++) {
        const ids = w.tabs.map((t, i) => (t.group === g ? tabs[i]?.id : undefined)).filter((x): x is number => x !== undefined);
        if (!ids.length) continue;
        const gid: number = await chrome.tabs.group({ tabIds: ids as [number, ...number[]], createProperties: { windowId: win.id } });
        await chrome.tabGroups.update(gid, { title: w.groups[g].title, color: w.groups[g].color, collapsed: !!w.groups[g].collapsed });
      }
    }
  }
  return windowIds;
}

export async function restoreById(id: string): Promise<number[]> {
  const s = await getStore();
  const ws =
    id === 'last' ? s.previousSession ?? s.lastSession : id === 'last-session' ? s.lastSession : s.saved.find((w) => w.id === id) ?? null;
  return ws ? restoreWorkspace(ws) : [];
}

export async function exportAll(): Promise<string> {
  return exportWorkspaces((await getStore()).saved);
}

export async function importJson(json: string): Promise<number> {
  const imported = parseWorkspacesImport(json);
  await putStore(mergeImported(await getStore(), imported));
  return imported.length;
}
