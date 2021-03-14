import watch from 'node-watch';
import { FSWatcher, accessSync, constants } from 'fs';
import { Disposable } from 'vscode-languageserver/node';

export type KnownEvents = 'change' | 'error' | 'close';
export type EventType = KnownEvents | string;

export type Listener = (eventType?: EventType, filename?: string) => void;

export class FileWatcher implements Disposable {
    private watchedFile = new Map<string, FSWatcher>();
    private listeners = new Set<Listener>();

    /**
     * Stops watching all files.
     */
    readonly dispose = (): void => {
        this.clear();
    };

    /**
     * Trigger an event - exposed for testing.
     * @param eventType - event to trigger
     * @param filename - filename to trigger
     */
    readonly trigger: Listener = (eventType?: EventType, filename?: string): void => {
        this.notifyListeners(eventType, filename);
    };

    /**
     * Add a listener
     * @param fn - function to be called when a file has changed.
     * @returns
     */
    listen(fn: Listener): Disposable {
        this.listeners.add(fn);
        return {
            dispose: () => {
                this.listeners.delete(fn);
            },
        };
    }

    /**
     * Add a file to watch
     * @param filename - absolute path to file to be watched
     */
    addFile(filename: string): void {
        if (!this.watchedFile.has(filename) && canAccess(filename)) {
            this.watchedFile.set(filename, watch(filename, { persistent: false }, this.trigger));
        }
    }

    /**
     * Stops watching a file.
     * @param filename - absolute path to file to stop watching
     */
    clearFile(filename: string): void {
        this.watchedFile.get(filename)?.close();
        this.watchedFile.delete(filename);
    }

    /**
     * Stops watching all files.
     */
    clear(): void {
        for (const w of this.watchedFile.values()) {
            w.close();
        }
        this.watchedFile.clear();
    }

    /**
     * the list of watched files
     */
    get watchedFiles(): string[] {
        return [...this.watchedFile.keys()];
    }

    private notifyListeners(eventType?: EventType, filename?: string) {
        for (const listener of this.listeners) {
            listener(eventType, filename);
        }
    }
}

function canAccess(path: string): boolean {
    try {
        accessSync(path, constants.R_OK);
    } catch (e) {
        return false;
    }
    return true;
}
