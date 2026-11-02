import { temporal } from 'zundo';
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { emptyDocument } from '../domain/emptyDocument';
import type { FpDocument } from '../domain/types';
import { createDocumentSlice, type ImmerSet } from './documentSlice';
import type { AppState } from './types';
import { createUiSlice } from './uiSlice';

export const HISTORY_LIMIT = 100;

/**
 * アプリのストア（design.md 4.1）。
 * temporal（zundo）は doc と revision だけを履歴に積み、UI 状態は Undo の対象外にする。
 */
export function createAppStore(initial: FpDocument = emptyDocument()) {
  return create<AppState>()(
    temporal(
      immer((set, get) => {
        const iset = set as unknown as ImmerSet;
        return { ...createDocumentSlice(iset, get, initial), ...createUiSlice(iset, get) };
      }),
      {
        partialize: (s) => ({ doc: s.doc, revision: s.revision }),
        limit: HISTORY_LIMIT,
        equality: (a, b) => a.revision === b.revision,
      },
    ),
  );
}

export const useStore = createAppStore();

export type AppStore = typeof useStore;

export function undo(store: AppStore = useStore): void {
  store.temporal.getState().undo();
}

export function redo(store: AppStore = useStore): void {
  store.temporal.getState().redo();
}

export * from './types';
