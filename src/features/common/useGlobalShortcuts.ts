import { useEffect } from 'react';
import { useStore } from '../../store';
import {
  copySelection,
  doRedo,
  doUndo,
  pasteClipboard,
  requestDeleteSelection,
  saveDocument,
} from '../app/commands';

function isEditableTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  if (t.isContentEditable) return true;
  const tag = t.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!t.closest('[role="dialog"]') || !!t.closest('.MuiDataGrid-root');
}

/**
 * キーボードショートカット（FR-DF-11、design.md 6.8）。
 * 入力要素・ダイアログ・表にフォーカスがある間は保存と Escape 以外を無効にする。
 */
export function useGlobalShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      if (mod && key === 's') {
        e.preventDefault();
        saveDocument();
        return;
      }
      if (isEditableTarget(e.target)) return;
      const s = useStore.getState();
      if (e.key === 'Escape') {
        s.setSelection([], null);
        return;
      }
      if (mod && key === 'z') {
        e.preventDefault();
        if (e.shiftKey) doRedo();
        else doUndo();
        return;
      }
      if (mod && key === 'y') {
        e.preventDefault();
        doRedo();
        return;
      }
      if (s.activeTab !== 'dfd' || !s.selectedFeatureId) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        requestDeleteSelection();
      } else if (mod && key === 'a') {
        e.preventDefault();
        const f = s.doc.features[s.selectedFeatureId];
        if (f) s.setSelection(f.dfd.nodes.map((n) => n.id), null);
      } else if (mod && key === 'c') {
        copySelection();
      } else if (mod && key === 'v') {
        e.preventDefault();
        pasteClipboard();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
