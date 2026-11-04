# FP DFD Editor

ファンクションポイント法（FP 法）による見積もりのために、データフローダイアグラム（DFD）を描きながらファンクションを数え、工数と費用を計算するブラウザアプリです。サーバーは不要で、データはブラウザ内と手元のファイルにだけ保存されます。

## 使い方

```sh
npm install
npm run dev        # http://localhost:5173 で起動
```

初回はデータが空です。左のツリーの「サンプルを開く」で、要件定義書の計算例を再現したサンプルを読み込めます。

ツールバーの「Copilot 連携」から、機能の DFD を Microsoft Copilot のエージェントに渡して作成・見直しを手伝ってもらい、その返答を取り込めます。手順とエージェントに与える指示は [doc/copilot-agent.md](doc/copilot-agent.md) を参照してください。

配布用には次を実行します。`dist/index.html` 1 ファイルにすべてが入っており、ダブルクリックでブラウザから直接開けます。任意の静的ホスティングにも置けます。

```sh
npm run build
npm run preview    # ビルド結果の確認
```

## 開発

```sh
npm test               # 単体テスト（Vitest）
npx playwright test    # E2E テスト（インストール済みの Chrome を使用）
npm run lint
npm run typecheck
```

## ドキュメント

- [doc/concept.md](doc/concept.md) 原案
- [doc/requirements.md](doc/requirements.md) 要件定義書
- [doc/design.md](doc/design.md) 設計書
- [doc/ui-design.md](doc/ui-design.md) UI デザイン書（モック: [doc/ui/mock/index.html](doc/ui/mock/index.html)）
- [doc/copilot-agent.md](doc/copilot-agent.md) Copilot エージェントとの連携手順とエージェントに与える指示
