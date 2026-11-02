import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import { useState } from 'react';
import { FUNCTION_KIND_LABELS } from '../../domain/fpTables';
import { LEGEND_KINDS, buildDfdLegend } from '../../domain/legend';
import type { Id } from '../../domain/types';
import { useStore } from '../../store';
import { tokens } from '../app/theme';
import { KindBadge } from '../common/KindBadge';

const KEY = 'fpdfd.ui.legendCollapsed';

function loadCollapsed(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * DFD 右上の凡例（FR-DF-17）。種別ごとの計上件数と合計を示す。
 * 折りたたみ状態はブラウザごとの利便設定として保存する。
 */
export function DfdLegendPanel({ featureId }: { featureId: Id }) {
  const doc = useStore((s) => s.doc);
  const legend = buildDfdLegend(doc, featureId);
  const [collapsed, setCollapsed] = useState(loadCollapsed);
  if (!legend) return null;
  const toggle = () => {
    setCollapsed((c) => {
      try {
        localStorage.setItem(KEY, c ? '0' : '1');
      } catch {
        // 保存できなくても表示には影響しない
      }
      return !c;
    });
  };
  return (
    <Box
      role="region"
      aria-label="凡例"
      data-testid="dfd-legend"
      sx={{
        position: 'absolute', top: 12, right: 12, zIndex: 5, width: collapsed ? 'auto' : 268, background: tokens.surface,
        border: `1px solid ${tokens.border}`, borderRadius: '6px', boxShadow: '0 1px 2px rgba(27,31,36,0.06)', fontSize: 12,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, pl: 3, pr: 1, height: 30 }}>
        <span style={{ fontWeight: 600 }}>凡例</span>
        {collapsed && (
          <span style={{ color: tokens.textSecondary, fontVariantNumeric: 'tabular-nums' }}>
            合計 {legend.total} 件 ・ 未調整FP {legend.unadjustedFp}
          </span>
        )}
        <IconButton size="small" sx={{ ml: 'auto' }} aria-label={collapsed ? '凡例を開く' : '凡例をたたむ'} aria-expanded={!collapsed} onClick={toggle}>
          {collapsed ? <ExpandMoreIcon sx={{ fontSize: 16 }} /> : <ExpandLessIcon sx={{ fontSize: 16 }} />}
        </IconButton>
      </Box>
      {!collapsed && (
        <Box sx={{ px: 3, pb: 2, fontVariantNumeric: 'tabular-nums' }}>
          {LEGEND_KINDS.map((k) => (
            <Box key={k} sx={{ display: 'flex', alignItems: 'center', gap: 2, height: 22 }} data-kind={k}>
              <Box sx={{ width: 32 }}><KindBadge kind={k} /></Box>
              <span style={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{FUNCTION_KIND_LABELS[k]}</span>
              <span style={{ whiteSpace: 'nowrap', color: legend.counts[k] ? tokens.text : tokens.textDisabled }}>{legend.counts[k]} 件</span>
            </Box>
          ))}
          <Box sx={{ display: 'flex', borderTop: `1px solid ${tokens.border}`, mt: 1, pt: 1, fontWeight: 600 }}>
            <span>合計 {legend.total} 件</span>
            <span style={{ marginLeft: 'auto' }}>未調整FP {legend.unadjustedFp}</span>
          </Box>
          {legend.referenceCount > 0 && (
            <Box sx={{ color: tokens.textSecondary, fontSize: 11, mt: '2px' }}>参照（他機能所有・計上外） {legend.referenceCount} 件</Box>
          )}
          {legend.unplacedCount > 0 && (
            <Box sx={{ color: tokens.warning, fontSize: 11, mt: '2px' }}>うち DFD 未配置 {legend.unplacedCount} 件</Box>
          )}
        </Box>
      )}
    </Box>
  );
}

/** ファンクション表のプレビュー用の 1 行版 */
export function DfdLegendInline({ featureId }: { featureId: Id }) {
  const doc = useStore((s) => s.doc);
  const legend = buildDfdLegend(doc, featureId);
  if (!legend) return null;
  return (
    <span data-testid="preview-legend" style={{ display: 'inline-flex', gap: 8, alignItems: 'center', fontVariantNumeric: 'tabular-nums' }}>
      {LEGEND_KINDS.map((k) => (
        <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }} title={FUNCTION_KIND_LABELS[k]}>
          <KindBadge kind={k} />
          {legend.counts[k]}
        </span>
      ))}
      <span style={{ fontWeight: 600 }}>計 {legend.total}</span>
    </span>
  );
}
