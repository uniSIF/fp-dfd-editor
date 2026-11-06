import type { ImportPlan } from '../domain/exchange';
import type { ReplaceOptions } from '../domain/textReplace';
import type {
  Complexity,
  DataFunctionKind,
  DevType,
  DfdEdge,
  DfdNode,
  FpDocument,
  Id,
  NodeRefType,
  SoftwareSettings,
  TransactionKind,
  BackupSettings,
} from '../domain/types';

export type TextChange =
  | { target: 'entity'; refType: NodeRefType; refId: Id; field: 'name' | 'description'; value: string }
  | { target: 'edge'; featureId: Id; edgeId: Id; value: string };

/**
 * 機能を削除するときの、削除する機能が所有するデータファンクションの扱い（FR-CT-06）。
 * 'delete' は実体ごと削除（他の DFD からも外す）、transferTo は残る機能へ所有を移す。指定しないものは所有機能を未設定にして残す。
 */
export type DataFunctionDisposition = Record<Id, 'delete' | { transferTo: Id }>;

export interface EntityRef {
  refType: NodeRefType;
  refId: Id;
}

export type ActionResult = { ok: true; id?: Id } | { ok: false; reason: string };

export type Tab = 'dfd' | 'functions' | 'summary' | 'ledger';

export interface SnackbarState {
  key: number;
  message: string;
  severity: 'error' | 'info' | 'success';
}

export interface ConfirmAction {
  label: string;
  color?: 'primary' | 'error';
  variant?: 'text' | 'contained';
  disabled?: boolean;
  description?: string;
  onClick?: () => void;
}

export interface ConfirmState {
  title: string;
  message?: string;
  details?: string[];
  /** 選択肢型（DF/EE ノード削除など）。指定時はボタンの代わりに選択肢カードを表示する */
  choices?: ConfirmAction[];
  actions: ConfirmAction[];
}

export interface Clipboard {
  softwareId: Id;
  nodes: DfdNode[];
  edges: DfdEdge[];
}

export type PlaceOption = boolean | { x: number; y: number };

export interface DocumentSlice {
  doc: FpDocument;
  revision: number;
  savedRevision: number;
  backedUpRevision: number;
  lastSavedAt: number | null;
  lastBackupAt: number | null;

  // 文書
  loadDocument: (doc: FpDocument) => void;
  markSaved: (revision: number, at?: number) => void;
  markBackedUp: (revision: number, at?: number) => void;
  renameProject: (name: string) => void;
  updateBackupSettings: (s: Partial<BackupSettings>) => void;

  // ソフトウェア・設定・業者
  addSoftware: (name: string) => Id;
  renameSoftware: (id: Id, name: string) => void;
  removeSoftware: (id: Id) => void;
  updateSettings: (softwareId: Id, patch: Partial<SoftwareSettings>) => void;
  addVendor: (softwareId: Id, name: string, rate: number) => Id;
  updateVendor: (id: Id, patch: { name?: string; rate?: number }) => void;
  removeVendor: (id: Id) => void;
  /** 設定ダイアログの保存（1 履歴）。vendors に無い既存業者は削除する */
  applySoftwareSettings: (
    softwareId: Id,
    p: { settings: SoftwareSettings; vendors: { id?: Id; name: string; rate: number }[]; backupSettings: BackupSettings },
  ) => void;

  // 分類・機能
  addCategory1: (softwareId: Id, name: string) => Id;
  addCategory2: (category1Id: Id, name: string) => Id;
  renameCategory: (id: Id, name: string) => void;
  removeCategory: (id: Id, dataFunctions?: DataFunctionDisposition) => void;
  /**
   * 分類の並べ替え。newIndex は移動元から取り除いたあとの並びでの位置。
   * 中分類は newParentId（大分類）を指定すると、同じソフトウェア内の別の大分類へ移す。
   */
  moveCategory: (id: Id, newIndex: number, newParentId?: Id) => void;
  addFeature: (category2Id: Id, name: string) => Id;
  updateFeature: (
    id: Id,
    patch: Partial<{ name: string; devType: DevType; characteristics: number[]; vendorId: Id | null; description: string }>,
  ) => void;
  removeFeature: (id: Id, dataFunctions?: DataFunctionDisposition) => void;
  moveFeature: (id: Id, category2Id: Id, newIndex: number) => void;
  resetCharacteristics: (id: Id) => void;

