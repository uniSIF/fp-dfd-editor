import { expect, test, type Locator, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

const SHOTS = process.env.E2E_SHOTS;
/** DFD のノード（システム境界の枠は除く） */
const NODE = '.react-flow__node:not(.react-flow__node-boundary)';

async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  await page.waitForTimeout(500); // ダイアログ・スナックバーのトランジション完了を待つ
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

async function openSample(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'サンプルを開く' }).click();
  await expect(page.getByTestId('cost-feature')).toHaveText('820,000');
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
});

test('空の状態からサンプルを開くと、費用サマリーが要件の計算例と一致する（FR-FN-13）', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('ソフトウェアがありません').first()).toBeVisible();
  await shot(page, '00-empty');
  await openSample(page);
  await expect(page.getByTestId('cost-total')).toHaveText('1,316,000');
  // DFD のノードが描画される
  await expect(page.locator(NODE)).toHaveCount(6);
  await expect(page.locator('.react-flow__edge')).toHaveCount(7);
  await shot(page, '01-dfd');

  // タブを切り替えても費用サマリーは表示されたまま
  for (const tab of ['ファンクション表', '一覧', '台帳']) {
    await page.getByRole('tab', { name: tab }).click();
    await expect(page.getByTestId('cost-total')).toHaveText('1,316,000');
    await shot(page, `02-tab-${tab}`);
  }
  await expect(page.getByTestId('summary-total-cost')).toHaveCount(0); // 台帳タブでは一覧の合計行は無い
  await page.getByRole('tab', { name: '一覧' }).click();
  await expect(page.getByTestId('summary-total-cost')).toHaveText('1,316,000');
});

test('CSV・SVG・保存ファイルの内容（FR-CSV、FR-SVG、FR-SV-01）', async ({ page }) => {
  await openSample(page);

  const [csvDl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'CSV出力' }).first().click()]);
  expect(csvDl.suggestedFilename()).toMatch(/^顧客管理システム_\d{8}-\d{4}\.csv$/);
  const csv = readFileSync((await csvDl.path())!, 'utf-8');
  expect(csv.charCodeAt(0)).toBe(0xfeff);
  const lines = csv.slice(1).split('\r\n');
  expect(lines[1]).toBe('顧客管理,顧客情報,顧客登録,1,0,1,1,1,3,2,3,2,1,2,3,2,1,1,2,3,2,1,新規,21,0.93,19,1.00,152,60,92,,820000,顧客の新規登録。氏名、住所、連絡先を入力し顧客マスタに登録する');

  const [svgDl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'SVG出力' }).click()]);
  expect(svgDl.suggestedFilename()).toBe('顧客管理システム_顧客登録.svg');
  const svg = readFileSync((await svgDl.path())!, 'utf-8');
  const parsed = await page.evaluate((text) => {
    const d = new DOMParser().parseFromString(text, 'image/svg+xml');
    return { error: d.getElementsByTagName('parsererror').length, circles: d.getElementsByTagName('circle').length };
  }, svg);
  expect(parsed).toEqual({ error: 0, circles: 3 });

  const [jsonDl] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('ControlOrMeta+s')]);
  expect(jsonDl.suggestedFilename()).toBe('サンプルプロジェクト.fpdfd.json');
  const saved = JSON.parse(readFileSync((await jsonDl.path())!, 'utf-8'));
  expect(saved.schemaVersion).toBe(1);
  expect(saved.features.fReg.name).toBe('顧客登録');
  await expect(page.getByText('未保存の変更')).toHaveCount(0);
});

test('接続ルール違反は理由を表示して接続しない（FR-DF-06）', async ({ page }) => {
  await openSample(page);
  const ee = page.locator('.react-flow__node[data-id="n1"]'); // 利用者
  const ds = page.locator('.react-flow__node[data-id="n5"]'); // 顧客マスタ
  await ee.hover();
  const handle = ee.locator('.react-flow__handle-right');
  const hb = (await handle.boundingBox())!;
  const tb = (await ds.boundingBox())!;
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2, { steps: 12 });
  await page.mouse.up();
  await expect(page.getByText('外部エンティティとデータストアは直接接続できません。プロセスを介してください。')).toBeVisible();
  await expect(page.locator('.react-flow__edge')).toHaveCount(7);
  await shot(page, '03-connect-rejected');
});

test('ファンクション表で追加すると DFD に配置され、費用が変わり、Undo で戻る（FR-FN-09、FR-DF-10）', async ({ page }) => {
  await openSample(page);
  await page.getByRole('tab', { name: 'ファンクション表' }).click();
  await page.getByRole('button', { name: '＋ トランザクション' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('名称').fill('登録エラー通知');
  await dialog.getByRole('button', { name: /EO/ }).click();
  await dialog.getByLabel('説明').fill('入力エラー時に通知する');
  await shot(page, '04-add-dialog');
  await dialog.getByRole('button', { name: '追加して配置' }).click();
  await expect(page.getByRole('gridcell', { name: '登録エラー通知', exact: true })).toBeVisible();
  // EO 低 = 4 FP 増える: 未調整 25、調整済 floor(25×0.93)=23、工数 184、社内 73、外注 111 → 73×6000+111×5000
  await expect(page.getByTestId('cost-feature')).toHaveText('993,000');
  await page.getByRole('tab', { name: 'DFD' }).click();
  await expect(page.locator(NODE)).toHaveCount(7);
  await page.locator('.react-flow__pane').click({ position: { x: 600, y: 600 } });
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.locator(NODE)).toHaveCount(6);
  await expect(page.getByTestId('cost-feature')).toHaveText('820,000');
});

test('DF ノードを削除しようとすると配置解除と削除を選べる（FR-DF-08）', async ({ page }) => {
  await openSample(page);
  await page.locator('.react-flow__node[data-id="n6"]').click(); // 商品マスタ（所有: 商品登録）
  await expect(page.getByText('この機能には計上されません（所有: 商品登録）')).toBeVisible();
  await shot(page, '05-ref-node-props');
  await page.keyboard.press('Delete');
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('「商品マスタ」をどうしますか')).toBeVisible();
  await shot(page, '06-delete-dialog');
  await dialog.getByRole('button', { name: /この DFD から配置を解除/ }).click();
  await expect(page.locator(NODE)).toHaveCount(5);
});

test('自動バックアップが保存され、再読み込みで復元される（FR-SV-03、FR-SV-04）', async ({ page }) => {
  await page.clock.install();
  await openSample(page);
  // 名称を変更して 1 分進める
  await page.getByRole('tab', { name: 'ファンクション表' }).click();
  await page.getByRole('complementary', { name: 'プロパティ' }).getByRole('textbox', { name: '機能の説明' }).fill('変更後の説明');
  await page.getByRole('complementary', { name: 'プロパティ' }).getByRole('textbox', { name: '機能の説明' }).blur();
  await page.clock.runFor(61_000);
  await expect(page.getByText(/バックアップ \d\d:\d\d/)).toBeVisible();
  const index = await page.evaluate(() => localStorage.getItem('fpdfd.backup.index'));
  expect(JSON.parse(index!)).toHaveLength(1);
  page.on('dialog', (d) => void d.accept()); // beforeunload
  await page.reload();
  await expect(page.getByTestId('cost-feature')).toHaveText('820,000');
  await page.getByRole('tab', { name: 'ファンクション表' }).click();
  await expect(page.getByRole('complementary', { name: 'プロパティ' }).getByRole('textbox', { name: '機能の説明' })).toHaveValue('変更後の説明');
});

