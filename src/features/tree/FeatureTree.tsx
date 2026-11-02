import AddIcon from '@mui/icons-material/Add';
import MoreHorizIcon from '@mui/icons-material/MoreHoriz';
import SearchIcon from '@mui/icons-material/Search';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import InputBase from '@mui/material/InputBase';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Typography from '@mui/material/Typography';
import { useMemo, useState } from 'react';
import { useStore } from '../../store';
import { selectTree, type TreeNode } from '../../store/selectors';
import { openSample } from '../app/commands';
import { tokens } from '../app/theme';
import { WarningChip } from '../common/WarningIcon';

const CHILD_LABEL: Record<TreeNode['kind'], string | null> = {
  software: '大分類を追加',
  category1: '中分類を追加',
  category2: '機能を追加',
  feature: null,
};

const NEW_NAME: Record<TreeNode['kind'], string> = {
  software: '新しい大分類',
  category1: '新しい中分類',
  category2: '新しい機能',
  feature: '',
};

function countDescendants(n: TreeNode): { categories: number; features: number } {
  let categories = 0;
  let features = 0;
  const walk = (x: TreeNode) => {
    for (const c of x.children) {
      if (c.kind === 'feature') features++;
      else categories++;
      walk(c);
    }
  };
  walk(n);
  return { categories, features };
}

