import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControlLabel from '@mui/material/FormControlLabel';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useMemo, useState } from 'react';
import { AGENT_INSTRUCTIONS, buildAgentRequest } from '../../domain/agentPrompt';
import { safeFileName } from '../../domain/csvExport';
import { buildExchange } from '../../domain/exchange';
import { featuresInOrder, getFeaturePath } from '../../domain/queries';
import type { Id } from '../../domain/types';
import { copyText } from '../../infra/clipboard';
import { downloadText } from '../../infra/download';
import { useStore } from '../../store';
import { tokens } from '../app/theme';
import { ellipsis } from '../common/ellipsis';

/**
 * 機能（1 つ以上）の DFD を AI エージェント（Copilot）が読める JSON で書き出す（FR-IO-01、FR-IO-04）。
 * 依頼文と JSON をまとめてコピーでき、エージェントに設定する指示（FR-IO-03）もここからコピーできる。
 */
export function AgentExportDialog({ softwareId, featureId, onClose }: { softwareId: Id; featureId: Id | null; onClose: () => void }) {
  const doc = useStore((s) => s.doc);
  const all = featuresInOrder(doc, softwareId);
  // 既定は選択中の機能。なければ DFD のある機能すべて
  const [checked, setChecked] = useState<Set<Id>>(() => new Set(featureId ? [featureId] : all.filter((f) => f.dfd.nodes.length).map((f) => f.id)));
  const selected = all.filter((f) => checked.has(f.id)).map((f) => f.id);
  const json = useMemo(() => {
    const ids = featuresInOrder(doc, softwareId).filter((f) => checked.has(f.id)).map((f) => f.id);
    return ids.length ? JSON.stringify(buildExchange(doc, ids), null, 2) : '';
  }, [doc, softwareId, checked]);
  const [request, setRequest] = useState('');
  const [withInstructions, setWithInstructions] = useState(false);
  const sw = doc.softwares[softwareId];
  if (!sw) return null;
  const s = useStore.getState();
  const toggle = (id: Id) => setChecked((cur) => {
    const next = new Set(cur);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });

  const copy = async (text: string, what: string) => {
    if (await copyText(text)) s.notify(`${what}をコピーしました`, 'success');
    else s.notify(`${what}をコピーできませんでした。ファイルに保存して渡してください`, 'error');
  };
  const fileName = selected.length === 1 ? doc.features[selected[0]].name : `${sw.name}_${selected.length}機能`;

  return (
    <Dialog open onClose={onClose} maxWidth={false} slotProps={{ paper: { sx: { width: 640 } } }}>
      <DialogTitle>Copilot 用に書き出す</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <Typography sx={{ fontSize: 12, color: tokens.textSecondary }}>
          選んだ機能の DFD と、「{sw.name}」の既存の分類・機能・外部エンティティ・データファンクションの一覧を JSON にします。
          参考にさせたい機能を選び、依頼に「これらを参考に〇〇の機能を作って」のように書くと、エージェントが新しい機能の DFD も返します。
          返った JSON は「Copilot の出力を取り込む」で反映できます。
        </Typography>
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', mb: '2px' }}>
            <Typography component="div" sx={{ fontSize: 12, color: tokens.textSecondary, flex: 1 }}>書き出す機能（{selected.length} / {all.length}）</Typography>
            <Button size="small" onClick={() => setChecked(new Set(all.map((f) => f.id)))}>すべて選択</Button>
            <Button size="small" onClick={() => setChecked(new Set(all.filter((f) => f.dfd.nodes.length).map((f) => f.id)))}>DFD のある機能</Button>
            <Button size="small" onClick={() => setChecked(new Set())}>選択解除</Button>
          </Box>
          <Box role="list" aria-label="書き出す機能" sx={{ border: `1px solid ${tokens.border}`, borderRadius: '3px', maxHeight: 200, overflow: 'auto' }}>
            {all.map((f) => {
              const p = getFeaturePath(doc, f.id)!;
              return (
                <Box component="label" role="listitem" key={f.id} sx={{ display: 'flex', alignItems: 'center', gap: 1, pr: 3, height: 32, borderBottom: `1px solid ${tokens.border}`, '&:last-child': { borderBottom: 0 }, cursor: 'pointer', '&:hover': { background: '#F8F9FB' } }}>
                  <Checkbox size="small" checked={checked.has(f.id)} onChange={() => toggle(f.id)} slotProps={{ input: { 'aria-label': f.name } }} />
                  <span style={ellipsis({ maxWidth: '45%', fontSize: 12, color: tokens.textSecondary })} title={`${p.category1.name} / ${p.category2.name}`}>{p.category1.name} / {p.category2.name} /</span>
                  <span style={ellipsis({ flex: 1 })} title={f.name}>{f.name}</span>
                  <span style={{ flexShrink: 0, fontSize: 11, color: tokens.textSecondary }}>{f.dfd.nodes.length ? `ノード ${f.dfd.nodes.length}` : 'DFD なし'}</span>
                </Box>
              );
            })}
          </Box>
        </Box>
        <Box>
          <Typography component="div" sx={{ fontSize: 12, color: tokens.textSecondary, mb: '2px' }}>エージェントへの依頼（任意）</Typography>
          <TextField
            autoFocus fullWidth multiline minRows={2} maxRows={6} value={request} onChange={(e) => setRequest(e.target.value)}
            placeholder="例: 「顧客登録」「顧客検索」を参考に、「取引先登録」「取引先検索」の機能を顧客管理 / 取引先情報に作ってください"
            slotProps={{ htmlInput: { 'aria-label': 'エージェントへの依頼' } }}
          />
          <FormControlLabel
            control={<Checkbox size="small" checked={withInstructions} onChange={(e) => setWithInstructions(e.target.checked)} />}
            label={<span style={{ fontSize: 13 }}>エージェント用の指示（プロンプト）も含める（指示を設定していないエージェントや、通常の Copilot チャットに貼る場合）</span>}
          />
        </Box>
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
          <Button variant="contained" disabled={!json} onClick={() => copy(buildAgentRequest(json, request, withInstructions), '依頼文と JSON ')}>依頼文と JSON をコピー</Button>
          <Button variant="outlined" color="inherit" disabled={!json} sx={{ borderColor: tokens.borderStrong }} onClick={() => copy(json, 'JSON ')}>JSON だけコピー</Button>
          <Button
            variant="outlined" color="inherit" disabled={!json} sx={{ borderColor: tokens.borderStrong }}
            onClick={() => downloadText(`${safeFileName(fileName)}_copilot.json`, json, 'application/json')}
          >
            JSON をファイルに保存
          </Button>
        </Box>
        <Box sx={{ borderTop: `1px solid ${tokens.border}`, pt: 3 }}>
          <Typography sx={{ fontSize: 13, fontWeight: 600, mb: 1 }}>エージェントの設定</Typography>
          <Typography sx={{ fontSize: 12, color: tokens.textSecondary, mb: 2 }}>
            Copilot Studio やエージェントビルダーでエージェントを作るときは、この指示を「指示」欄に貼ります。設定しておけば、毎回は「依頼文と JSON」だけを渡せば済みます。
          </Typography>
          <Button variant="outlined" color="inherit" sx={{ borderColor: tokens.borderStrong }} onClick={() => copy(AGENT_INSTRUCTIONS, 'エージェント用の指示')}>
            エージェント用の指示をコピー
          </Button>
        </Box>
        <Box component="details" sx={{ fontSize: 12 }}>
          <Box component="summary" sx={{ cursor: 'pointer', color: tokens.textSecondary }}>書き出す JSON を見る</Box>
          <Box component="pre" aria-label="書き出す JSON" sx={{ m: 0, mt: 1, p: 2, maxHeight: 220, overflow: 'auto', background: tokens.headerBg, border: `1px solid ${tokens.border}`, borderRadius: '3px', fontSize: 11 }}>
            {json}
          </Box>
        </Box>
      </DialogContent>
      <DialogActions sx={{ px: 6, pb: 4 }}>
        <Button onClick={onClose}>閉じる</Button>
      </DialogActions>
    </Dialog>
  );
}