test('設定ダイアログと業者の追加', async ({ page }) => {
  await openSample(page);
  await page.getByRole('button', { name: '設定' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('設定: 顧客管理システム')).toBeVisible();
  await shot(page, '07-settings');
  await dialog.getByLabel('社内への配分比率').fill('100');
  await dialog.getByRole('button', { name: '保存' }).click();
  // 全工数が社内: 152 × 6000
  await expect(page.getByTestId('cost-feature')).toHaveText('912,000');
});

test('空の状態から機能を作り、パレットで追加したノードを接続できる（基本フロー）', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'ソフトウェアを追加' }).first().click();
  const nameInput = page.getByRole('textbox', { name: '名称' });
  await nameInput.fill('受注システム');
  await nameInput.press('Enter');
  const swRow = page.getByTestId('tree-software-受注システム');
  await swRow.hover();
  await swRow.getByRole('button', { name: '大分類を追加' }).click();
  await nameInput.fill('受注');
  await nameInput.press('Enter');
  const c1 = page.getByTestId('tree-category1-受注');
  await c1.hover();
  await c1.getByRole('button', { name: '中分類を追加' }).click();
  await nameInput.fill('受注登録');
  await nameInput.press('Enter');
  const c2 = page.getByTestId('tree-category2-受注登録');
  await c2.hover();
  await c2.getByRole('button', { name: '機能を追加' }).click();
  await nameInput.fill('受注入力');
  await nameInput.press('Enter');
  await expect(page.getByText('ノードがありません')).toBeVisible();

  // パレットから外部エンティティと EI を追加
  await page.getByRole('button', { name: '外部エンティティを追加' }).click();
  await page.getByRole('dialog').getByLabel('名称').fill('顧客');
  await page.getByRole('dialog').getByRole('button', { name: '追加して配置' }).click();
  await page.getByRole('button', { name: 'トランザクションファンクションを追加' }).first().click();
  await page.getByRole('dialog').getByLabel('名称').fill('受注入力画面');
  await page.getByRole('dialog').getByRole('button', { name: '追加して配置' }).click();
  await expect(page.locator(NODE)).toHaveCount(2);

  // 外部エンティティ → EI をドラッグで接続
  const nodes = page.locator(NODE);
  const ee = nodes.filter({ hasText: '顧客' }).first();
  const tf = nodes.filter({ hasText: '受注入力画面' });
  await ee.hover();
  const h = (await ee.locator('.react-flow__handle-right').boundingBox())!;
  const t = (await tf.boundingBox())!;
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(t.x + t.width / 2, t.y + t.height / 2, { steps: 12 });
  await page.mouse.up();
  await expect(page.locator('.react-flow__edge')).toHaveCount(1);
  await page.getByRole('button', { name: '自動整列' }).click();
  await shot(page, '08-new-feature-dfd');
  // H/FP 未設定の警告が出る
  await expect(page.getByRole('button', { name: /警告 1/ })).toBeVisible();
});

test('SVG 出力の見た目', async ({ page }) => {
  test.skip(!SHOTS, 'スクリーンショット指定時のみ');
  await openSample(page);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'SVG出力' }).click()]);
  const svg = readFileSync((await dl.path())!, 'utf-8');
  await page.setContent(`<body style="margin:0;background:#eee">${svg}</body>`);
  await page.locator('svg').first().screenshot({ path: `${SHOTS}/09-export.png` });
});

test('表で複雑度を変えると FP 列・費用が更新される（DataGrid の派生値の更新）', async ({ page }) => {
  await openSample(page);
  await page.getByRole('tab', { name: 'ファンクション表' }).click();
  const row = page.getByRole('row').filter({ hasText: 'TF-002' });
  await row.getByRole('gridcell', { name: '低' }).dblclick();
  await page.getByRole('option', { name: '高' }).click();
  await expect(row.locator('[data-field="fp"]')).toHaveText('7');
  await expect(page.getByTestId('cost-feature')).toHaveText('950,000');
});

test('選択を解除するとプロパティは機能の表示に戻る', async ({ page }) => {
  await openSample(page);
  await page.locator('.react-flow__node[data-id="n2"]').click();
  await expect(page.getByRole('button', { name: '機能のプロパティ' })).toBeVisible();
  await page.locator('.react-flow__pane').click({ position: { x: 700, y: 600 } });
  await expect(page.getByRole('button', { name: '機能のプロパティ' })).toHaveCount(0);
  await expect(page.getByText('機能のプロパティ')).toBeVisible();
});

