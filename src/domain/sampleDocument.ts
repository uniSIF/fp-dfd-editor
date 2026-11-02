import { emptyDocument, createSoftware } from './emptyDocument';
import type { FpDocument } from './types';

/**
 * 要件定義書 4.6.9 と付録 10.1 の計算例を再現するサンプル。
 * テストの固定データと、UI モックと同じ内容の初期表示に使う。ID は固定値。
 */
export function sampleDocument(): FpDocument {
  const doc = emptyDocument('サンプルプロジェクト');
  const sw = createSoftware('顧客管理システム', 'sw1');
  sw.settings = {
    defaultCharacteristics: [3, 2, 3, 2, 1, 2, 3, 2, 1, 1, 2, 3, 2, 1],
    newDev: { modificationFactor: 1, hoursPerFp: 8 },
    modDev: { modificationFactor: 0.5, hoursPerFp: 8 },
    inHouseRatio: 0.4,
    inHouseRate: 6000,
  };
  sw.category1Ids = ['c1a', 'c1b'];
  sw.vendorIds = ['vA', 'vB'];
  sw.seq = { DF: 3, TF: 5, EE: 2 };
  doc.project.softwareIds = ['sw1'];
  doc.softwares.sw1 = sw;
  doc.vendors.vA = { id: 'vA', softwareId: 'sw1', name: 'A社', rate: 5000 };
  doc.vendors.vB = { id: 'vB', softwareId: 'sw1', name: 'B社', rate: 5000 };

  doc.category1s.c1a = { id: 'c1a', softwareId: 'sw1', name: '顧客管理', category2Ids: ['c2a'] };
  doc.category1s.c1b = { id: 'c1b', softwareId: 'sw1', name: '商品管理', category2Ids: ['c2b'] };
  doc.category2s.c2a = { id: 'c2a', category1Id: 'c1a', name: '顧客情報', featureIds: ['fReg', 'fSearch'] };
  doc.category2s.c2b = { id: 'c2b', category1Id: 'c1b', name: '商品情報', featureIds: ['fItem'] };

  const chars = [...sw.settings.defaultCharacteristics];
  doc.features.fReg = {
    id: 'fReg',
    category2Id: 'c2a',
    name: '顧客登録',
    devType: 'new',
    characteristics: [...chars],
    vendorId: 'vA',
    description: '顧客の新規登録。氏名、住所、連絡先を入力し顧客マスタに登録する',
    dfd: {
      nodes: [
        { id: 'n1', refType: 'externalEntity', refId: 'ee1', x: 60, y: 240 },
        { id: 'n2', refType: 'transactionFunction', refId: 'tf1', x: 356, y: 86 },
        { id: 'n3', refType: 'transactionFunction', refId: 'tf2', x: 356, y: 446 },
        { id: 'n4', refType: 'transactionFunction', refId: 'tf3', x: 616, y: 226 },
        { id: 'n5', refType: 'dataFunction', refId: 'df1', x: 570, y: 108 },
        { id: 'n6', refType: 'dataFunction', refId: 'df2', x: 800, y: 248 },
      ],
      edges: [
        { id: 'e1', sourceNodeId: 'n1', targetNodeId: 'n2', label: '登録情報' },
        { id: 'e2', sourceNodeId: 'n2', targetNodeId: 'n5', label: '顧客データ' },
        { id: 'e3', sourceNodeId: 'n2', targetNodeId: 'n3', label: '登録結果' },
        { id: 'e4', sourceNodeId: 'n3', targetNodeId: 'n1', label: '完了通知' },
        { id: 'e5', sourceNodeId: 'n1', targetNodeId: 'n4', label: '検索条件' },
        { id: 'e6', sourceNodeId: 'n5', targetNodeId: 'n4', label: '顧客情報' },
        { id: 'e7', sourceNodeId: 'n6', targetNodeId: 'n4', label: '商品情報' },
      ],
    },
  };
  doc.features.fSearch = {
    id: 'fSearch',
    category2Id: 'c2a',
    name: '顧客検索',
    devType: 'modification',
    characteristics: [...chars],
    vendorId: 'vB',
    description: '既存の検索画面に詳細照会を追加',
    dfd: { nodes: [], edges: [] },
  };
  doc.features.fItem = {
    id: 'fItem',
    category2Id: 'c2b',
    name: '商品登録',
    devType: 'new',
    characteristics: [...chars],
    vendorId: 'vA',
    description: '',
    dfd: { nodes: [{ id: 'm1', refType: 'dataFunction', refId: 'df2', x: 300, y: 200 }], edges: [] },
  };

  doc.externalEntities.ee1 = { id: 'ee1', softwareId: 'sw1', displayNo: 'EE-001', name: '利用者', description: '' };

  doc.dataFunctions.df1 = {
    id: 'df1', softwareId: 'sw1', displayNo: 'DF-001', name: '顧客マスタ', kind: 'ILF', complexity: 'medium',
    ownerFeatureId: 'fReg', description: '顧客の基本情報を保持する内部ファイル。3 レコードタイプ・25 データ項目のため複雑度は中。',
  };
  doc.dataFunctions.df2 = {
    id: 'df2', softwareId: 'sw1', displayNo: 'DF-002', name: '商品マスタ', kind: 'ILF', complexity: 'low',
    ownerFeatureId: 'fItem', description: '商品コード・名称・単価を保持する。',
  };

  doc.transactionFunctions.tf1 = {
    id: 'tf1', featureId: 'fReg', displayNo: 'TF-001', name: '顧客登録入力', kind: 'EI', complexity: 'medium',
    description: '顧客の新規登録フォーム。氏名・住所・連絡先を入力し顧客マスタに登録する。入力項目が 12 項目あるため複雑度は中。',
  };
  doc.transactionFunctions.tf2 = {
    id: 'tf2', featureId: 'fReg', displayNo: 'TF-002', name: '登録完了通知', kind: 'EO', complexity: 'low',
    description: '登録後に受付番号をメールで通知する。',
  };
  doc.transactionFunctions.tf3 = {
    id: 'tf3', featureId: 'fReg', displayNo: 'TF-003', name: '顧客検索', kind: 'EQ', complexity: 'low',
    description: '登録前の重複チェック用に氏名・電話番号で照会する。',
  };
  doc.transactionFunctions.tf4 = {
    id: 'tf4', featureId: 'fSearch', displayNo: 'TF-004', name: '顧客照会', kind: 'EQ', complexity: 'low', description: '',
  };
  doc.transactionFunctions.tf5 = {
    id: 'tf5', featureId: 'fSearch', displayNo: 'TF-005', name: '顧客詳細照会', kind: 'EQ', complexity: 'low', description: '',
  };
  // 商品登録: EI 低 1 件（ILF 低 7 + EI 低 3 = 10）
  doc.transactionFunctions.tf6 = {
    id: 'tf6', featureId: 'fItem', displayNo: 'TF-006', name: '商品登録入力', kind: 'EI', complexity: 'low', description: '',
  };
  sw.seq.TF = 7;
  return doc;
}
