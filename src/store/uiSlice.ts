import type { Get, ImmerSet } from './documentSlice';
import type { UiSlice } from './types';

let snackbarKey = 0;

export function createUiSlice(set: ImmerSet, _get: Get): UiSlice {
  return {
    selectedSoftwareId: null,
    selectedFeatureId: null,
    activeTab: 'dfd',
    selectedNodeIds: [],
    selectedEdgeId: null,
    propertyTarget: 'feature',
    confirm: null,
    snackbar: null,
    clipboard: null,
    backupAvailable: true,

    selectSoftware: (id) =>
      set((s) => {
        s.selectedSoftwareId = id;
      }),
    selectFeature: (id) =>
      set((s) => {
        s.selectedFeatureId = id;
        s.selectedNodeIds = [];
        s.selectedEdgeId = null;
        s.propertyTarget = 'feature';
        if (id) {
          const f = s.doc.features[id];
          const c2 = f && s.doc.category2s[f.category2Id];
          const c1 = c2 && s.doc.category1s[c2.category1Id];
          if (c1) s.selectedSoftwareId = c1.softwareId;
        }
      }),
    setActiveTab: (tab) => set((s) => { s.activeTab = tab; }),
    setSelection: (nodeIds, edgeId) =>
      set((s) => {
        s.selectedNodeIds = nodeIds;
        s.selectedEdgeId = edgeId;
        // 何も選択していなければ機能のプロパティを表示する
        s.propertyTarget = nodeIds.length || edgeId ? 'node' : 'feature';
      }),
    setPropertyTarget: (t) => set((s) => { s.propertyTarget = t; }),
    openConfirm: (c) => set((s) => { s.confirm = c; }),
    closeConfirm: () => set((s) => { s.confirm = null; }),
    notify: (message, severity = 'info') =>
      set((s) => {
        s.snackbar = { key: ++snackbarKey, message, severity };
      }),
    closeSnackbar: () => set((s) => { s.snackbar = null; }),
    setClipboard: (c) => set((s) => { s.clipboard = c; }),
    setBackupAvailable: (v) => set((s) => { s.backupAvailable = v; }),
  };
}