test('ファンクション表で名称だけ変えて複製できる（FR-FN-14）', async ({ page }) => {
  await openSample(page);
  await page.getByRole('tab', { name: 'ファンクション表' }).click();
  await page.getByRole('button', { name: '登録完了通知 を複製' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('トランザクションファンクションを複製')).toBeVisible();
  // 名称は全選択されているので、そのまま入力すると置き換わる
  await page.keyboard.type('登録失敗通知');
  await expect(dialog.getByLabel('名称')).toHaveValue('登録失敗通知');
  await expect(dialog.getByRole('button', { name: /EO/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(dialog.getByLabel('説明')).toHaveValue('登録後に受付番号をメールで通知する。');
  await shot(page, '10-duplicate-dialog');
  await dialog.getByRole('button', { name: '複製して配置' }).click();
  const row = page.getByRole('row').filter({ hasText: '登録失敗通知' });
  await expect(row.locator('[data-field="kind"]')).toHaveText('EO');
  await expect(row.locator('[data-field="complexity"]')).toHaveText('低');
  await expect(row.locator('[data-field="fp"]')).toHaveText('4');
  await expect(row.locator('[data-field="displayNo"]')).toHaveText('TF-007');
  // EO 低 4 FP 増: 993,000 円（ファンクション表で追加した場合と同じ）
  await expect(page.getByTestId('cost-feature')).toHaveText('993,000');
  await page.getByRole('tab', { name: 'DFD' }).click();
  await expect(page.locator(NODE)).toHaveCount(7);
  await shot(page, '11-duplicate-dfd');
  // 参照行は複製できない
  await page.getByRole('tab', { name: 'ファンクション表' }).click();
  await expect(page.getByRole('button', { name: '商品マスタ を複製' })).toBeDisabled();
});

test('機能のプロパティから選択中のノードのプロパティへ戻れる', async ({ page }) => {
  await openSample(page);
  await page.locator('.react-flow__node[data-id="n2"]').click(); // 顧客登録入力
  await expect(page.getByRole('textbox', { name: '名称' })).toHaveValue('顧客登録入力');
  await page.getByRole('button', { name: '機能のプロパティ' }).click();
  await expect(page.getByRole('textbox', { name: '機能名', exact: true })).toHaveValue('顧客登録');
  await shot(page, '12-back-link');
  await page.getByRole('button', { name: '顧客登録入力 のプロパティに戻る' }).click();
  await expect(page.getByRole('textbox', { name: '名称' })).toHaveValue('顧客登録入力');
  // ファンクション表から選んだ場合も同じ
  await page.getByRole('tab', { name: 'ファンクション表' }).click();
  await page.getByRole('gridcell', { name: '顧客検索', exact: true }).click();
  await page.getByRole('button', { name: '機能のプロパティ' }).click();
  await page.getByRole('button', { name: '顧客検索 のプロパティに戻る' }).click();
  await expect(page.getByRole('complementary', { name: 'プロパティ' }).getByRole('textbox', { name: '名称' })).toHaveValue('顧客検索');
});

test('ファンクション表から接続を追加できる（FR-FN-15）', async ({ page }) => {
  await openSample(page);
  await page.getByRole('tab', { name: 'ファンクション表' }).click();
  const tf3 = page.getByRole('row').filter({ hasText: 'TF-003' });
  await expect(tf3.locator('[data-field="placed"]')).toHaveText('接続 3');
  await page.getByRole('button', { name: '顧客検索 の接続を追加' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('「顧客検索」の接続を追加')).toBeVisible();
  await dialog.getByRole('option', { name: '登録完了通知' }).click();
  await dialog.getByLabel('ラベル').fill('照会結果');
  await shot(page, '13-connect-dialog');
  await dialog.getByRole('button', { name: '接続を追加' }).click();
  await expect(tf3.locator('[data-field="placed"]')).toHaveText('接続 4');
  await page.getByRole('tab', { name: 'DFD' }).click();
  await expect(page.locator('.react-flow__edge')).toHaveCount(8);
  await expect(page.getByText('照会結果')).toBeVisible();
  // 1 回の Undo で戻る
  await page.locator('.react-flow__pane').click({ position: { x: 700, y: 600 } });
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.locator('.react-flow__edge')).toHaveCount(7);
});

test('接続ダイアログ: 接続ルール違反の相手は選べず、未配置の要素は自動配置される（FR-FN-15）', async ({ page }) => {
  await openSample(page);
  await page.getByRole('tab', { name: 'ファンクション表' }).click();
  // 利用者（外部エンティティ）からはデータストアを選べない
  await page.getByRole('button', { name: '利用者 の接続を追加' }).click();
  let dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('option', { name: '顧客マスタ' })).toBeDisabled();
  await dialog.getByRole('button', { name: 'キャンセル' }).click();
  // 未配置の TF を追加してから、顧客マスタ → 新しい TF を接続
  await page.getByRole('button', { name: '＋ トランザクション' }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('名称').fill('顧客一覧出力');
  await dialog.getByRole('button', { name: /EO/ }).click();
  await dialog.getByRole('button', { name: '追加して配置' }).click();
  await page.getByRole('button', { name: '顧客一覧出力 の接続を追加' }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: '← この要素へ入力' }).click();
  await dialog.getByRole('option', { name: '顧客マスタ' }).click();
  await dialog.getByRole('button', { name: '接続を追加' }).click();
  const row = page.getByRole('row').filter({ hasText: '顧客一覧出力' });
  await expect(row.locator('[data-field="placed"]')).toHaveText('接続 1');
});

test('プロパティパネルからも接続を追加できる', async ({ page }) => {
  await openSample(page);
  await page.locator('.react-flow__node[data-id="n3"]').click(); // 登録完了通知
  await page.getByRole('button', { name: '＋ 接続を追加' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('option', { name: '顧客マスタ' }).click();
  await dialog.getByRole('button', { name: '接続を追加' }).click();
  await expect(page.locator('.react-flow__edge')).toHaveCount(8);
});

test('ファンクション表に DFD のプレビューを表示し、選択が連動する（FR-FN-16）', async ({ page }) => {
  await openSample(page);
  await page.getByRole('tab', { name: 'ファンクション表' }).click();
  const preview = page.getByTestId('dfd-preview');
  await expect(preview.locator(NODE)).toHaveCount(6);
  await expect(preview.locator('.react-flow__edge')).toHaveCount(7);
  await shot(page, '14-function-preview');
  // プレビューのノードをクリック → 表の行が選択、プロパティに表示
  await preview.locator('.react-flow__node[data-id="n4"]').click(); // 顧客検索
  await expect(page.getByRole('row').filter({ hasText: 'TF-003' })).toHaveClass(/row-selected/);
  await expect(page.getByRole('complementary', { name: 'プロパティ' }).getByRole('textbox', { name: '名称' })).toHaveValue('顧客検索');
  // 表の行をクリック → プレビューのノードが選択
  await page.getByRole('gridcell', { name: '登録完了通知', exact: true }).click();
  await expect(preview.locator('.react-flow__node[data-id="n3"]')).toHaveClass(/selected/);
  // 複製するとプレビューにも増える
  await page.getByRole('button', { name: '登録完了通知 を複製' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('名称')).toBeFocused();
  await page.keyboard.type('登録失敗通知');
  await dialog.getByRole('button', { name: '複製して配置' }).click();
  await expect(preview.locator(NODE)).toHaveCount(7);
  // 隠す・表示（再読み込み後も保持）
  await page.getByRole('button', { name: 'DFD を隠す' }).click();
  await expect(preview).toHaveCount(0);
  await page.getByRole('button', { name: 'DFD を表示' }).click();
  await expect(preview).toBeVisible();
  // ダブルクリックで DFD タブへ
  await preview.locator('.react-flow__node[data-id="n4"]').dblclick();
  await expect(page.getByRole('tab', { name: 'DFD' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.react-flow__node[data-id="n4"]')).toHaveClass(/selected/);
});

test('DFD とプレビューに種別ごとの件数の凡例を表示し、SVG にも出力する（FR-DF-17）', async ({ page }) => {
  await openSample(page);
  const legend = page.getByTestId('dfd-legend');
  await expect(legend.locator('[data-kind="EI"]')).toContainText('1 件');
  await expect(legend.locator('[data-kind="EIF"]')).toContainText('0 件');
  await expect(legend).toContainText('合計 4 件');
  await expect(legend).toContainText('未調整FP 21');
  await expect(legend).toContainText('参照（他機能所有・計上外） 1 件');
  // 凡例とノードが重ならない（全体表示の余白）
  const lb = (await legend.boundingBox())!;
  for (const n of await page.locator(NODE).all()) {
    const b = (await n.boundingBox())!;
    const overlap = b.x < lb.x + lb.width && b.x + b.width > lb.x && b.y < lb.y + lb.height && b.y + b.height > lb.y;
    expect(overlap).toBe(false);
  }
  await shot(page, '15-dfd-legend');
  // ファンクションを追加すると件数が増える
  await page.getByRole('button', { name: 'トランザクションファンクションを追加' }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('名称')).toBeFocused();
  await page.keyboard.type('顧客照会');
  await dialog.getByRole('button', { name: /EQ/ }).click();
  await dialog.getByRole('button', { name: '追加して配置' }).click();
  await expect(legend.locator('[data-kind="EQ"]')).toContainText('2 件');
  await expect(legend).toContainText('合計 5 件');
  // 折りたたみ
  await legend.getByRole('button', { name: '凡例をたたむ' }).click();
  await expect(legend).toContainText('合計 5 件 ・ 未調整FP 24');
  await expect(legend.locator('[data-kind="EI"]')).toHaveCount(0);
  await legend.getByRole('button', { name: '凡例を開く' }).click();
  // プレビュー
  await page.getByRole('tab', { name: 'ファンクション表' }).click();
  await expect(page.getByTestId('preview-legend')).toContainText('計 5');
  // SVG
  await page.getByRole('tab', { name: 'DFD' }).click();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'SVG出力' }).click()]);
  const svg = readFileSync((await dl.path())!, 'utf-8');
  expect(svg).toContain('data-legend');
  expect(svg).toContain('合計 5 件');
  expect(svg).toContain('未調整FP 24');
  if (SHOTS) {
    await page.setContent(`<body style="margin:0;background:#eee">${svg}</body>`);
    await page.locator('svg').first().screenshot({ path: `${SHOTS}/16-svg-legend.png` });
  }
});

test('外部エンティティを入力側と出力側に分け、一方向の流れにできる（FR-DF-18）', async ({ page }) => {
  await openSample(page);
  await page.locator('.react-flow__node[data-id="n1"]').click(); // 利用者
  await page.getByRole('button', { name: '入力側と出力側に分ける' }).click();
  await expect(page.locator(NODE)).toHaveCount(7);
  await expect(page.locator('.react-flow__edge')).toHaveCount(7);
  const users = page.locator(NODE).filter({ hasText: '利用者' });
  await expect(users).toHaveCount(2);
  await expect(users.first().getByLabel('同じ外部エンティティを複数配置')).toBeVisible();
  // 自動整列すると、入力側の利用者が左端、出力側の利用者が右端になる
  await page.getByRole('button', { name: '自動整列' }).click();
  await page.waitForTimeout(400);
  const boxes = await Promise.all((await page.locator(NODE).all()).map(async (n) => ({ id: await n.getAttribute('data-id'), box: (await n.boundingBox())! })));
  const xs = boxes.map((b) => b.box.x);
  const input = boxes.find((b) => b.id === 'n1')!;
  const output = boxes.find((b) => b.id !== 'n1' && b.id !== null && !['n2', 'n3', 'n4', 'n5', 'n6'].includes(b.id))!;
  expect(input.box.x).toBe(Math.min(...xs));
  expect(output.box.x + output.box.width).toBeGreaterThanOrEqual(Math.max(...boxes.map((b) => b.box.x + b.box.width)) - 1);
  await shot(page, '17-ee-split');
  // 表では 1 行のまま、接続数は合計
  await page.getByRole('tab', { name: 'ファンクション表' }).click();
  const row = page.getByRole('row').filter({ hasText: 'EE-001' });
  await expect(row).toHaveCount(1);
  await expect(row.locator('[data-field="placed"]')).toHaveText('接続 3');
  // 凡例・FP は変わらない
  await page.getByRole('tab', { name: 'DFD' }).click();
  await expect(page.getByTestId('dfd-legend')).toContainText('合計 4 件');
  await expect(page.getByTestId('cost-feature')).toHaveText('820,000');
  // SVG にも重複の印
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'SVG出力' }).click()]);
  const svg = readFileSync((await dl.path())!, 'utf-8');
  expect(svg.match(/data-duplicate="true"/g)).toHaveLength(2);
  if (SHOTS) {
    await page.setContent(`<body style="margin:0;background:#eee">${svg}</body>`);
    await page.locator('svg').first().screenshot({ path: `${SHOTS}/18-ee-split-svg.png` });
  }
});

test('既存を参照から外部エンティティをもう 1 つ配置できる（FR-DF-18）', async ({ page }) => {
  await openSample(page);
  await page.getByRole('button', { name: /既存のデータファンクション・外部エンティティを参照配置/ }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('tab', { name: '外部エンティティ' }).click();
  const option = dialog.getByRole('option', { name: /利用者/ });
  await expect(option).toBeEnabled();
  await expect(option).toContainText('配置済み・追加可');
  await option.click();
  await dialog.getByRole('button', { name: '配置', exact: true }).click();
  await expect(page.locator(NODE).filter({ hasText: '利用者' })).toHaveCount(2);
});

test('追加済みのトランザクションファンクションの種別を変更できる（EQ → EO）', async ({ page }) => {
  await openSample(page);
  const kindOf = () => page.evaluate(() => (window as unknown as { __store: { getState: () => { doc: { transactionFunctions: Record<string, { kind: string; complexity: string }> } } } }).__store.getState().doc.transactionFunctions.tf3);
  // ファンクション表: 選んだ時点で確定し、FP と開発単価が変わる
  await page.getByRole('tab', { name: 'ファンクション表' }).click();
  const row = page.getByRole('row').filter({ hasText: '顧客検索' });
  await row.locator('[data-field="kind"]').dblclick();
  await page.getByRole('option', { name: 'EO' }).click();
  await expect(row.locator('[data-field="kind"]')).toHaveText('EO');
  await expect(row.locator('[data-field="fp"]')).toHaveText('4');
  await expect(page.getByTestId('cost-feature')).toHaveText('864,000');
  expect((await kindOf()).kind).toBe('EO');
  // 複雑度も同じく選んだ時点で確定する
  await row.locator('[data-field="complexity"]').dblclick();
  await page.getByRole('option', { name: '中' }).click();
  await expect(row.locator('[data-field="fp"]')).toHaveText('5');
  expect((await kindOf()).complexity).toBe('medium');
  // プロパティパネル（DFD でノードを選択）からも戻せる
  await page.getByRole('tab', { name: 'DFD' }).click();
  await page.locator('.react-flow__node[data-id="n4"]').click();
  await page.getByRole('group', { name: '種別' }).getByRole('button', { name: 'EQ' }).click();
  expect((await kindOf()).kind).toBe('EQ');
  await expect(page.locator('.react-flow__node[data-id="n4"]')).toContainText('EQ');
});

test('既存を参照の一覧は長い名前でも 1 行に収まり、配置済みを表示する', async ({ page }) => {
  await openSample(page);
  await page.evaluate(() => {
    const s = (window as unknown as { __store: { getState: () => { updateDataFunction: (id: string, p: { name: string }) => void; updateExternalEntity: (id: string, p: { name: string }) => void; updateFeature: (id: string, p: { name: string }) => void } } }).__store.getState();
    s.updateDataFunction('df1', { name: '顧客マスタ（法人・個人の契約情報と請求先情報を含む）' });
    s.updateExternalEntity('ee1', { name: '窓口担当者および外部委託オペレータおよび管理者' });
    s.updateFeature('fReg', { name: '顧客情報を新規に登録する機能（法人・個人）' });
  });
  await page.getByRole('button', { name: /既存のデータファンクション・外部エンティティを参照配置/ }).click();
  const dialog = page.getByRole('dialog');
  for (const tab of ['データファンクション', '外部エンティティ']) {
    await dialog.getByRole('tab', { name: tab }).click();
    const option = dialog.getByRole('option').first();
    await expect(option).toContainText('配置済み');
    const box = (await option.boundingBox())!;
    expect(box.height).toBeLessThanOrEqual(37);
    // 名称は省略され、行の右端からはみ出さない
    const overflow = await option.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return [...el.querySelectorAll('span')].some((c) => c.getBoundingClientRect().right > r.right + 0.5);
    });
    expect(overflow).toBe(false);
  }
});

