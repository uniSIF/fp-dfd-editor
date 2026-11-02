import type { FitViewOptions } from '@xyflow/react';
import type { DfdRfNode } from './nodes/DfdNodes';

/**
 * DFD の全体表示の余白。左上のパレットと右上の凡例はどちらも上部にあるため、
 * その高さの分だけ上側の余白を広げ、ノードが隠れないようにする（FR-DF-17）。
 * 左右に取ると図が小さくなりすぎるため、上側で吸収する。
 */
export const DFD_FIT_VIEW: FitViewOptions<DfdRfNode> = {
  padding: { top: '210px', bottom: '48px', left: '48px', right: '48px' },
  maxZoom: 1,
};
