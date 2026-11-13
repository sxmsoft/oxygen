export const GROUP_COLORS = [
  'grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange',
] as const;
export type GroupColor = (typeof GROUP_COLORS)[number];

export interface WorkspaceTab {
  url: string;
  title?: string;
  pinned?: boolean;
  /** index into the window's groups */
  group?: number;
}
export interface WorkspaceGroup {
  title: string;
  color: GroupColor;
  collapsed?: boolean;
}
export interface WorkspaceWindow {
  tabs: WorkspaceTab[];
  groups: WorkspaceGroup[];
}
export interface Workspace {
  id: string;
  name: string;
  createdAt: number;
  windows: WorkspaceWindow[];
}
export interface WorkspaceStore {
  version: 1;
  saved: Workspace[];
  /** Continuously autosaved state of the running session. */
  lastSession: Workspace | null;
  /** The autosave of the previous browser run (rotated at browser start). */
  previousSession: Workspace | null;
}

export const EMPTY_STORE: WorkspaceStore = { version: 1, saved: [], lastSession: null, previousSession: null };
export const EXPORT_FORMAT = 'oxygen-workspaces';

/** URLs a workspace can reopen (browser-internal pages are dropped). */
export function isRestorableUrl(url: string): boolean {
  return /^(https?|ftp|file):/i.test(url);
}

export interface CaptureTab {
  url?: string;
  pendingUrl?: string;
  title?: string;
  pinned: boolean;
  groupId?: number;
}
export interface CaptureGroup {
  id: number;
  title?: string;
  color: string;
  collapsed: boolean;
}

export function captureWindow(tabs: CaptureTab[], groups: CaptureGroup[]): WorkspaceWindow {
  const groupIndex = new Map<number, number>();
  const outGroups: WorkspaceGroup[] = [];
  const outTabs: WorkspaceTab[] = [];
  for (const t of tabs) {
    const url = t.url || t.pendingUrl || '';
    if (!isRestorableUrl(url)) continue;
    const tab: WorkspaceTab = { url, title: t.title, pinned: t.pinned || undefined };
    if (t.groupId !== undefined && t.groupId >= 0) {
      if (!groupIndex.has(t.groupId)) {
        const g = groups.find((x) => x.id === t.groupId);
        groupIndex.set(t.groupId, outGroups.length);
        outGroups.push({
          title: g?.title ?? '',
          color: (GROUP_COLORS as readonly string[]).includes(g?.color ?? '') ? (g!.color as GroupColor) : 'grey',
          collapsed: g?.collapsed || undefined,
        });
      }
      tab.group = groupIndex.get(t.groupId);
    }
    outTabs.push(tab);
  }
  return { tabs: outTabs, groups: outGroups };
}

export function newId(now: number, rand: () => number = Math.random): string {
  return `ws-${now.toString(36)}-${Math.floor(rand() * 1e9).toString(36)}`;
}

export function makeWorkspace(name: string, windows: WorkspaceWindow[], now: number, id = newId(now)): Workspace {
  return {
    id,
    name: name.trim() || new Date(now).toISOString().slice(0, 16).replace('T', ' '),
    createdAt: now,
    windows: windows.filter((w) => w.tabs.length > 0),
  };
}

export function tabCount(ws: Workspace): number {
  return ws.windows.reduce((n, w) => n + w.tabs.length, 0);
}

export function exportWorkspaces(workspaces: Workspace[]): string {
  return JSON.stringify({ format: EXPORT_FORMAT, version: 1, workspaces }, null, 2);
}

function sanitizeWindow(raw: unknown): WorkspaceWindow | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as { tabs?: unknown; groups?: unknown };
  const groups: WorkspaceGroup[] = Array.isArray(r.groups)
    ? r.groups.map((g) => {
        const gg = (g ?? {}) as Partial<WorkspaceGroup>;
        return {
          title: typeof gg.title === 'string' ? gg.title.slice(0, 200) : '',
          color: (GROUP_COLORS as readonly string[]).includes(String(gg.color)) ? (gg.color as GroupColor) : 'grey',
          collapsed: gg.collapsed === true || undefined,
        };
      })
    : [];
  const tabs: WorkspaceTab[] = [];
  for (const t of Array.isArray(r.tabs) ? r.tabs : []) {
    const tt = (t ?? {}) as Partial<WorkspaceTab>;
    if (typeof tt.url !== 'string' || !isRestorableUrl(tt.url)) continue;
    const tab: WorkspaceTab = { url: tt.url };
    if (typeof tt.title === 'string') tab.title = tt.title.slice(0, 500);
    if (tt.pinned === true) tab.pinned = true;
    if (Number.isInteger(tt.group) && (tt.group as number) >= 0 && (tt.group as number) < groups.length) {
      tab.group = tt.group;
    }
    tabs.push(tab);
  }
  return tabs.length ? { tabs, groups } : null;
}

/** Parses an export file; accepts a single workspace too. Throws on invalid input. */
export function parseWorkspacesImport(json: string, now = Date.now()): Workspace[] {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    throw new Error('Invalid JSON');
  }
  const list: unknown[] =
    data && typeof data === 'object' && (data as { format?: unknown }).format === EXPORT_FORMAT
      ? ((data as { workspaces?: unknown }).workspaces as unknown[]) ?? []
      : data && typeof data === 'object' && 'windows' in (data as object)
        ? [data]
        : (() => {
            throw new Error('Not an Oxygen workspace export');
          })();
  if (!Array.isArray(list)) throw new Error('Not an Oxygen workspace export');
  const out: Workspace[] = [];
  list.forEach((raw, i) => {
    const r = (raw ?? {}) as Partial<Workspace>;
    const windows = (Array.isArray(r.windows) ? r.windows : [])
      .map(sanitizeWindow)
      .filter((w): w is WorkspaceWindow => w !== null);
    if (!windows.length) return;
    out.push({
      id: typeof r.id === 'string' && r.id ? r.id : newId(now + i),
      name: typeof r.name === 'string' && r.name.trim() ? r.name.trim().slice(0, 120) : `Imported ${i + 1}`,
      createdAt: Number.isFinite(r.createdAt) ? (r.createdAt as number) : now,
      windows,
    });
  });
  if (!out.length) throw new Error('No restorable workspaces found');
  return out;
}

export function upsertWorkspace(store: WorkspaceStore, ws: Workspace): WorkspaceStore {
  const saved = store.saved.filter((w) => w.id !== ws.id);
  return { ...store, saved: [ws, ...saved] };
}

export function removeWorkspace(store: WorkspaceStore, id: string): WorkspaceStore {
  return { ...store, saved: store.saved.filter((w) => w.id !== id) };
}

/** Imported workspaces get fresh ids when they would overwrite existing ones. */
export function mergeImported(store: WorkspaceStore, imported: Workspace[], now = Date.now()): WorkspaceStore {
  const ids = new Set(store.saved.map((w) => w.id));
  const fresh = imported.map((w, i) => (ids.has(w.id) ? { ...w, id: newId(now + i) } : w));
  return { ...store, saved: [...fresh, ...store.saved] };
}

export function parseStore(raw: unknown): WorkspaceStore {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_STORE };
  const r = raw as Partial<WorkspaceStore>;
  return {
    version: 1,
    saved: Array.isArray(r.saved) ? r.saved : [],
    lastSession: r.lastSession ?? null,
    previousSession: r.previousSession ?? null,
  };
}

/** Browser start: the last autosave becomes the restorable "previous session". */
export function rotateSession(store: WorkspaceStore): WorkspaceStore {
  return store.lastSession ? { ...store, previousSession: store.lastSession, lastSession: null } : store;
}