test('ダイアログの一覧は長い名前でも行からはみ出さない（接続・DFD コピー・文言置換）', async ({ page }) => {
  await openSample(page);
  await page.evaluate(() => {
    type S = Record<string, (...a: unknown[]) => void> & { doc: Record<string, Record<string, { name: string }>> };
    const s = (window as unknown as { __store: { getState: () => S } }).__store.getState();
    s.updateDataFunction('df1', { name: '顧客マスタ（法人・個人の契約情報と請求先情報を含む）' });
    s.updateTransactionFunction('tf1', { name: '顧客情報の新規登録画面からの入力受付と顧客情報の検証' });
    s.updateFeature('fSearch', { name: '顧客情報を条件で検索して一覧表示する機能（法人・個人）' });
    for (const k of ['category1s', 'category2s']) for (const id of Object.keys(s.doc[k])) s.renameCategory(id, `${s.doc[k][id].name}（長い分類名称）`);
  });
  // 各行の子要素（と 2 段表示の各段）が行の右端・下端を越えないこと。省略表示の内側は切り取られるので見ない
  const assertFits = async (rows: Locator) => {
    expect(await rows.count()).toBeGreaterThan(0);
    const bad = await rows.evaluateAll((els) =>
      els.filter((el) => {
        const r = el.getBoundingClientRect();
        return [...el.querySelectorAll(':scope > *, :scope > * > div')].some((c) => {
          const b = c.getBoundingClientRect();
          return b.width > 0 && (b.right > r.right + 0.5 || b.bottom > r.bottom + 0.5);
        });
      }).length,
    );
    expect(bad).toBe(0);
  };
  await page.getByRole('tab', { name: 'ファンクション表' }).click();
  await page.getByRole('button', { name: /顧客情報の新規登録.* の接続を追加/ }).click();
  await assertFits(page.getByRole('dialog').getByRole('option'));
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await page.getByRole('button', { name: 'その他の操作（ファンクション表）' }).click();
  await page.getByRole('menuitem', { name: /DFD を別の機能へコピー/ }).click();
  await assertFits(page.getByRole('dialog').getByRole('option'));
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await page.getByRole('button', { name: 'その他の操作（ファンクション表）' }).click();
  await page.getByRole('menuitem', { name: /文言を置換/ }).click();
  await page.getByLabel('検索する文字列').fill('顧客');
  await page.getByLabel('置換後の文字列').fill('取引先担当者');
  const items = page.getByRole('dialog').getByRole('listitem');
  await assertFits(items);
  // 置換後の文言も表示される（長い置換前の文言に押し出されない）
  await expect(items.first()).toContainText(/→\s*取引先担当者マスタ/);
});

