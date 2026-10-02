# Central API v2.45 - canonical image URL

## Purpose
画像マスタに保存されるTOP画像URLをHTTP(S)絶対URLへ統一します。

## Changes
- `normalizeTenichiImageUrl_()` を追加。
- `/images/...` を `https://ten.1049.cc/images/...` へ正規化。
- 既存のHTTP(S)絶対URLは維持。
- 画像URL再取得結果、managed image編集値、Viewer読出し値を正規化。
- image master incoming signatureをv2へ更新。
- 既存画像マスタの相対URLは次回同期時に自動修復。

## Compatibility
- schemaVersion 3.0据え置き。
- Pages protocol据え置き。
- viewerToken / 共有設定 / Fast Handoff等の既存仕様変更なし。
