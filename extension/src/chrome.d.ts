// Minimal typings for the chrome.* APIs Oxygen uses (avoids a @types/chrome dependency).
declare namespace chrome {
  namespace storage {
    interface StorageChange {
      newValue?: unknown;
      oldValue?: unknown;
    }
    interface StorageArea {
      get(keys: string | string[]): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
    }
    type ChangeListener = (changes: Record<string, StorageChange>, areaName: string) => void;
    const local: StorageArea;
    const onChanged: {
      addListener(cb: ChangeListener): void;
      removeListener(cb: ChangeListener): void;
    };
  }
  namespace runtime {
    const id: string | undefined;
    function getURL(path: string): string;
    function getManifest(): { version: string; version_name?: string; name: string };
    function openOptionsPage(): Promise<void>;
    const onInstalled: { addListener(cb: (details: { reason: string }) => void): void };
    const onStartup: { addListener(cb: () => void): void };
  }
  namespace action {
    const onClicked: { addListener(cb: () => void): void };
  }
  namespace tabs {
    function create(props: { url: string; active?: boolean }): Promise<unknown>;
    function update(props: { url: string }): Promise<unknown>;
  }
  namespace management {
    interface ExtensionInfo {
      id: string;
      name: string;
      type: string;
      enabled: boolean;
    }
    function getAll(): Promise<ExtensionInfo[]>;
    function setEnabled(id: string, enabled: boolean): Promise<void>;
    const onInstalled: { addListener(cb: (info: ExtensionInfo) => void): void };
  }
  namespace omnibox {
    interface SuggestResult {
      content: string;
      description: string;
    }
    type OnInputEnteredDisposition = 'currentTab' | 'newForegroundTab' | 'newBackgroundTab';
    function setDefaultSuggestion(s: { description: string }): void;
    const onInputChanged: {
      addListener(cb: (text: string, suggest: (r: SuggestResult[]) => void) => void): void;
    };
    const onInputEntered: {
      addListener(cb: (text: string, disposition: OnInputEnteredDisposition) => void): void;
    };
  }
}