test('既存を参照から内容だけコピーして別の ID で複製配置できる（FR-DF-21）', async ({ page }) => {
  await openSample(page);
  type Doc = { dataFunctions: Record<string, { name: string; kind: string; complexity: string; ownerFeatureId: string; displayNo: string }>; transactionFunctions: Record<string, { name: string; kind: string; complexity: string; featureId: string; displayNo: string }> };
  const docOf = () => page.evaluate(() => (window as unknown as { __store: { getState: () => { doc: Doc } } }).__store.getState().doc);
  const open = async () => {
    await page.getByRole('button', { name: /既存のデータファンクション・外部エンティティを参照配置/ }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: '複製して配置（別の ID）' }).click();
    return dialog;
  };
  // 配置済みのデータファンクションも複製なら選べる
  let dialog = await open();
  await dialog.getByRole('option', { name: /商品マスタ/ }).click();
  await shot(page, '21-reference-duplicate');
  await dialog.getByRole('button', { name: '複製…' }).click();
  dialog = page.getByRole('dialog');
  await expect(dialog.getByText('データファンクションを複製')).toBeVisible();
  await expect(dialog.getByLabel('名称')).toHaveValue('商品マスタ（コピー）');
  await page.keyboard.type('在庫マスタ');
  await dialog.getByRole('button', { name: '複製して配置' }).click();
  let doc = await docOf();
  const df = Object.values(doc.dataFunctions).find((d) => d.name === '在庫マスタ')!;
  expect(df).toMatchObject({ kind: 'ILF', complexity: 'low', ownerFeatureId: 'fReg', displayNo: 'DF-003' });
  await expect(page.locator(NODE).filter({ hasText: '在庫マスタ' })).toHaveCount(1);

  // 他の機能のトランザクションファンクションも複製できる（参照のときはタブ自体が出ない）
  dialog = await open();
  await dialog.getByRole('tab', { name: 'トランザクション' }).click();
  await dialog.getByRole('option', { name: /顧客照会/ }).dblclick();
  dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: /EQ/ })).toHaveAttribute('aria-pressed', 'true');
  await dialog.getByRole('button', { name: '複製して配置' }).click();
  doc = await docOf();
  const tf = Object.values(doc.transactionFunctions).find((t) => t.name === '顧客照会（コピー）')!;
  expect(tf).toMatchObject({ kind: 'EQ', featureId: 'fReg' });
  expect(doc.transactionFunctions.tf4.featureId).toBe('fSearch');

  // 参照に戻すとトランザクションのタブは消える
  await page.getByRole('button', { name: /既存のデータファンクション・外部エンティティを参照配置/ }).click();
  await expect(page.getByRole('dialog').getByRole('tab', { name: 'トランザクション' })).toHaveCount(0);
});

