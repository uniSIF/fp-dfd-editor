import type { Complexity, DevType, FunctionKind } from './types';

/** 種別 × 複雑度ごとの FP 係数（requirements.md 4.6.1） */
export const FP_WEIGHTS: Record<FunctionKind, Record<Complexity, number>> = {
  ILF: { low: 7, medium: 10, high: 15 },
  EIF: { low: 5, medium: 7, high: 10 },
  EI: { low: 3, medium: 4, high: 6 },
  EO: { low: 4, medium: 5, high: 7 },
  EQ: { low: 3, medium: 4, high: 6 },
};

export const CHARACTERISTIC_COUNT = 14;

export const CHARACTERISTIC_NAMES: readonly string[] = [
  'データ通信',
  '分散データ処理',
  '性能',
  '高負荷構成',
  'トランザクション量',
  'オンラインデータ入力',
  'エンドユーザー効率',
  'オンライン更新',
  '複雑な処理',
  '再利用性',
  'インストール容易性',
  '運用性',
  '複数サイト',
  '変更容易性',
];

export const COMPLEXITY_LABELS: Record<Complexity, string> = { low: '低', medium: '中', high: '高' };
export const COMPLEXITIES: Complexity[] = ['low', 'medium', 'high'];

export const DEV_TYPE_LABELS: Record<DevType, string> = { new: '新規', modification: '改修' };

export const FUNCTION_KIND_LABELS: Record<FunctionKind, string> = {
  ILF: '内部論理ファイル',
  EIF: '外部インタフェースファイル',
  EI: '外部入力',
  EO: '外部出力',
  EQ: '外部照会',
};