/** 機能ツリー（ui-design.md 4.2）。ソフトウェア → 大分類 → 中分類 → 機能 */
export function FeatureTree() {
  const doc = useStore((s) => s.doc);
  const selectedFeatureId = useStore((s) => s.selectedFeatureId);
  const selectedSoftwareId = useStore((s) => s.selectedSoftwareId);
  const a = useStore.getState;
  const tree = selectTree(doc, null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [menu, setMenu] = useState<{ anchor: HTMLElement; node: TreeNode; siblings: TreeNode[] } | null>(null);

  const visible = useMemo(() => {
    const q = filter.trim();
    if (!q) return tree;
    const prune = (n: TreeNode): TreeNode | null => {
      if (n.kind === 'feature') return n.name.includes(q) ? n : null;
      const children = n.children.map(prune).filter((x): x is TreeNode => !!x);
      return children.length ? { ...n, children } : null;
    };
    return tree.map(prune).filter((x): x is TreeNode => !!x);
  }, [tree, filter]);

  const rename = (n: TreeNode, name: string) => {
    const s = a();
    if (n.kind === 'software') s.renameSoftware(n.id, name);
    else if (n.kind === 'feature') s.updateFeature(n.id, { name });
    else s.renameCategory(n.id, name);
  };

  const addChild = (n: TreeNode) => {
    const s = a();
    let id: string;
    if (n.kind === 'software') id = s.addCategory1(n.id, NEW_NAME.software);
    else if (n.kind === 'category1') id = s.addCategory2(n.id, NEW_NAME.category1);
    else id = s.addFeature(n.id, NEW_NAME.category2);
    setCollapsed((c) => {
      const next = new Set(c);
      next.delete(n.id);
      return next;
    });
    setEditing(id);
  };

  const remove = (n: TreeNode) => {
    const s = a();
    const { categories, features } = countDescendants(n);
    const details: string[] = [];
    if (categories) details.push(`配下の分類 ${categories} 件`);
    if (features) details.push(`配下の機能 ${features} 件とその DFD・ファンクション`);
    if (n.kind === 'feature' || features) details.push('この機能が所有するデータファンクションは削除されず「所有機能未設定」になります');
    s.openConfirm({
      title: `「${n.name}」を削除しますか`,
      details,
      actions: [
        { label: 'キャンセル' },
        {
          label: '削除', color: 'error', variant: 'contained',
          onClick: () => {
            if (n.kind === 'software') s.removeSoftware(n.id);
            else if (n.kind === 'feature') s.removeFeature(n.id);
            else s.removeCategory(n.id);
          },
        },
      ],
    });
  };

  const move = (n: TreeNode, siblings: TreeNode[], delta: number) => {
    const idx = siblings.findIndex((x) => x.id === n.id) + delta;
    if (idx < 0 || idx >= siblings.length) return;
    const s = a();
    if (n.kind === 'feature') s.moveFeature(n.id, doc.features[n.id].category2Id, idx);
    else if (n.kind !== 'software') s.moveCategory(n.id, idx);
  };

  const renderNode = (n: TreeNode, depth: number, siblings: TreeNode[]) => {
    const isOpen = !collapsed.has(n.id) || !!filter.trim();
    const selected = n.kind === 'feature' ? n.id === selectedFeatureId : n.kind === 'software' && !selectedFeatureId && n.id === selectedSoftwareId;
    return (
      <Box key={n.id} role="treeitem" aria-expanded={n.kind !== 'feature' ? isOpen : undefined} aria-selected={selected}>
        <Box
          className="tree-row"
          data-testid={`tree-${n.kind}-${n.name}`}
          onClick={() => {
            const s = a();
            if (n.kind === 'feature') s.selectFeature(n.id);
            else if (n.kind === 'software') {
              s.selectFeature(null);
              s.selectSoftware(n.id);
            }
          }}
          onDoubleClick={() => setEditing(n.id)}
          sx={{
            height: 32, display: 'flex', alignItems: 'center', gap: '6px', pr: 2, pl: `${depth * 16 + 4}px`, position: 'relative', cursor: 'default',
            whiteSpace: 'nowrap', background: selected ? tokens.primarySoft : undefined,
            '&:hover': { background: selected ? tokens.primarySoft : tokens.hover },
            '&::before': selected ? { content: '""', position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, background: tokens.primary } : undefined,
            '& .hover-actions': { display: 'none' },
            '&:hover .hover-actions, &:focus-within .hover-actions': { display: 'flex' },
          }}
        >
          <Box
            component="button"
            aria-label={isOpen ? '折りたたむ' : '展開する'}
            onClick={(e) => {
              e.stopPropagation();
              setCollapsed((c) => {
                const next = new Set(c);
                if (next.has(n.id)) next.delete(n.id);
                else next.add(n.id);
                return next;
              });
            }}
            sx={{ width: 14, border: 0, background: 'none', p: 0, fontSize: 10, color: tokens.textSecondary, visibility: n.kind === 'feature' ? 'hidden' : 'visible', cursor: 'pointer' }}
          >
            {isOpen ? '▾' : '▸'}
          </Box>
          <NodeIcon kind={n.kind} selected={selected} />
          {editing === n.id ? (
            <InputBase
              autoFocus
              defaultValue={n.name}
              onClick={(e) => e.stopPropagation()}
              onFocus={(e) => e.target.select()}
              onBlur={(e) => {
                const v = e.target.value.trim();
                if (v && v !== n.name) rename(n, v);
                setEditing(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                if (e.key === 'Escape') setEditing(null);
              }}
              sx={{ flex: 1, fontSize: 13, height: 24, border: `1px solid ${tokens.primary}`, borderRadius: '3px', px: 1 }}
              inputProps={{ 'aria-label': '名称' }}
            />
          ) : (
            <Box component="span" sx={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{n.name}</Box>
          )}
          {n.warningCount > 0 && <WarningChip count={n.warningCount} title={`警告 ${n.warningCount} 件`} />}
          <Box className="hover-actions" sx={{ gap: '2px' }}>
            {CHILD_LABEL[n.kind] && (
              <IconButton size="small" title={CHILD_LABEL[n.kind]!} aria-label={CHILD_LABEL[n.kind]!} sx={{ width: 22, height: 22 }} onClick={(e) => { e.stopPropagation(); addChild(n); }}>
                <AddIcon sx={{ fontSize: 16 }} />
              </IconButton>
            )}
            <IconButton size="small" title="その他" aria-label="その他の操作" sx={{ width: 22, height: 22 }} onClick={(e) => { e.stopPropagation(); setMenu({ anchor: e.currentTarget, node: n, siblings }); }}>
              <MoreHorizIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </Box>
        </Box>
        {n.kind !== 'feature' && isOpen && n.children.map((c) => renderNode(c, depth + 1, n.children))}
      </Box>
    );
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <Box sx={{ p: 2, display: 'flex', gap: 2, borderBottom: `1px solid ${tokens.border}` }}>
        <Box sx={{ flex: 1, height: 28, border: `1px solid ${tokens.border}`, borderRadius: '3px', px: 2, display: 'flex', alignItems: 'center', gap: 1.5, background: '#FBFBFC' }}>
          <SearchIcon sx={{ fontSize: 14, color: tokens.textDisabled }} />
          <InputBase placeholder="機能名で絞り込み" value={filter} onChange={(e) => setFilter(e.target.value)} sx={{ fontSize: 13, flex: 1 }} inputProps={{ 'aria-label': '機能名で絞り込み' }} />
        </Box>
        <Button
          variant="outlined"
          color="inherit"
          title="ソフトウェアを追加"
          aria-label="ソフトウェアを追加"
          sx={{ minWidth: 0, width: 38, borderColor: tokens.borderStrong }}
          onClick={() => {
            const id = a().addSoftware('新しいソフトウェア');
            setEditing(id);
          }}
        >
          <AddIcon fontSize="small" />
        </Button>
      </Box>
      <Box role="tree" aria-label="機能ツリー" sx={{ overflow: 'auto', py: 1, flex: 1 }}>
        {tree.length === 0 ? (
          <Box sx={{ p: 4, textAlign: 'center' }}>
            <Typography sx={{ fontSize: 16, fontWeight: 600, mb: 1 }}>ソフトウェアがありません</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>見積もり対象のソフトウェアを追加して始めます。</Typography>
            <Button variant="contained" onClick={() => setEditing(a().addSoftware('新しいソフトウェア'))}>ソフトウェアを追加</Button>
            <Box><Button sx={{ mt: 2 }} onClick={openSample}>サンプルを開く</Button></Box>
          </Box>
        ) : (
          visible.map((n) => renderNode(n, 0, visible))
        )}
      </Box>
      <Menu anchorEl={menu?.anchor} open={!!menu} onClose={() => setMenu(null)}>
        {menu && [
          <MenuItem key="rename" dense onClick={() => { setEditing(menu.node.id); setMenu(null); }}>名前を変更</MenuItem>,
          menu.node.kind !== 'software' && (
            <MenuItem key="up" dense disabled={menu.siblings[0]?.id === menu.node.id} onClick={() => { move(menu.node, menu.siblings, -1); setMenu(null); }}>上へ移動</MenuItem>
          ),
          menu.node.kind !== 'software' && (
            <MenuItem key="down" dense disabled={menu.siblings[menu.siblings.length - 1]?.id === menu.node.id} onClick={() => { move(menu.node, menu.siblings, 1); setMenu(null); }}>下へ移動</MenuItem>
          ),
          <MenuItem key="del" dense sx={{ color: tokens.error }} onClick={() => { remove(menu.node); setMenu(null); }}>削除</MenuItem>,
        ]}
      </Menu>
    </Box>
  );
}

function NodeIcon({ kind, selected }: { kind: TreeNode['kind']; selected: boolean }) {
  const c = selected ? tokens.primary : tokens.textSecondary;
  if (kind === 'feature') return <span style={{ width: 14, height: 14, border: `1.5px solid ${c}`, borderRadius: '50%', flex: 'none', boxSizing: 'border-box' }} />;
  if (kind === 'software') return <span style={{ width: 14, height: 14, border: `1.5px solid ${c}`, borderRadius: 2, flex: 'none', boxSizing: 'border-box' }} />;
  return <span style={{ width: 14, height: 11, border: `1.5px solid ${c}`, borderTopWidth: 3, borderRadius: 2, flex: 'none', marginTop: 2, boxSizing: 'border-box' }} />;
}
