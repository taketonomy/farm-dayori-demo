// 開発用：名称の対応表（names.local.json）を使って、go-bear.html から
// 名称を差し替えた go-bear.local.html を作る。どちらのファイルも .gitignore 済みで、
// リポジトリ・公開物には含めない。公開版（go-bear.html）は架空の名称のまま。
// 使い方: node scripts/make-local.cjs
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const mapFile = path.join(root, 'names.local.json');
if (!fs.existsSync(mapFile)) {
  console.error('names.local.json がありません。{"架空の名称": "差し替える名称", ...} の形で作ってください。');
  process.exit(1);
}
const map = JSON.parse(fs.readFileSync(mapFile, 'utf8'));
let html = fs.readFileSync(path.join(root, 'go-bear.html'), 'utf8');

// 長い名称から先に置き換える（部分一致の取り違えを防ぐ）
for (const [from, to] of Object.entries(map).sort((a, b) => b[0].length - a[0].length)) {
  const n = html.split(from).length - 1;
  if (!n) console.warn(`見つからない名称: ${from}`);
  html = html.split(from).join(to);
}

const banner = '<p class="warn" id="localBanner"><strong>開発用・非公開</strong>：名称だけを差し替えた版です。活動内容・交流の記録・人数・位置はすべて架空の例で、実際の農園の事実ではありません。公開・共有しないでください。</p>';
html = html.replace('<main>', '<main>\n  ' + banner);
html = html.replace('<title>Go Bear to Farm!</title>', '<title>Go Bear to Farm!（開発用・非公開）</title>');
fs.writeFileSync(path.join(root, 'go-bear.local.html'), html);
console.log('go-bear.local.html を作成しました（git 管理外）');
