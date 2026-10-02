# Cloudflare Worker: tenichi-image-proxy

画像URLを求人ページから解決するWorkerです。

## v2 変更点

- `json-ld:image` が `/images/...` の相対URLでも `https://ten.1049.cc/images/...` に絶対URL化して返します。
- `picture:source-srcset` / `img:data-src` も同じ正規化を通します。
- `srcset` は先頭候補URLを利用します。
- 旧Workerが6時間キャッシュしている相対URLを避けるため、内部cache keyを `v=2` に変更しています。
- クライアントから呼ぶURLは従来どおり `?jobId=...` のままです。

## 反映

既存のCloudflare Workerコードを `worker.js` の内容で置き換えてデプロイしてください。
Pages / Central API側のWorker URL自体は変更不要です。
