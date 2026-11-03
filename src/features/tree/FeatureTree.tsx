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
import { useMemo, useRef, useState } from 'react';
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
  /** 「別の中分類へ移動…」「別の大分類へ移動…」の移動先メニュー（ドラッグを使わない移動、FR-CT-02） */
  const [moveMenu, setMoveMenu] = useState<{ anchor: HTMLElement; node: TreeNode } | null>(null);
  /**
   * メニューから「名前を変更」を選んだ対象。メニューが閉じ切ってから入力欄を開く。
   * 閉じる途中で入力欄を開くと、メニューのフォーカス制御に奪われて入力欄がすぐ閉じてしまうため。
   */
  const pendingRename = useRef<string | null>(null);
  /** ドラッグ中の項目と、現在のドロップ先（FR-CT-02） */
  const [dragId, setDragId] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ id: string; pos: DropPos } | null>(null);
  const index = useMemo(() => indexTree(tree), [tree]);
  const dragEnabled = !filter.trim();

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

  /** ドロップを確定する。並び替え先は「移動元から取り除いたあとの並び」での位置 */
  const performDrop = (target: { id: string; pos: DropPos }) => {
    if (!dragId) return;
    const plan = planDrop(index, dragId, target.id, target.pos);
    if (!plan) return;
    const s = a();
    const kind = index.get(dragId)!.kind;
    if (kind === 'feature') s.moveFeature(dragId, plan.parentId, plan.index);
    else if (kind === 'category2') s.moveCategory(dragId, plan.index, plan.parentId);
    else if (kind === 'category1') s.moveCategory(dragId, plan.index);
    if (target.pos === 'inside') {
      setCollapsed((c) => {
        const next = new Set(c);
        next.delete(target.id);
        return next;
      });
    }
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
          draggable={dragEnabled && n.kind !== 'software' && editing !== n.id}
          aria-grabbed={dragId === n.id ? true : undefined}
          onDragStart={(e) => {
            e.stopPropagation();
            e.dataTransfer.setData('text/plain', n.id);
            e.dataTransfer.effectAllowed = 'move';
            setDragId(n.id);
          }}
          onDragOver={(e) => {
            if (!dragId) return;
            const rect = e.currentTarget.getBoundingClientRect();
            const pos = dropPosition(index, dragId, n.id, e.clientY - rect.top < rect.height / 2);
            if (!pos || !planDrop(index, dragId, n.id, pos)) {
              if (drop?.id === n.id) setDrop(null);
              return;
            }
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            if (drop?.id !== n.id || drop.pos !== pos) setDrop({ id: n.id, pos });
          }}
          onDragLeave={(e) => {
            if (drop?.id === n.id && !e.currentTarget.contains(e.relatedTarget as Node | null)) setDrop(null);
          }}
          onDrop={(e) => {
            e.preventDefault();
            if (drop) performDrop(drop);
            setDrop(null);
            setDragId(null);
          }}
          onDragEnd={() => {
            setDrop(null);
            setDragId(null);
          }}
          data-drop={drop?.id === n.id ? drop.pos : undefined}
          sx={{
            height: 32, display: 'flex', alignItems: 'center', gap: '6px', pr: 2, pl: `${depth * 16 + 4}px`, position: 'relative', cursor: 'default',
            whiteSpace: 'nowrap', background: selected || drop?.id === n.id && drop.pos === 'inside' ? tokens.primarySoft : undefined,
            opacity: dragId === n.id ? 0.5 : 1,
            outline: drop?.id === n.id && drop.pos === 'inside' ? `1px solid ${tokens.primary}` : undefined,
            outlineOffset: -1,
            '&::after': drop?.id === n.id && drop.pos !== 'inside'
              ? { content: '""', position: 'absolute', left: `${depth * 16 + 4}px`, right: 8, height: 2, background: tokens.primary, borderRadius: 1, [drop.pos === 'before' ? 'top' : 'bottom']: -1 }
              : undefined,
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
            // 幅に収まらず省略されたときのため、マウスを重ねると全文を出す
            <Box component="span" title={n.name} sx={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{n.name}</Box>
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
      <Menu
        anchorEl={menu?.anchor}
        open={!!menu}
        onClose={() => setMenu(null)}
        // 閉じたあと「⋯」ボタンへフォーカスを戻さない（改名の入力欄からフォーカスを奪わないため）
        disableRestoreFocus
        slotProps={{
          transition: {
            onExited: () => {
              if (pendingRename.current) {
                setEditing(pendingRename.current);
                pendingRename.current = null;
              }
            },
          },
        }}
      >
        {menu && [
          <MenuItem key="rename" dense onClick={() => { pendingRename.current = menu.node.id; setMenu(null); }}>名前を変更</MenuItem>,
          menu.node.kind !== 'software' && (
            <MenuItem key="up" dense disabled={menu.siblings[0]?.id === menu.node.id} onClick={() => { move(menu.node, menu.siblings, -1); setMenu(null); }}>上へ移動</MenuItem>
          ),
          menu.node.kind !== 'software' && (
            <MenuItem key="down" dense disabled={menu.siblings[menu.siblings.length - 1]?.id === menu.node.id} onClick={() => { move(menu.node, menu.siblings, 1); setMenu(null); }}>下へ移動</MenuItem>
          ),
          (menu.node.kind === 'feature' || menu.node.kind === 'category2') && (
            <MenuItem key="moveTo" dense onClick={() => {
              // 「⋯」ボタンはマウスが離れると非表示になり位置を取れないため、行そのものを基準にする
              const row = (menu.anchor.closest('.tree-row') as HTMLElement | null) ?? menu.anchor;
              setMoveMenu({ anchor: row, node: menu.node });
              setMenu(null);
            }}>
              {menu.node.kind === 'feature' ? '別の中分類へ移動…' : '別の大分類へ移動…'}
            </MenuItem>
          ),
          menu.node.kind === 'feature' && (
            <MenuItem key="copyDfd" dense onClick={() => { a().openCopyDfd(menu.node.id); setMenu(null); }}>DFD を別の機能へコピー…</MenuItem>
          ),
          <MenuItem key="del" dense sx={{ color: tokens.error }} onClick={() => { remove(menu.node); setMenu(null); }}>削除</MenuItem>,
        ]}
      </Menu>
      <Menu
        anchorEl={moveMenu?.anchor}
        open={!!moveMenu}
        onClose={() => setMoveMenu(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        disableRestoreFocus
        slotProps={{ list: { 'aria-label': '移動先', dense: true }, paper: { sx: { maxHeight: 360 } } }}
      >
        {moveMenu && (
          <MenuItem disabled dense sx={{ fontSize: 12, opacity: '1 !important', color: tokens.textSecondary }}>
            「{moveMenu.node.name}」の移動先
          </MenuItem>
        )}
        {moveMenu &&
          moveDestinations(tree, index, moveMenu.node).map((dest) => (
            <MenuItem
              key={dest.id}
              dense
              disabled={dest.current}
              onClick={() => {
                const s = a();
                const n = moveMenu.node;
                const at = index.get(dest.id)!.childIds.length;
                if (n.kind === 'feature') s.moveFeature(n.id, dest.id, at);
                else s.moveCategory(n.id, at, dest.id);
                setCollapsed((c) => {
                  const next = new Set(c);
                  next.delete(dest.id);
                  return next;
                });
                setMoveMenu(null);
              }}
            >
              {dest.label}
              {dest.current && <span style={{ marginLeft: 8, fontSize: 11, color: tokens.textSecondary }}>（現在の場所）</span>}
            </MenuItem>
          ))}
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

// ---------- ドラッグによる並べ替え（FR-CT-02） ----------

type DropPos = 'before' | 'after' | 'inside';

interface TreeIndexEntry {
  kind: TreeNode['kind'];
  parentId: string | null;
  softwareId: string;
  childIds: string[];
}

function indexTree(tree: TreeNode[]): Map<string, TreeIndexEntry> {
  const map = new Map<string, TreeIndexEntry>();
  const walk = (n: TreeNode, parentId: string | null, softwareId: string) => {
    map.set(n.id, { kind: n.kind, parentId, softwareId, childIds: n.children.map((c) => c.id) });
    for (const c of n.children) walk(c, n.id, softwareId);
  };
  for (const sw of tree) walk(sw, null, sw.id);
  return map;
}

const PARENT_KIND: Partial<Record<TreeNode['kind'], TreeNode['kind']>> = {
  category1: 'software',
  category2: 'category1',
  feature: 'category2',
};

/** 行のどこに落とすか。同じ階層なら上半分で前・下半分で後ろ、1 つ上の階層ならその中（末尾） */
function dropPosition(index: Map<string, TreeIndexEntry>, dragId: string, targetId: string, upperHalf: boolean): DropPos | null {
  const d = index.get(dragId);
  const t = index.get(targetId);
  if (!d || !t || dragId === targetId) return null;
  if (t.kind === d.kind) return upperHalf ? 'before' : 'after';
  if (t.kind === PARENT_KIND[d.kind]) return 'inside';
  return null;
}

/** 移動先の親と、移動元から取り除いたあとの並びでの位置。移動できない・並びが変わらないなら null */
function planDrop(index: Map<string, TreeIndexEntry>, dragId: string, targetId: string, pos: DropPos): { parentId: string; index: number } | null {
  const d = index.get(dragId);
  const t = index.get(targetId);
  if (!d || !t || dragId === targetId || d.softwareId !== t.softwareId) return null;
  let parentId: string;
  let at: number;
  if (pos === 'inside') {
    if (t.kind !== PARENT_KIND[d.kind]) return null;
    parentId = targetId;
    at = t.childIds.filter((id) => id !== dragId).length;
  } else {
    if (t.kind !== d.kind || !t.parentId) return null;
    parentId = t.parentId;
    const rest = index.get(parentId)!.childIds.filter((id) => id !== dragId);
    at = rest.indexOf(targetId) + (pos === 'after' ? 1 : 0);
  }
  // 同じ親で位置が変わらないなら何もしない
  if (parentId === d.parentId && index.get(parentId)!.childIds.indexOf(dragId) === at) return null;
  return { parentId, index: at };
}

/**
 * 移動先の候補（同じソフトウェア内）。機能なら中分類の一覧、中分類なら大分類の一覧。
 */
function moveDestinations(tree: TreeNode[], index: Map<string, TreeIndexEntry>, node: TreeNode): { id: string; label: string; current: boolean }[] {
  const self = index.get(node.id);
  if (!self) return [];
  const sw = tree.find((t) => t.id === self.softwareId);
  if (!sw) return [];
  const out: { id: string; label: string; current: boolean }[] = [];
  for (const c1 of sw.children) {
    if (node.kind === 'category2') {
      out.push({ id: c1.id, label: c1.name, current: c1.id === self.parentId });
      continue;
    }
    for (const c2 of c1.children) out.push({ id: c2.id, label: `${c1.name} / ${c2.name}`, current: c2.id === self.parentId });
  }
  return out;
}
