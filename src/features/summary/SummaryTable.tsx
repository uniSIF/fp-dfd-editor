import FileDownloadOutlinedIcon from '@mui/icons-material/FileDownloadOutlined';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Link from '@mui/material/Link';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { DEV_TYPE_LABELS } from '../../domain/fpTables';
import { featuresInOrder, getFeaturePath } from '../../domain/queries';
import type { Id } from '../../domain/types';
import { useStore } from '../../store';
import { selectFeatureResult, selectSoftwareTotals, selectWarnings } from '../../store/selectors';
import { exportCsv } from '../app/commands';
import { tokens } from '../app/theme';
import { formatNumber } from '../common/format';
import { WarningIcon } from '../common/WarningIcon';

const PIN = [0, 90, 180];
const PIN_W = [90, 90, 110];

/** 一覧タブ（FR-FN-10、ui-design.md 4.8）。CSV と同じ列順、機能名 3 列を固定 */
export function SummaryTable({ softwareId }: { softwareId: Id }) {
  const doc = useStore((s) => s.doc);
  const selectFeature = useStore((s) => s.selectFeature);
  const setActiveTab = useStore((s) => s.setActiveTab);
  const sw = doc.softwares[softwareId];
  const features = featuresInOrder(doc, softwareId);
  const totals = selectSoftwareTotals(doc, softwareId)!;
  const warnings = selectWarnings(doc, softwareId);
  const vendors = sw.vendorIds.map((id) => doc.vendors[id]).filter(Boolean);
  const pin = (i: number, extra: object = {}) => ({ position: 'sticky' as const, left: PIN[i], minWidth: PIN_W[i], maxWidth: PIN_W[i], zIndex: 2, ...extra });

  return (
    <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <Box sx={{ display: 'flex', gap: 2, p: '8px 12px', borderBottom: `1px solid ${tokens.border}`, alignItems: 'center' }}>
        <Typography sx={{ fontSize: 14, fontWeight: 600 }}>{sw.name}</Typography>
        <Typography sx={{ color: tokens.textSecondary }}>機能 {features.length} 件</Typography>
        <Box sx={{ flex: 1 }} />
        <Button variant="outlined" color="inherit" startIcon={<FileDownloadOutlinedIcon />} sx={{ borderColor: tokens.borderStrong }} onClick={() => exportCsv(softwareId)}>CSV出力</Button>
      </Box>
      <Box sx={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
        <Box component="table" sx={tableSx}>
          <thead>
            <tr className="group">
              <th colSpan={3} style={pin(0, { minWidth: 290, maxWidth: 290, textAlign: 'left', borderLeft: 0, zIndex: 4 })}>機能</th>
              <th colSpan={5}>ファンクション件数</th>
              <th colSpan={3}>システム特性</th>
              <th colSpan={4}>FP</th>
              <th colSpan={2 + vendors.length}>工数 [H]</th>
              <th>費用</th>
              <th colSpan={2} style={{ textAlign: 'left' }}>補足</th>
            </tr>
            <tr>
              <th style={pin(0, { zIndex: 4 })}>大分類</th>
              <th style={pin(1, { zIndex: 4 })}>中分類</th>
              <th style={pin(2, { zIndex: 4 })} className="pin-edge">小分類</th>
              {['ILF', 'EIF', 'EI', 'EO', 'EQ'].map((k, i) => <th key={k} className={`r${i === 0 ? ' g' : ''}`}>{k}</th>)}
              <th className="r g">C合計</th><th>区分</th><th className="r">調整係数</th>
              <th className="r g">未調整</th><th className="r">調整済</th><th className="r">改修係数</th><th className="r">H/FP</th>
              <th className="r g">開発</th><th className="r">社内</th>
              {vendors.map((v) => <th key={v.id} className="r">{v.name}</th>)}
              <th className="r g">開発単価 [円]</th>
              <th className="g" style={{ minWidth: 240 }}>説明</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {features.map((f) => {
              const p = getFeaturePath(doc, f.id)!;
              const r = selectFeatureResult(doc, f.id)!;
              const w = warnings.filter((x) => x.featureId === f.id);
              return (
                <tr key={f.id}>
                  <td style={pin(0)}>{p.category1.name}</td>
                  <td style={pin(1)}>{p.category2.name}</td>
                  <td style={pin(2)} className="pin-edge">
                    <Link component="button" onClick={() => { selectFeature(f.id); setActiveTab('dfd'); }} sx={{ fontSize: 13, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.name}</Link>
                  </td>
                  {(['ILF', 'EIF', 'EI', 'EO', 'EQ'] as const).map((k, i) => <td key={k} className={`r${i === 0 ? ' g' : ''}`}>{r.counts[k]}</td>)}
                  <td className="r g">{r.characteristicsSum}</td>
                  <td>{DEV_TYPE_LABELS[f.devType]}</td>
                  <td className="r">{r.vaf.toFixed(2)}</td>
                  <td className="r g">{r.unadjustedFp}</td>
                  <td className="r">{r.adjustedFp}</td>
                  <td className="r">{r.modificationFactor.toFixed(2)}</td>
                  <td className="r" style={r.hoursPerFpUnset ? { color: tokens.warning } : undefined}>{r.hoursPerFpUnset ? '未設定' : r.hoursPerFp}</td>
                  <td className="r g">{formatNumber(r.effortHours)}</td>
                  <td className="r">{formatNumber(r.inHouseHours)}</td>
                  {vendors.map((v) => <td key={v.id} className="r">{r.vendorId === v.id ? formatNumber(r.outsourceHours) : <span style={{ color: tokens.textDisabled }}>—</span>}</td>)}
                  <td className="r g">{formatNumber(r.cost)}</td>
                  <td className="g desc" title={f.description}>{f.description || <span style={{ color: tokens.textDisabled }}>—</span>}</td>
                  <td>
                    {w.length > 0 && (
                      <Tooltip title={w.map((x) => x.message).join('\n')}>
                        <span style={{ display: 'inline-flex' }} aria-label={`警告 ${w.length} 件`}><WarningIcon /></span>
                      </Tooltip>
                    )}
                  </td>
                </tr>
              );
            })}
            {features.length === 0 && (
              <tr><td colSpan={25} style={{ color: tokens.textSecondary, padding: 16 }}>機能がありません。左のツリーで中分類に機能を追加します。</td></tr>
            )}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={3} style={pin(0, { minWidth: 290, maxWidth: 290, zIndex: 3 })}>合計</td>
              {(['ILF', 'EIF', 'EI', 'EO', 'EQ'] as const).map((k, i) => <td key={k} className={`r${i === 0 ? ' g' : ''}`}>{totals.counts[k]}</td>)}
              <td className="g" /><td /><td />
              <td className="r g">{totals.unadjustedFp}</td>
              <td className="r">{totals.adjustedFp}</td>
              <td /><td />
              <td className="r g">{formatNumber(totals.effortHours)}</td>
              <td className="r">{formatNumber(totals.inHouseHours)}</td>
              {vendors.map((v) => <td key={v.id} className="r">{formatNumber(totals.outsourceHoursByVendor[v.id] ?? 0)}</td>)}
              <td className="r g" data-testid="summary-total-cost">{formatNumber(totals.cost)}</td>
              <td className="g" /><td />
            </tr>
          </tfoot>
        </Box>
      </Box>
    </Box>
  );
}

const tableSx = {
  borderCollapse: 'separate',
  borderSpacing: 0,
  minWidth: '100%',
  fontSize: 13,
  '& th, & td': { height: 32, px: 2, borderBottom: `1px solid ${tokens.border}`, textAlign: 'left', whiteSpace: 'nowrap', background: tokens.surface },
  '& th': { height: 36, background: tokens.headerBg, fontSize: 12, fontWeight: 600, color: tokens.textSecondary, position: 'sticky', top: 0, zIndex: 1 },
  '& tr.group th': { height: 24, background: tokens.appBg, textAlign: 'center', borderLeft: `1px solid ${tokens.border}` },
  '& thead tr:nth-of-type(2) th': { top: 24 },
  '& .r': { textAlign: 'right', fontVariantNumeric: 'tabular-nums' },
  '& .g': { borderLeft: `1px solid ${tokens.border}` },
  '& .pin-edge': { boxShadow: `inset -1px 0 0 ${tokens.border}` },
  '& .desc': { maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', fontSize: 12, color: tokens.textSecondary },
  '& tbody tr:hover td': { background: '#F8F9FB' },
  '& tfoot td': { background: tokens.headerBg, fontWeight: 600, borderTop: `2px solid ${tokens.borderStrong}`, position: 'sticky', bottom: 0, zIndex: 1 },
};