  // ファンクション
  addDataFunction: (p: { featureId: Id; name: string; kind: DataFunctionKind; complexity: Complexity; description?: string; place?: PlaceOption }) => Id;
  updateDataFunction: (id: Id, patch: Partial<{ name: string; kind: DataFunctionKind; complexity: Complexity; ownerFeatureId: Id | null; description: string }>) => void;
  addTransactionFunction: (p: { featureId: Id; name: string; kind: TransactionKind; complexity: Complexity; description?: string; place?: PlaceOption }) => Id;
  updateTransactionFunction: (id: Id, patch: Partial<{ name: string; kind: TransactionKind; complexity: Complexity; description: string }>) => void;
  addNonCountedProcess: (p: { featureId: Id; name: string; description?: string; place?: PlaceOption }) => Id;
  updateNonCountedProcess: (id: Id, patch: Partial<{ name: string; description: string }>) => void;
  addExternalEntity: (p: { featureId: Id; name: string; description?: string; place?: PlaceOption }) => Id;
  updateExternalEntity: (id: Id, patch: Partial<{ name: string; description: string }>) => void;
  /** 実体の削除。DF / EE は fromFeatureId 以外（DF は所有機能も除く）から参照されていれば拒否 */
  removeEntity: (refType: NodeRefType, refId: Id, fromFeatureId?: Id) => ActionResult;

  // DFD
  placeNode: (featureId: Id, refType: NodeRefType, refId: Id, position?: { x: number; y: number }) => ActionResult;
  unplaceNode: (featureId: Id, nodeId: Id) => void;
  moveNodes: (featureId: Id, positions: { nodeId: Id; x: number; y: number }[]) => void;
  addEdge: (featureId: Id, sourceNodeId: Id, targetNodeId: Id, label?: string) => ActionResult;
  /**
   * 実体同士を接続する（FR-FN-15）。DFD に未配置の実体は相手の近くに自動配置する。
   * 配置と接続を 1 履歴にまとめる。
   */
  connectEntities: (featureId: Id, source: EntityRef, target: EntityRef, label?: string) => ActionResult;
  /**
   * 外部エンティティのノードを入力側と出力側に分ける（FR-DF-18）。
   * 図の右端に同じ外部エンティティのノードを置き、このノードへ入ってくるデータフローをそちらへ付け替える。
   */
  splitExternalEntityNode: (featureId: Id, nodeId: Id) => ActionResult;
  /**
   * データファンクション・外部エンティティのノードを、同じソフトウェアの既存の同種の要素への参照に置き換える（FR-DF-22）。1 履歴。
   * scope='all' なら元の要素を置いているすべての DFD のノードを置き換える。
   * データファンクションは 1 つの DFD に 1 回までなので、置き換え先が配置済みならデータフローをそのノードへ付け替えて統合する。
   * removeOriginal なら、置き換え後にどこにも配置されていない元の要素を削除する（戻り値の removed）。
   */
  replaceWithReference: (p: {
    featureId: Id;
    nodeId: Id;
    toRefId: Id;
    scope: 'node' | 'all';
    removeOriginal: boolean;
  }) => { ok: true; removed: boolean } | { ok: false; reason: string };
  /**
   * DFD を同じソフトウェア内の別の機能へコピーする（FR-DF-20）。1 履歴。
   * TF・非計上プロセスは複製、外部エンティティは同じものを配置、
   * データファンクションは dataFunctions の指定に従い参照配置または複製する。
   * 戻り値の created はコピー先で新しく作った実体（文言置換の対象にする）。
   */
  copyDfdToFeature: (
    sourceFeatureId: Id,
    targetFeatureId: Id,
    options: { dataFunctions: 'reference' | 'duplicate' },
  ) => { ok: true; created: EntityRef[]; edgeIds: Id[] } | { ok: false; reason: string };
  /**
   * ファンクション表で選んだ要素をまとめてコピーする（FR-FN-18）。1 履歴。
   * TF・非計上プロセスとコピー元が所有する DF は新しい番号で複製し、文言を置換してコピー先に属させる。
   * 外部エンティティと他機能所有の DF は共有なので複製せず、コピー先の DFD の既存ノード（なければ新しいノード）を使う。
   * includeEdges なら、選んだ要素どうしをつなぐデータフローも（複製した要素につながるものだけ）再現する。
   * 戻り値の nodeIds はコピーで新しく置いたノード。
   */
  copyFunctions: (p: {
    sourceFeatureId: Id;
    targetFeatureId: Id;
    refs: EntityRef[];
    includeEdges: boolean;
    replace: { find: string; replace: string } & ReplaceOptions;
  }) => { ok: true; created: EntityRef[]; nodeIds: Id[]; edgeIds: Id[] } | { ok: false; reason: string };
  /**
   * AI エージェントの出力（交換形式）から計算した差分を反映する（FR-IO-02、FR-IO-04）。1 履歴。
   * 新しい分類・機能を作り、各機能の DFD に要素とデータフローを反映する。layout なら変更した機能の DFD を自動整列する。
   * 戻り値の featureIds は出力に含まれた機能（新しく作ったものを含む）。
   */
  applyImportPlan: (softwareId: Id, plan: ImportPlan, options: { layout: boolean }) => { ok: true; created: number; featureIds: Id[] } | { ok: false; reason: string };
  /**
   * データファンクション・外部エンティティを、ID はそのままで複数の機能の DFD に参照として置く（FR-FN-19）。1 履歴。
   * 置き済みの要素は飛ばす。TF・非計上プロセスは機能に属するため対象外。戻り値は機能ごとに置いた件数。
   */
  placeReferences: (targetFeatureIds: Id[], refs: EntityRef[]) => { placed: Record<Id, number>; skipped: number };
  /** 文言置換の結果をまとめて反映する（FR-FN-17）。1 履歴 */
  applyTextReplacements: (changes: TextChange[]) => void;
  updateEdgeLabel: (featureId: Id, edgeId: Id, label: string) => void;
  removeEdges: (featureId: Id, edgeIds: Id[]) => void;
  applyLayout: (featureId: Id) => void;
  /**
   * 選択の一括削除（1 履歴）。TF / NCP は実体ごと削除、DF / EE は mode に従う。
   * mode='delete' で参照されている DF / EE は配置解除にとどめ、その名前を skipped に返す。
   */
  deleteSelection: (featureId: Id, nodeIds: Id[], edgeIds: Id[], mode: 'unplace' | 'delete') => { skipped: string[] };
  pasteNodes: (featureId: Id, clipboard: Clipboard) => ActionResult;
}

