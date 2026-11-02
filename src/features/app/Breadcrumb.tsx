import Box from '@mui/material/Box';
import Tooltip from '@mui/material/Tooltip';
import { forwardRef } from 'react';
import { getFeaturePath } from '../../domain/queries';
import { useStore } from '../../store';
import { selectFeatureResult, selectSoftwareTotals } from '../../store/selectors';
import { formatNumber } from '../common/format';
import { tokens } from './theme';

/** パンくず ＋ 費用サマリー（FR-FN-13、ui-design.md 4.3） */
export function Breadcrumb() {
  const doc = useStore((s) => s.doc);
  const featureId = useStore((s) => s.selectedFeatureId);
  const softwareId = useStore((s) => s.selectedSoftwareId);
  const path = featureId ? getFeaturePath(doc, featureId) : null;
  const sw = softwareId ? doc.softwares[softwareId] : null;
  const result = featureId && path ? selectFeatureResult(doc, featureId) : null;
  const totals = softwareId ? selectSoftwareTotals(doc, softwareId) : null;
  const vendorName = result?.vendorId ? doc.vendors[result.vendorId]?.name : null;

  const segs = path ? [path.software.name, path.category1.name, path.category2.name] : [];
  const leaf = path ? path.feature.name : sw?.name ?? '';

  return (
    <Box sx={{ height: 36, display: 'flex', alignItems: 'center', borderBottom: `1px solid ${tokens.border}`, flex: 'none', minWidth: 0 }}>
      <Box sx={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', whiteSpace: 'nowrap', pl: 3 }}>
        <Box component="span" sx={{ flex: '0 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', color: tokens.textSecondary }}>
          {segs.map((s, i) => (
            <span key={i}>
              {s}
              <span style={{ color: tokens.textDisabled, margin: '0 6px' }}>/</span>
            </span>
          ))}
        </Box>
        <Box component="span" sx={{ flex: 'none', fontSize: 14 }}>{leaf}</Box>
      </Box>
      <Box sx={{ display: 'flex', alignSelf: 'stretch', borderLeft: `1px solid ${tokens.border}`, flex: 'none' }} aria-label="開発単価">
        {result && (
          <Tooltip
            title={`調整済FP ${result.adjustedFp} × ${result.modificationFactor.toFixed(2)} × ${result.hoursPerFp} H/FP = ${result.effortHours} H（社内 ${result.inHouseHours} H${result.outsourceHours ? ` ＋ ${vendorName ?? '外注業者未選択'} ${result.outsourceHours} H` : ''}）`}
          >
            <Stat label="この機能の開発単価" value={result.cost} testId="cost-feature" />
          </Tooltip>
        )}
        {totals && (
          <Tooltip title={`${sw?.name} 全 ${totals.featureCount} 機能の合計（${formatNumber(totals.effortHours)} H）`}>
            <Stat label="ソフトウェア合計" value={totals.cost} shaded testId="cost-total" />
          </Tooltip>
        )}
      </Box>
    </Box>
  );
}

const Stat = forwardRef<HTMLDivElement, { label: string; value: number; shaded?: boolean; testId: string }>(function Stat(
  { label, value, shaded, testId, ...rest },
  ref,
) {
  return (
    <Box
      ref={ref}
      {...rest}
      sx={{ display: 'flex', alignItems: 'baseline', gap: 1.5, px: 3, borderRight: `1px solid ${tokens.border}`, whiteSpace: 'nowrap', background: shaded ? tokens.headerBg : undefined, '&:last-child': { borderRight: 0 }, alignSelf: 'stretch', pt: '9px' }}
    >
      <span style={{ fontSize: 11, color: tokens.textSecondary }}>{label}</span>
      <span data-testid={testId} style={{ fontSize: 14, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{formatNumber(value)}</span>
      <span style={{ fontSize: 12, color: tokens.textSecondary }}>円</span>
    </Box>
  );
});
