// ドメインモデル（design.md 3章）。ストアと保存ファイルは同じ正規化形式を使う。
export type Id = string;

export type Complexity = 'low' | 'medium' | 'high';
export type DataFunctionKind = 'ILF' | 'EIF';
export type TransactionKind = 'EI' | 'EO' | 'EQ';
export type FunctionKind = DataFunctionKind | TransactionKind;
export type DevType = 'new' | 'modification';

export interface Project {
  id: Id;
  name: string;
  softwareIds: Id[];
}

export interface DevTypeSettings {
  /** 改修係数。初期値 1.00 */
  modificationFactor: number;
  /** 1FP あたりの工数 [H/FP]。null は未設定（警告対象、計算上は 0） */
  hoursPerFp: number | null;
}

export interface SoftwareSettings {
  /** C1〜C14 の既定値。長さ 14、各 0〜5 */
  defaultCharacteristics: number[];
  newDev: DevTypeSettings;
  modDev: DevTypeSettings;
  /** 社内への工数配分比率 0〜1 */
  inHouseRatio: number;
  /** 社内の工数単価 [円/H] */
  inHouseRate: number;
}

export interface Software {
  id: Id;
  name: string;
  category1Ids: Id[];
  settings: SoftwareSettings;
  vendorIds: Id[];
  /** 表示用連番の次番号 */
  seq: { DF: number; TF: number; EE: number };
}

export interface Category1 {
  id: Id;
  softwareId: Id;
  name: string;
  category2Ids: Id[];
}

export interface Category2 {
  id: Id;
  category1Id: Id;
  name: string;
  featureIds: Id[];
}

export interface Feature {
  id: Id;
  category2Id: Id;
  name: string;
  devType: DevType;
  /** C1〜C14。長さ 14 */
  characteristics: number[];
  vendorId: Id | null;
  /** 説明（任意）。既定は空文字 */
  description: string;
  dfd: Dfd;
}

export interface DataFunction {
  id: Id;
  softwareId: Id;
  /** "DF-001" */
  displayNo: string;
  name: string;
  kind: DataFunctionKind;
  complexity: Complexity;
  /** null = 所有機能未設定 */
  ownerFeatureId: Id | null;
  description: string;
}

export interface TransactionFunction {
  id: Id;
  featureId: Id;
  /** "TF-001" */
  displayNo: string;
  name: string;
  kind: TransactionKind;
  complexity: Complexity;
  description: string;
}

export interface NonCountedProcess {
  id: Id;
  featureId: Id;
  name: string;
  description: string;
}

export interface ExternalEntity {
  id: Id;
  softwareId: Id;
  /** "EE-001" */
  displayNo: string;
  name: string;
  description: string;
}

export interface Vendor {
  id: Id;
  softwareId: Id;
  name: string;
  /** 工数単価 [円/H] */
  rate: number;
}

export type NodeRefType = 'dataFunction' | 'transactionFunction' | 'nonCountedProcess' | 'externalEntity';

export interface DfdNode {
  /** ノード自身の ID（DFD 内で一意） */
  id: Id;
  refType: NodeRefType;
  /** 実体エンティティの ID */
  refId: Id;
  x: number;
  y: number;
}

export interface DfdEdge {
  id: Id;
  sourceNodeId: Id;
  targetNodeId: Id;
  label: string;
}

export interface Dfd {
  nodes: DfdNode[];
  edges: DfdEdge[];
}

export interface BackupSettings {
  intervalSec: number;
  generations: number;
}

export interface FpDocument {
  schemaVersion: 1;
  project: Project;
  softwares: Record<Id, Software>;
  category1s: Record<Id, Category1>;
  category2s: Record<Id, Category2>;
  features: Record<Id, Feature>;
  dataFunctions: Record<Id, DataFunction>;
  transactionFunctions: Record<Id, TransactionFunction>;
  nonCountedProcesses: Record<Id, NonCountedProcess>;
  externalEntities: Record<Id, ExternalEntity>;
  vendors: Record<Id, Vendor>;
  backupSettings: BackupSettings;
}
