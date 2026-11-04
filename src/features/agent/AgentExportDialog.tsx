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
import { featurePathLabel } from '../../domain/queries';
import type { Id } from '../../domain/types';
import { copyText } from '../../infra/clipboard';
import { downloadText } from '../../infra/download';
import { useStore } from '../../store';
import { tokens } from '../app/theme';

/**
 * 機能の DFD を AI エージェント（Copilot）が読める JSON で書き出す（FR-IO-01）。
 * 依頼文と JSON をまとめてコピーでき、エージェントに設定する指示（FR-IO-03）もここからコピーできる。
 */
export function AgentExportDialog({ featureId, onClose }: { featureId: Id; onClose: () => void }) {
  const doc = useStore((s) => s.doc);
  const feature = doc.features[featureId];
  const json = useMemo(() => (feature ? JSON.stringify(buildExchange(doc, featureId), null, 2) : ''), [doc, featureId, feature]);
  const [request, setRequest] = useState('');
  const [withInstructions, setWithInstructions] = useState(false);
  if (!feature) return null;
  const s = useStore.getState();
  const nodes = feature.dfd.nodes.length;

  const copy = async (text: string, what: string) => {
    if (await copyText(text)) s.notify(`${what}をコピーしました`, 'success');
    else s.notify(`${what}をコピーできませんでした。ファイルに保存して渡してください`, 'error');
  };

  return (
    <Dialog open onClose={onClose} maxWidth={false} slotProps={{ paper: { sx: { width: 600 } } }}>
      <DialogTitle>Copilot 用に書き出す</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <Typography sx={{ fontSize: 12, color: tokens.textSecondary }}>
          「{featurePathLabel(doc, featureId)}」の DFD（ノード {nodes} 件・データフロー {feature.dfd.edges.length} 本）と、同じソフトウェアの既存の外部エンティティ・データファンクションの一覧を JSON にします。
          エージェントが返した JSON は「Copilot の出力を取り込む」で反映できます。
        </Typography>
        <Box>
          <Typography component="div" sx={{ fontSize: 12, color: tokens.textSecondary, mb: '2px' }}>エージェントへの依頼（任意）</Typography>
          <TextField
            autoFocus fullWidth multiline minRows={2} maxRows={6} value={request} onChange={(e) => setRequest(e.target.value)}
            placeholder="例: CSV ファイルから顧客を一括登録する処理を追加し、複雑度を見直してください"
            slotProps={{ htmlInput: { 'aria-label': 'エージェントへの依頼' } }}
          />
          <FormControlLabel
            control={<Checkbox size="small" checked={withInstructions} onChange={(e) => setWithInstructions(e.target.checked)} />}
            label={<span style={{ fontSize: 13 }}>エージェント用の指示（プロンプト）も含める（指示を設定していないエージェントや、通常の Copilot チャットに貼る場合）</span>}
          />
        </Box>
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
          <Button variant="contained" onClick={() => copy(buildAgentRequest(json, request, withInstructions), '依頼文と JSON ')}>依頼文と JSON をコピー</Button>
          <Button variant="outlined" color="inherit" sx={{ borderColor: tokens.borderStrong }} onClick={() => copy(json, 'JSON ')}>JSON だけコピー</Button>
          <Button
            variant="outlined" color="inherit" sx={{ borderColor: tokens.borderStrong }}
            onClick={() => downloadText(`${safeFileName(feature.name)}_copilot.json`, json, 'application/json')}
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