test('別 ID で重複して追加した外部エンティティを既存のものへの参照に置き換える（FR-DF-22）', async ({ page }) => {
  await openSample(page);
  type Doc = { externalEntities: Record<string, { name: string; displayNo: string }>; features: Record<string, { dfd: { nodes: { id: string; refId: string }[]; edges: { sourceNodeId: string; label: string }[] } }> };
  const docOf = () => page.evaluate(() => (window as unknown as { __store: { getState: () => { doc: Doc } } }).__store.getState().doc);
  // 誤って「利用者」を別 ID（EE-002）で追加し、データフローもつないでしまった
  const nodeId = await page.evaluate(() => {
    const st = (window as unknown as { __store: { getState: () => Record<string, (...a: unknown[]) => unknown> & { doc: Doc } } }).__store;
    const id = st.getState().addExternalEntity({ featureId: 'fReg', name: '利用者', place: true }) as string;
    const n = st.getState().doc.features.fReg.dfd.nodes.find((x) => x.refId === id)!;
    st.getState().addEdge('fReg', n.id, 'n4', '照会条件');
    return n.id;
  });
  await page.locator(`.react-flow__node[data-id="${nodeId}"]`).click();
  await page.getByRole('button', { name: '既存の要素への参照に置き換え…' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('option')).toHaveCount(1);
  await expect(dialog.getByRole('option').first()).toContainText('同じ名称');
  await dialog.getByRole('option', { name: /EE-001 利用者/ }).click();
  await shot(page, '22-replace-with-reference');
  await dialog.getByRole('button', { name: '置き換え', exact: true }).click();
  await expect(page.getByText('「利用者」を「利用者」への参照に置き換えました（EE-002 は削除）')).toBeVisible();
  const doc = await docOf();
  expect(Object.values(doc.externalEntities).map((e) => e.displayNo)).toEqual(['EE-001']);
  expect(doc.features.fReg.dfd.nodes.find((n) => n.id === nodeId)?.refId).toBe('ee1');
  expect(doc.features.fReg.dfd.edges.some((e) => e.sourceNodeId === nodeId && e.label === '照会条件')).toBe(true);
  // 同じ外部エンティティを複数置いた印が付く
  await expect(page.locator(`.react-flow__node[data-id="${nodeId}"]`)).toContainText('利用者');
  // Undo で元に戻る
  await page.keyboard.press('ControlOrMeta+z');
  expect(Object.keys((await docOf()).externalEntities)).toHaveLength(2);
});

test('DFD で要素をダブルクリックするとプロパティパネルの名称にフォーカスし、そのまま名称を変更できる', async ({ page }) => {
  await openSample(page);
  const name = page.getByRole('textbox', { name: '名称', exact: true });
  await page.locator('.react-flow__node[data-id="n4"]').dblclick();
  await expect(name).toBeFocused();
  await expect(name).toHaveValue('顧客検索');
  // 全選択されているので、入力すると置き換わる
  await page.keyboard.type('顧客照会');
  await page.keyboard.press('Enter');
  await expect(page.locator('.react-flow__node[data-id="n4"]')).toContainText('顧客照会');
  // 別のノードをダブルクリックすると、そのノードの名称へ移る
  await page.locator('.react-flow__node[data-id="n1"]').dblclick();
  await expect(name).toBeFocused();
  await expect(name).toHaveValue('利用者');
  await page.keyboard.press('Escape');
  // ダブルクリックしてもズームしない
  const before = await page.locator('.react-flow__viewport').getAttribute('style');
  await page.locator('.react-flow__node[data-id="n2"]').dblclick();
  await expect(name).toHaveValue('顧客登録入力');
  expect(await page.locator('.react-flow__viewport').getAttribute('style')).toBe(before);
  // データフローはラベルにフォーカスする
  await page.locator('[data-testid="rf__edge-e5"]').dblclick({ force: true });
  await expect(page.getByRole('textbox', { name: 'ラベル' })).toBeFocused();
  await expect(page.getByRole('textbox', { name: 'ラベル' })).toHaveValue('検索条件');
});

test('ファンクション表でドラッグして変えた列幅は、行を選んでも・タブを切り替えても保たれる', async ({ page }) => {
  await openSample(page);
  await page.getByRole('tab', { name: 'ファンクション表' }).click();
  const header = page.locator('[role="columnheader"][data-field="kind"]');
  const widthOf = async () => (await header.boundingBox())!.width;
  const before = await widthOf();
  const sep = header.locator('.MuiDataGrid-columnSeparator');
  const box = (await sep.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2, { steps: 6 });
  await page.mouse.up();
  const resized = await widthOf();
  expect(resized).toBeGreaterThan(before + 40);
  // 別の行をクリックして選択する
  await page.getByRole('row').filter({ hasText: '顧客検索' }).locator('[data-field="displayNo"]').click();
  await page.getByRole('row').filter({ hasText: '登録完了通知' }).locator('[data-field="displayNo"]').click();
  await expect(page.locator('.row-selected')).toContainText('登録完了通知');
  expect(Math.abs((await widthOf()) - resized)).toBeLessThan(2);
  // タブを切り替えて戻っても保たれる
  await page.getByRole('tab', { name: 'DFD' }).click();
  await page.getByRole('tab', { name: 'ファンクション表' }).click();
  expect(Math.abs((await widthOf()) - resized)).toBeLessThan(2);
});

test('ファンクション表で複数選んで、文言を置換しながら一括コピーできる（FR-FN-18）', async ({ page }) => {
  await openSample(page);
  await page.getByRole('tab', { name: 'ファンクション表' }).click();
  for (const t of ['利用者', '顧客登録入力', '顧客マスタ', '登録完了通知']) {
    await page.getByRole('row').filter({ hasText: t }).getByRole('checkbox').first().check();
  }
  await page.getByRole('button', { name: '選択した 4 件をコピー…' }).click();
  const dialog = page.getByRole('dialog');
  await page.getByLabel('置換する文字列').fill('顧客');
  await page.getByLabel('置換後の文字列').fill('取引先');
  const items = dialog.getByRole('listitem');
  await expect(items.filter({ hasText: 'TF-001' })).toContainText(/→\s*取引先登録入力/);
  await expect(items.filter({ hasText: 'TF-002' })).toContainText('同じ名称あり');
  await expect(items.filter({ hasText: 'EE-001' })).toContainText('共有のまま使う');
  await shot(page, '23-copy-functions');
  await dialog.getByRole('button', { name: 'コピー', exact: true }).click();
  await expect(page.getByText('4 件をコピーしました（新しく作成 3 件・データフロー 4 本）')).toBeVisible();
  // コピーした行が表に増え、チェックは外れている
  await expect(page.getByRole('row').filter({ hasText: '取引先登録入力' })).toHaveCount(1);
  await expect(page.getByRole('row').filter({ hasText: '取引先マスタ' })).toHaveCount(1);
  await expect(page.getByRole('row').filter({ hasText: '登録完了通知' })).toHaveCount(2);
  await expect(page.getByRole('button', { name: /選択した .* 件をコピー/ })).toHaveCount(0);
  await expect(page.getByTestId('cost-feature')).not.toHaveText('820,000');
  // 1 回の Undo で戻る
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.getByRole('row').filter({ hasText: '取引先登録入力' })).toHaveCount(0);
  await expect(page.getByTestId('cost-feature')).toHaveText('820,000');

  // 別の機能へのコピー
  await page.getByRole('row').filter({ hasText: '顧客検索' }).getByRole('checkbox').first().check();
  await page.getByRole('button', { name: '選択した 1 件をコピー…' }).click();
  await page.getByRole('combobox', { name: 'コピー先の機能' }).click();
  await page.getByRole('option', { name: /商品登録/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'コピー', exact: true }).click();
  // コピー先の機能に切り替わり、その表に行が増える
  await expect.poll(() => page.evaluate(() => (window as unknown as { __store: { getState: () => { selectedFeatureId: string } } }).__store.getState().selectedFeatureId)).toBe('fItem');
  await expect(page.getByRole('row').filter({ hasText: '顧客検索' })).toHaveCount(1);
  await expect(page.getByRole('row').filter({ hasText: '商品マスタ' })).toHaveCount(1);
});

test('外部と内部の境界を四角で囲み、ノードの移動に追従する（FR-DF-19）', async ({ page }) => {
  await openSample(page);
  await page.locator('.react-flow__node[data-id="n1"]').click(); // 利用者
  await page.getByRole('button', { name: '入力側と出力側に分ける' }).click();
  await page.getByRole('button', { name: '自動整列' }).click();
  await page.waitForTimeout(400);
  const boundary = page.locator('.react-flow__node-boundary');
  await expect(boundary).toHaveCount(1);
  await expect(boundary).toContainText('システム境界: 顧客管理システム');
  const inside = (b: { x: number; y: number; width: number; height: number }, n: { x: number; y: number; width: number; height: number }) =>
    n.x >= b.x && n.y >= b.y && n.x + n.width <= b.x + b.width && n.y + n.height <= b.y + b.height;
  const bb = (await boundary.boundingBox())!;
  for (const id of ['n2', 'n3', 'n4', 'n5', 'n6']) {
    expect(inside(bb, (await page.locator(`.react-flow__node[data-id="${id}"]`).boundingBox())!)).toBe(true);
  }
  for (const ee of await page.locator(NODE).filter({ hasText: '利用者' }).all()) {
    const e = (await ee.boundingBox())!;
    expect(e.x + e.width <= bb.x || e.x >= bb.x + bb.width).toBe(true);
  }
  await shot(page, '19-boundary');
  // 境界は選べず、クリックは背面のキャンバスに通る（選択が解除される）
  await page.locator('.react-flow__node[data-id="n2"]').click();
  // 境界の内側で、ノード・線・凡例のない点（キャンバスの背景が直接見えている点）を探してクリックする
  const free = await page.evaluate((b) => {
    for (let y = b.y + 30; y < b.y + b.height - 4; y += 12) {
      for (let x = b.x + 8; x < b.x + b.width - 4; x += 12) {
        if (document.elementFromPoint(x, y)?.classList.contains('react-flow__pane')) return { x, y };
      }
    }
    return null;
  }, bb);
  expect(free).not.toBeNull();
  // 直前のノードのクリックとダブルクリック扱いにならないよう間を空ける
  await page.waitForTimeout(600);
  await page.mouse.click(free!.x, free!.y);
  await expect(page.getByRole('button', { name: '機能のプロパティ' })).toHaveCount(0);
  // ノードを右へドラッグすると境界も広がる
  const n4 = (await page.locator('.react-flow__node[data-id="n4"]').boundingBox())!;
  await page.mouse.move(n4.x + n4.width / 2, n4.y + n4.height / 2);
  await page.mouse.down();
  await page.mouse.move(n4.x + n4.width / 2, n4.y + n4.height / 2 + 120, { steps: 8 });
  await page.mouse.up();
  const bb2 = (await boundary.boundingBox())!;
  expect(bb2.height).toBeGreaterThan(bb.height + 60);
  // プレビューにも境界
  await page.getByRole('tab', { name: 'ファンクション表' }).click();
  await expect(page.getByTestId('dfd-preview').locator('.react-flow__node-boundary')).toHaveCount(1);
  // SVG にも境界
  await page.getByRole('tab', { name: 'DFD' }).click();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'SVG出力' }).click()]);
  const svg = readFileSync((await dl.path())!, 'utf-8');
  expect(svg).toContain('data-boundary');
  if (SHOTS) {
    await page.setContent(`<body style="margin:0;background:#eee">${svg}</body>`);
    await page.locator('svg').first().screenshot({ path: `${SHOTS}/20-boundary-svg.png` });
  }
});

