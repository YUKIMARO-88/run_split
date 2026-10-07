# Run Split（1kmラップ計測 PWA）

屋外ランで GPS から走行距離を測り、1km（または 500/400/200m）ごとのラップタイムを自動記録する iPhone 向け Web アプリ。HYROX の 1km 走ペース確認用。

## iPhone で使う（本番）
iPhone の Safari は **https のページでしか GPS を使わせない**。PC の start.bat（http）では iPhone から GPS が動かないので、GitHub Pages で公開して使う。

1. GitHub に `run_split` リポジトリを作り、このフォルダを push（ppt_math と同じ手順）
2. Settings → Pages → Branch: main / root → Save
3. 数分後 `https://yukimaro-88.github.io/run_split/` を iPhone の Safari で開く
4. 共有ボタン →「ホーム画面に追加」→ アプリとして起動できる
5. 初回に位置情報を「許可」。設定 → プライバシーとセキュリティ → 位置情報サービス で「正確な位置情報」をオン

一度開けばオフラインでも起動する（sw.js でキャッシュ）。

## 使い方のコツ（精度）
- 走る前に左上の GPS 表示が **緑（±10m 以内）** になるまで待つ
- **計測中は画面を消さない**（iPhone は Web アプリの GPS を画面ロック中に止める）。画面は自動で点いたままになる（iOS 16.4 以降）
- 終了は誤操作防止のため「長押し」
- 精度の目安（シミュレーター）：距離 ±1% 前後、1km ラップ ±3 秒前後。初回は 400m トラックで実距離と比べて確認するとよい

## PC での確認
`start.bat` → http://localhost:8520/?sim=1&speed=20 （疑似GPSで 20 倍速走行）
パラメータ: `km=3`（距離）`pace=270`（秒/km）`speed=20`（倍速）

## ファイル
- `tracker.js` 距離計算コア（精度フィルタ・ジャンプ除去・カルマン平滑化・12mアンカー・ラップ境界の時刻補間）
- `sim.js` 疑似 GPS トラック（400m トラック周回＋ノイズ）
- `tools/test_tracker.js` 精度テスト（`node tools/test_tracker.js`）、`tools/grid.js` パラメータ探索
- `sw.js` の VERSION は更新時に上げる
