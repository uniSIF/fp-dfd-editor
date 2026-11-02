import Box from '@mui/material/Box';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import { CHARACTERISTIC_NAMES } from '../../domain/fpTables';
import { tokens } from '../app/theme';

/** C1〜C14 の入力（7 列 × 2 行、ui-design.md 5 章） */
export function CharacteristicsEditor({ value, onChange }: { value: number[]; onChange: (next: number[]) => void }) {
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: '6px 8px' }}>
      {CHARACTERISTIC_NAMES.map((name, i) => (
        <Box key={i} sx={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 }}>
          <Box component="label" htmlFor={`c${i + 1}`} title={`C${i + 1} ${name}`} sx={{ fontSize: 11, color: tokens.textSecondary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            <b style={{ color: tokens.text, fontWeight: 600, marginRight: 3 }}>C{i + 1}</b>
            {name}
          </Box>
          <Select
            id={`c${i + 1}`}
            value={value[i]}
            onChange={(e) => {
              const next = [...value];
              next[i] = Number(e.target.value);
              onChange(next);
            }}
            sx={{ height: 26, fontSize: 12, minWidth: 0 }}
            inputProps={{ 'aria-label': `C${i + 1} ${name}` }}
          >
            {[0, 1, 2, 3, 4, 5].map((n) => (
              <MenuItem key={n} value={n} dense>{n}</MenuItem>
            ))}
          </Select>
        </Box>
      ))}
    </Box>
  );
}