test('ツリーのメニュー「名前を変更」で各階層の名称を変えられる', async ({ page }) => {
  await openSample(page);
  const rename = async (testId: string, newName: string) => {
    const row = page.getByTestId(testId);
    await row.hover();
    await row.getByRole('button', { name: 'その他の操作' }).click();
    await page.getByRole('menuitem', { name: '名前を変更' }).click();
    const input = page.getByRole('tree').getByRole('textbox', { name: '名称', exact: true });
    await expect(input).toBeFocused();
    await expect(input).toHaveValue(testId.split('-').slice(2).join('-'));
    await page.keyboard.type(newName); // 全選択されているので置き換わる
    await page.keyboard.press('Enter');
    await expect(input).toHaveCount(0);
  };
  await rename('tree-software-顧客管理システム', '顧客システム');
  await rename('tree-category1-顧客管理', '顧客');
  await rename('tree-category2-顧客情報', '顧客基本情報');
  await rename('tree-feature-顧客登録', '顧客新規登録');
  for (const id of ['tree-software-顧客システム', 'tree-category1-顧客', 'tree-category2-顧客基本情報', 'tree-feature-顧客新規登録']) {
    await expect(page.getByTestId(id)).toBeVisible();
  }
  // パンくずと費用サマリーにも反映
  await expect(page.getByText('顧客システム', { exact: true }).first()).toBeVisible();
  // ダブルクリックでも改名でき、Escape で取り消せる
  await page.getByTestId('tree-feature-顧客検索').dblclick();
  const input = page.getByRole('tree').getByRole('textbox', { name: '名称', exact: true });
  await expect(input).toBeFocused();
  await page.keyboard.type('取り消す名前');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('tree-feature-顧客検索')).toBeVisible();
  // 1 回の Undo で直前の改名が戻る
  await page.locator('body').click({ position: { x: 5, y: 890 } });
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.getByTestId('tree-feature-顧客登録')).toBeVisible();
});

test('ツリーをドラッグして分類と機能を並べ替え・移動できる（FR-CT-02）', async ({ page }) => {
  await openSample(page);
  const order = () => page.locator('[role="tree"] .tree-row').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')!.replace(/^tree-/, '')));
  const row = (testId: string) => page.getByTestId(`tree-${testId}`);
  const drag = async (from: string, to: string, where: 'upper' | 'lower' | 'middle') => {
    const box = (await row(to).boundingBox())!;
    const y = where === 'upper' ? 6 : where === 'lower' ? box.height - 6 : box.height / 2;
    await row(from).dragTo(row(to), { targetPosition: { x: 60, y } });
  };
  expect(await order()).toEqual([
    'software-顧客管理システム', 'category1-顧客管理', 'category2-顧客情報', 'feature-顧客登録', 'feature-顧客検索',
    'category1-商品管理', 'category2-商品情報', 'feature-商品登録',
  ]);
  // 同じ中分類の中で並べ替え（上半分に落とすと前）
  await drag('feature-顧客検索', 'feature-顧客登録', 'upper');
  expect((await order()).slice(3, 5)).toEqual(['feature-顧客検索', 'feature-顧客登録']);
  // 機能を別の中分類の行に落とすとその末尾へ
  await drag('feature-顧客登録', 'category2-商品情報', 'middle');
  expect((await order()).slice(-3)).toEqual(['category2-商品情報', 'feature-商品登録', 'feature-顧客登録']);
  // 大分類の並べ替え（下半分に落とすと後ろ）
  await drag('category1-顧客管理', 'category1-商品管理', 'lower');
  expect((await order())[1]).toBe('category1-商品管理');
  // 中分類を別の大分類へ
  await drag('category2-商品情報', 'category1-顧客管理', 'middle');
  expect(await order()).toEqual([
    'software-顧客管理システム', 'category1-商品管理', 'category1-顧客管理', 'category2-顧客情報', 'feature-顧客検索',
    'category2-商品情報', 'feature-商品登録', 'feature-顧客登録',
  ]);
  await shot(page, '21-tree-dnd');
  // 階層をまたぐ移動（機能を大分類の行へ）はしない
  const before = await order();
  await drag('feature-顧客検索', 'category1-商品管理', 'middle');
  expect(await order()).toEqual(before);
  // 1 回の Undo で直前の移動だけ戻る
  await page.locator('body').click({ position: { x: 5, y: 890 } });
  await page.keyboard.press('ControlOrMeta+z');
  expect((await order()).slice(1, 3)).toEqual(['category1-商品管理', 'category2-商品情報']);
  // 一覧タブの並びもツリーに従う
  await page.getByRole('tab', { name: '一覧' }).click();
  const names = await page.locator('table tbody tr td:nth-child(3)').allTextContents();
  expect(names).toEqual(['商品登録', '顧客登録', '顧客検索']);
});

test('メニューから小分類を別の中分類へ、中分類を別の大分類へ移せる（FR-CT-02）', async ({ page }) => {
  await openSample(page);
  const order = () => page.locator('[role="tree"] .tree-row').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')!.replace(/^tree-/, '')));
  const openMoveMenu = async (testId: string, label: string) => {
    const row = page.getByTestId(`tree-${testId}`);
    await row.hover();
    await row.getByRole('button', { name: 'その他の操作' }).click();
    await page.getByRole('menuitem', { name: label }).click();
  };
  // 小分類 → 別の中分類
  await openMoveMenu('feature-顧客検索', '別の中分類へ移動…');
  const dest = page.getByRole('menu', { name: '移動先' });
  await expect(dest.getByRole('menuitem', { name: /顧客管理 \/ 顧客情報/ })).toBeDisabled(); // 現在の場所
  // メニューは対象の行の下に出る
  const rowBox = (await page.getByTestId('tree-feature-顧客検索').boundingBox())!;
  const menuBox = (await dest.boundingBox())!;
  expect(Math.abs(menuBox.y - (rowBox.y + rowBox.height))).toBeLessThan(24);
  await shot(page, '22-move-menu');
  await dest.getByRole('menuitem', { name: '商品管理 / 商品情報' }).click();
  expect((await order()).slice(-2)).toEqual(['feature-商品登録', 'feature-顧客検索']);
  // 中分類 → 別の大分類
  await openMoveMenu('category2-商品情報', '別の大分類へ移動…');
  await page.getByRole('menu', { name: '移動先' }).getByRole('menuitem', { name: '顧客管理', exact: true }).click();
  expect(await order()).toEqual([
    'software-顧客管理システム', 'category1-顧客管理', 'category2-顧客情報', 'feature-顧客登録',
    'category2-商品情報', 'feature-商品登録', 'feature-顧客検索', 'category1-商品管理',
  ]);
  // 大分類にはこの項目がない
  const c1 = page.getByTestId('tree-category1-商品管理');
  await c1.hover();
  await c1.getByRole('button', { name: 'その他の操作' }).click();
  await expect(page.getByRole('menuitem', { name: /移動…/ })).toHaveCount(0);
});

