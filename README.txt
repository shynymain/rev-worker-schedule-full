Rev schedule Worker full generated版

中身:
- worker.js 直下配置
- wrangler.toml 直下配置

Cloudflare Workers GitHub連携:
1. このZIPを解凍
2. GitHubに worker.js と wrangler.toml を直下でcommit
3. Cloudflare Workers > Create > Import repository
4. Deploy
5. /api/schedule を開いて { ok:true, count:72, races:[...] } が出ればOK

注意:
これは「本物データ風」の全レース生成版です。
JRA公式データを直接取得するものではありません。
