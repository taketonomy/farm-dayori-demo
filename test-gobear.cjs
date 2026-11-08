// Go Bear to Farm!（go-bear.html）の確認用テスト。2026-11-08 Claude Code で追加。
// 実行: node test-gobear.cjs  （CHROMIUM_PATH で既存の Chromium を指定可）
const {chromium} = require('playwright');
const fs = require('fs');
const assert = require('assert');

const HTML = fs.readFileSync(__dirname + '/go-bear.html', 'utf8');

(async () => {
  const browser = await chromium.launch({
    ...(process.env.CHROMIUM_PATH ? {executablePath: process.env.CHROMIUM_PATH} : {}),
    headless: true, args: ['--no-sandbox'],
  });
  const results = [];
  const errors = [];
  const requests = [];

  async function fresh(viewport = {width: 1200, height: 1000}) {
    const page = await browser.newPage({viewport});
    page.on('pageerror', e => errors.push(e.message));
    page.on('request', r => { if (/^https?:/.test(r.url())) requests.push(r.url()); });
    await page.setContent(HTML);
    return page;
  }
  async function test(name, fn) {
    try { await fn(); results.push({name, status: 'PASS'}); }
    catch (e) { results.push({name, status: 'FAIL', error: e.message}); }
  }
  // 区間カードの数値を読む
  async function seg(page, key) {
    const card = page.locator(`[data-seg="${key}"]`);
    assert.equal(await card.count(), 1, `区間 ${key} が1枚だけ表示される`);
    return {
      want: Number(await card.locator('[data-want]').getAttribute('data-want')),
      seats: Number(await card.locator('[data-seats]').getAttribute('data-seats')),
      verdict: (await card.locator('[data-verdict]').innerText()).trim(),
      ride: (await card.locator('[data-ride-line]').innerText()).trim(),
      accept: (await card.locator('[data-accept-line]').innerText()).trim(),
      card,
    };
  }
  const K = {
    outKomorebi: 'd1|out|里山駅|f1|a',
    outKomorebiLate: 'd1|out|里山駅|f1|b',
    outMizube: 'd1|out|川辺バス停|f2|a',
    retKomorebi: 'd1|ret|里山駅|f1|c',
    retMizube: 'd1|ret|川辺バス停|f2|c',
  };

  await test('架空データの明記と、個人情報の入力欄がない', async () => {
    const page = await fresh();
    assert((await page.locator('#fictionNotice').innerText()).includes('すべて架空のデータです'));
    assert.equal(await page.locator('input, textarea').count(), 0);
    await page.close();
  });

  await test('同一活動日の4区間（調整前）が指定どおりの需給になる', async () => {
    const page = await fresh();
    let s = await seg(page, K.outKomorebi);
    assert.deepEqual([s.want, s.seats, s.verdict], [5, 3, '2席不足']);
    s = await seg(page, K.outMizube);
    assert.deepEqual([s.want, s.seats, s.verdict], [2, 4, '2席余裕']);
    s = await seg(page, K.retKomorebi);
    assert.deepEqual([s.want, s.seats, s.verdict], [4, 1, '3席不足']);
    s = await seg(page, K.retMizube);
    assert.deepEqual([s.want, s.seats, s.verdict], [2, 2, '数量上は一致・未合意']);
    assert(!s.verdict.includes('成立'));
    await page.close();
  });

  await test('提供席数は運転者と既存の同乗者を除いた空席', async () => {
    const page = await fresh();
    await page.locator(`[data-seg="${K.outKomorebi}"] details summary`).click();
    const calc = await page.locator('[data-seat-calc="o01"]').innerText();
    assert(calc.includes('定員5 − 運転者1 − 既存の同乗者1 ＝ 空席3'), calc);
    await page.close();
  });

  await test('別の時間帯の余裕席で不足を相殺しない', async () => {
    const page = await fresh();
    const a = await seg(page, K.outKomorebi);
    const b = await seg(page, K.outKomorebiLate);
    assert.equal(a.verdict, '2席不足');
    assert.equal(b.verdict, '2席余裕');
    const summary = await page.locator('#rideSummary').innerText();
    assert(summary.includes('相殺した合計は出しません'));
    await page.close();
  });

  await test('同じ人・同じ車を複数区間で重複計上しない', async () => {
    const page = await fresh();
    // P-03 は 9:00 と 9:30 の両方に申告 → 後の 9:30 側は数えない
    const late = await seg(page, K.outKomorebiLate);
    assert.equal(late.want, 0);
    await late.card.locator('details summary').click();
    assert.equal(await late.card.locator('[data-rider="r06"] [data-dup="rider"]').count(), 1);
    // D-02 は復路で みずべ と こもれび の両方に申告 → 後の こもれび 側は席に数えない
    const ret = await seg(page, K.retKomorebi);
    assert.equal(ret.seats, 1);
    await ret.card.locator('details summary').click();
    assert.equal(await ret.card.locator('[data-offer="o06"] [data-dup="offer"]').count(), 1);
    await page.close();
  });

  await test('往路と復路は別々に表示・切り替えできる', async () => {
    const page = await fresh();
    assert.equal(await page.locator('#segOut [data-leg="ret"]').count(), 0);
    assert.equal(await page.locator('#segRet [data-leg="out"]').count(), 0);
    await page.selectOption('#legSelect', 'ret');
    assert.equal(await page.locator('#legOut').isVisible(), false);
    assert.equal(await page.locator('#legRet').isVisible(), true);
    await page.selectOption('#legSelect', 'out');
    assert.equal(await page.locator('#legOut').isVisible(), true);
    assert.equal(await page.locator('#legRet').isVisible(), false);
    await page.close();
  });

  await test('関係図の線を選ぶと詳細が出て、その農園の需給に絞り込まれる', async () => {
    const page = await fresh();
    await page.click('g.edge[data-edge="e3"]');
    const detail = await page.locator('#detail').innerText();
    for (const t of ['週末はたけ部', 'みずべ農園', '活動内容', '直近の交流', '次に相談したいこと', '復路の相乗りの集合場所'])
      assert(detail.includes(t), `詳細に「${t}」`);
    assert(detail.includes('こもれび農園・ひだまり畑との関係を意味しません'));
    const farms = await page.locator('[data-seg]').evaluateAll(els => [...new Set(els.map(e => e.dataset.farm))]);
    assert.deepEqual(farms, ['f2']);
    assert.equal(await page.inputValue('#farmSelect'), 'f2');
    // 解除で全農園に戻る
    await page.getByRole('button', {name: '選択と絞り込みを解除'}).click();
    assert.equal(await page.locator('[data-seg]').count(), 5);
    await page.close();
  });

  await test('線は色だけでなくラベルと線種で状態を区別する', async () => {
    const page = await fresh();
    const dash = s => page.locator(`g.edge[data-status="${s}"] .edge-line`).first().getAttribute('stroke-dasharray');
    assert.equal(await dash('done'), null);
    assert.equal(await dash('talk'), '9 5');
    assert.equal(await dash('intro'), '2 5');
    const labels = await page.locator('.edge-label text').evaluateAll(els => els.map(e => e.textContent));
    for (const l of ['活動実績あり', '初回を相談中', '紹介あり・未訪問']) assert(labels.includes(l));
    await page.close();
  });

  await test('線のない農園を選ぶと「受け入れ不可ではない」と表示', async () => {
    const page = await fresh();
    await page.click('g.farm-node[data-farm="f5"]');
    assert((await page.locator('#noRelNote').innerText()).includes('「受け入れ不可」を意味しません'));
    assert.equal(await page.locator('[data-seg]').count(), 0);
    await page.close();
  });

  await test('活動日の切替で需給と受け入れが連動する', async () => {
    const page = await fresh();
    await page.selectOption('#daySelect', 'd2');
    assert.equal(await page.locator('[data-seg^="d1|"]').count(), 0);
    const s = await seg(page, 'd2|out|里山駅|f3|b');
    assert.deepEqual([s.want, s.seats], [3, 3]);
    assert(s.verdict.includes('数量上は一致・未合意'));
    assert(s.ride.includes('1人'));
    // 見送りの人は数えない
    const r = await seg(page, 'd2|ret|川辺バス停|f2|c');
    assert.deepEqual([r.want, r.seats, r.verdict], [0, 1, '1席余裕']);
    assert.equal(await page.locator('[data-accept-farm="f3"]').count(), 1);
    assert.equal(await page.locator('[data-accept-farm="f1"]').count(), 0);
    await page.close();
  });

  await test('移動合意は一人ずつ記録し、空席を超えて合意できない', async () => {
    const page = await fresh();
    const card = page.locator(`[data-seg="${K.retMizube}"]`);
    await card.locator('details summary').click();
    await card.locator('[data-rider="r13"] [data-agree-offer="o05"]').click();
    let s = await seg(page, K.retMizube);
    assert.equal(s.verdict, '数量上は一致・未合意');
    assert(s.ride.includes('1人 ／ 乗りたい 2人'));
    await card.locator('[data-rider="r14"] [data-agree-offer="o05"]').click();
    s = await seg(page, K.retMizube);
    assert.equal(s.verdict, '数量は一致・全員の移動合意を記録済み');
    // こもれび往路：空席3に対して4人目は合意できない
    const k = page.locator(`[data-seg="${K.outKomorebi}"]`);
    await k.locator('details summary').click();
    for (const id of ['r01', 'r02', 'r03']) await k.locator(`[data-rider="${id}"] [data-agree-offer="o01"]`).click();
    assert.equal(await k.locator('[data-rider="r04"] [data-agree-offer="o01"]').isDisabled(), true);
    const t = await seg(page, K.outKomorebi);
    assert.equal(t.verdict, '2席不足');
    await page.close();
  });

  await test('参加者・運転者の延期／見送りは数から外れ、運転者の見送りで合意は相談中に戻る', async () => {
    const page = await fresh();
    const card = page.locator(`[data-seg="${K.outKomorebi}"]`);
    await card.locator('details summary').click();
    await card.locator('[data-rider="r05"]').getByRole('button', {name: '見送り'}).click();
    await card.locator('[data-rider="r04"]').getByRole('button', {name: '延期'}).click();
    let s = await seg(page, K.outKomorebi);
    assert.deepEqual([s.want, s.seats, s.verdict], [3, 3, '数量上は一致・未合意']);
    await card.locator('[data-rider="r01"] [data-agree-offer="o01"]').click();
    await card.locator('[data-offer="o01"]').getByRole('button', {name: '見送り'}).click();
    s = await seg(page, K.outKomorebi);
    assert.deepEqual([s.want, s.seats, s.verdict], [3, 0, '3席不足']);
    assert.equal(await card.locator('[data-rider="r01"] [data-rider-status]').innerText(), '相談中');
    await page.close();
  });

  await test('農園の受け入れ合意と移動合意は別々に表示され、互いに自動では変わらない', async () => {
    const page = await fresh();
    await page.click('[data-producer-farm="f1"][data-choice="延期"]');
    assert.equal(await page.locator('[data-producer-state="f1"]').innerText(), '延期');
    let s = await seg(page, K.outKomorebi);
    assert(s.accept.includes('生産者「延期」'));
    assert(s.ride.includes('0人 ／ 乗りたい 5人'));
    assert.equal(s.want, 5);
    await page.click('[data-participant-farm="f1"][data-participant-group="s1"][data-choice="見送り"]');
    assert.equal(await page.locator('[data-participant-farm="f1"][data-participant-group="s1"][data-choice="見送り"]').getAttribute('aria-pressed'), 'true');
    s = await seg(page, K.outKomorebi);
    assert.equal(s.want, 5);
    await page.close();
  });

  await test('スマートフォン幅で横スクロールが出ない', async () => {
    const page = await fresh({width: 375, height: 800});
    const [sw, iw] = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
    assert(sw <= iw, `scrollWidth ${sw} > ${iw}`);
    await page.close();
  });

  await test('ページエラーと外部通信がない', async () => {
    assert.deepEqual(errors, []);
    assert.deepEqual(requests, []);
  });

  await browser.close();
  console.log(results);
  if (results.some(r => r.status !== 'PASS')) process.exit(1);
})();