test('左ペインの幅を境界のドラッグで変えられ、再読み込み後も保持される', async ({ page }) => {
  await openSample(page);
  const tree = page.getByRole('complementary', { name: '機能ツリー' });
  const resizer = page.getByTestId('left-pane-resizer');
  const width = async () => Math.round((await tree.boundingBox())!.width);
  expect(await width()).toBe(280);
  const drag = async (dx: number) => {
    const b = (await resizer.boundingBox())!;
    await page.mouse.move(b.x + b.width / 2, b.y + 200);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2 + dx, b.y + 200, { steps: 8 });
    await page.mouse.up();
  };
  await drag(120);
  expect(await width()).toBe(400);
  await shot(page, '23-left-pane-wide');
  // 最小・最大で止まる
  await drag(-400);
  expect(await width()).toBe(220);
  await drag(600);
  expect(await width()).toBe(560);
  // 省略された機能名はマウスを重ねると全文が見える
  await expect(page.getByTestId('tree-feature-顧客登録').locator('span[title="顧客登録"]')).toHaveCount(1);
  // 保存され、再読み込み後も同じ幅（データは自動バックアップ前なので空に戻るが、幅は別に保持される）
  await page.reload();
  await expect(tree).toBeVisible();
  expect(await width()).toBe(560);
  // キーボード（左矢印 16px）とダブルクリック（既定幅）
  await resizer.focus();
  await page.keyboard.press('ArrowLeft');
  expect(await width()).toBe(544);
  await resizer.dblclick();
  expect(await width()).toBe(280);
});

test('DFD を別の機能へコピーし、続けて文言を置換できる（FR-DF-20、FR-FN-17）', async ({ page }) => {
  await openSample(page);
  // ツリーのメニューからコピー
  const row = page.getByTestId('tree-feature-顧客登録');
  await row.hover();
  await row.getByRole('button', { name: 'その他の操作' }).click();
  await page.getByRole('menuitem', { name: 'DFD を別の機能へコピー…' }).click();
  let dialog = page.getByRole('dialog');
  await expect(dialog.getByText('「顧客登録」の DFD を別の機能へコピー')).toBeVisible();
  await dialog.getByRole('option', { name: '顧客検索' }).click();
  await expect(dialog.getByRole('radio', { name: /参照として配置/ })).toBeChecked();
  await shot(page, '24-copy-dfd');
  await dialog.getByRole('button', { name: 'コピー', exact: true }).click();

  // コピー先が選ばれ、コピーしたものだけを対象に置換ダイアログが開く
  dialog = page.getByRole('dialog');
  await expect(dialog.getByText('文言を置換（顧客検索）')).toBeVisible();
  await expect(dialog.getByText('DFD のコピーで追加したファンクションとデータフローだけが対象です。')).toBeVisible();
  await page.keyboard.type('登録');
  await dialog.getByLabel('置換後の文字列').fill('変更');
  const items = dialog.getByRole('listitem');
  // 名称 2 件（顧客登録入力・登録完了通知）、ラベル 2 件（登録情報・登録結果）
  await expect(items).toHaveCount(4);
  await shot(page, '25-replace-dialog');
  // ラベル「登録結果」は置換しない
  await dialog.getByRole('checkbox', { name: '登録結果 を置換する' }).uncheck();
  await dialog.getByRole('button', { name: '3 件を置換' }).click();

  // 結果: コピー先の名前が変わり、コピー元は変わらない
  await expect(page.getByRole('tree').getByTestId('tree-feature-顧客検索')).toBeVisible();
  const grid = page.getByRole('grid');
  await expect(grid.getByRole('gridcell', { name: '顧客変更入力', exact: true })).toBeVisible();
  await expect(grid.getByRole('gridcell', { name: '変更完了通知', exact: true })).toBeVisible();
  // DF は参照としてコピー（顧客マスタは「参照」行）
  await expect(page.getByRole('row').filter({ hasText: 'DF-001' })).toContainText('参照');
  await page.getByRole('tab', { name: 'DFD' }).click();
  await expect(page.locator(NODE)).toHaveCount(6);
  await expect(page.getByText('変更情報')).toBeVisible();
  await expect(page.getByText('登録結果')).toBeVisible();
  // 凡例: 元の EQ 2 件 + コピーの EI・EO・EQ（顧客検索）
  await expect(page.getByTestId('dfd-legend')).toContainText('合計 5 件');
  // コピー元は変わらない
  await page.getByTestId('tree-feature-顧客登録').click();
  await page.getByRole('tab', { name: 'ファンクション表' }).click();
  await expect(page.getByRole('grid').getByRole('gridcell', { name: '顧客登録入力', exact: true })).toBeVisible();

  // ファンクション表のメニューから、この機能すべてを対象に置換
  await page.getByRole('button', { name: 'その他の操作（ファンクション表）' }).click();
  await page.getByRole('menuitem', { name: '文言を置換…' }).click();
  dialog = page.getByRole('dialog');
  await expect(dialog.getByText('DFD のコピーで追加した')).toHaveCount(0);
  await dialog.getByLabel('検索する文字列').fill('利用者');
  await expect(dialog.getByText('0 件が見つかりました。')).toBeVisible(); // 外部エンティティは対象外
  await dialog.getByRole('button', { name: '閉じる' }).click();
});

test('一覧タブで長い大分類・中分類・小分類の名前はセル内で省略される', async ({ page }) => {
  await openSample(page);
  const long = { c1: '顧客管理業務全般にかかわる大分類', c2: '顧客情報の登録と照会に関する中分類', f: '顧客情報を新規に登録する長い名前の小分類' };
  await page.evaluate((n) => {
    const s = (window as unknown as { __store: { getState: () => { renameCategory: (id: string, v: string) => void; updateFeature: (id: string, p: { name: string }) => void } } }).__store.getState();
    s.renameCategory('c1a', n.c1);
    s.renameCategory('c2a', n.c2);
    s.updateFeature('fReg', { name: n.f });
  }, long);
  await page.getByRole('tab', { name: '一覧' }).click();
  const cells = page.locator('table tbody tr').first().locator('td');
  const widths = [90, 90, 110];
  let prevRight = -Infinity;
  for (let i = 0; i < 3; i++) {
    const info = await cells.nth(i).evaluate((td) => {
      const box = td.getBoundingClientRect();
      const el = (td.querySelector('button') ?? td) as HTMLElement;
      const cs = getComputedStyle(el);
      return {
        left: box.left, right: box.right, width: box.width,
        clipped: cs.overflow === 'hidden' && cs.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth,
        title: el.getAttribute('title') ?? td.getAttribute('title'),
      };
    });
    expect(Math.round(info.width)).toBe(widths[i]);
    expect(info.clipped).toBe(true);
    expect(info.left).toBeGreaterThanOrEqual(prevRight - 1);
    prevRight = info.right;
    expect(info.title).toBe([long.c1, long.c2, long.f][i]);
  }
  await shot(page, '26-summary-long-names');
});
