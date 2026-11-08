// 公開前チェック：git で管理しているファイル（公開されるファイル）に、
// names.local.json の「差し替え後の名称」が含まれていないことを確かめる。
// 名称はこのファイルに書かず、git 管理外の対応表から読む。
// 使い方: node scripts/check-public.cjs
const fs = require('fs');
const path = require('path');
const {execSync} = require('child_process');

const root = path.join(__dirname, '..');
const mapFile = path.join(root, 'names.local.json');
if (!fs.existsSync(mapFile)) { console.log('names.local.json がないため、チェックを省略しました'); process.exit(0); }
const names = Object.values(JSON.parse(fs.readFileSync(mapFile, 'utf8')));
const files = execSync('git ls-files', {cwd: root, encoding: 'utf8'}).split('\n').filter(f => f && !/\.(pdf|png|jpg|mp4)$/i.test(f));
const staged = execSync('git diff --cached --name-only', {cwd: root, encoding: 'utf8'}).split('\n').filter(Boolean);
let hits = 0;
for (const f of new Set([...files, ...staged])) {
  const p = path.join(root, f);
  if (!fs.existsSync(p)) continue;
  const text = fs.readFileSync(p, 'utf8');
  for (const n of names) if (text.includes(n)) { console.error(`公開ファイルに差し替え後の名称があります: ${f}`); hits++; }
}
if (hits) process.exit(1);
console.log(`OK：公開ファイル ${files.length} 件に、差し替え後の名称は含まれていません`);