export interface UiSlice {
  selectedSoftwareId: Id | null;
  selectedFeatureId: Id | null;
  activeTab: Tab;
  selectedNodeIds: Id[];
  selectedEdgeId: Id | null;
  /** プロパティパネルの表示対象 */
  propertyTarget: 'node' | 'feature';
  confirm: ConfirmState | null;
  snackbar: SnackbarState | null;
  clipboard: Clipboard | null;
  backupAvailable: boolean;
  /** 「DFD を別の機能へコピー」ダイアログ（FR-DF-20） */
  copyDfd: { sourceFeatureId: Id } | null;
  /** 「文言を置換」ダイアログ（FR-FN-17）。refIds / edgeIds があればそれだけを対象にする */
  replaceText: { featureId: Id; refIds?: Id[]; edgeIds?: Id[] } | null;
  /** DFD でダブルクリックされ、プロパティパネルの名称（データフローはラベル）へのフォーカスを待っている */
  nameFocusRequested: boolean;
  /** AI エージェント（Copilot）との連携ダイアログ（FR-IO） */
  agentExchange: { mode: 'export' | 'import'; softwareId: Id; featureId: Id | null } | null;

  selectSoftware: (id: Id | null) => void;
  selectFeature: (id: Id | null) => void;
  setActiveTab: (tab: Tab) => void;
  setSelection: (nodeIds: Id[], edgeId: Id | null) => void;
  setPropertyTarget: (t: 'node' | 'feature') => void;
  openConfirm: (c: ConfirmState) => void;
  closeConfirm: () => void;
  notify: (message: string, severity?: SnackbarState['severity']) => void;
  closeSnackbar: () => void;
  setClipboard: (c: Clipboard | null) => void;
  setBackupAvailable: (v: boolean) => void;
  openCopyDfd: (sourceFeatureId: Id | null) => void;
  openReplaceText: (r: { featureId: Id; refIds?: Id[]; edgeIds?: Id[] } | null) => void;
  /** ノード・データフローを選び、プロパティパネルの名称欄へフォーカスする（DFD のダブルクリック） */
  requestNameFocus: (nodeIds: Id[], edgeId: Id | null) => void;
  clearNameFocusRequest: () => void;
  openAgentExchange: (r: { mode: 'export' | 'import'; softwareId: Id; featureId: Id | null } | null) => void;
}

export type AppState = DocumentSlice & UiSlice;
