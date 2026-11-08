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

  async function fresh(viewport = {width: 1200, height: 1000}, opts = {}) {
    const page = await browser.newPage({viewport});
    page.on('pageerror', e => errors.push(e.message));
    page.on('request', r => { if (/^https?:/.test(r.url())) requests.push(r.url()); });
    await page.setContent(HTML);
    // 調整のための詳細は初期状態で閉じている。詳細を確かめるテストでは開いておく
    if (opts.openDetails !== false) await page.evaluate(() => { document.getElementById('coordDetails').open = true; });
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
    outMizube: 'd1|out|里山駅|f2|a',
    retKomorebi: 'd1|ret|里山駅|f1|c',
    retMizube: 'd1|ret|里山駅|f2|c',
  };

  await test('架空データの明記と、個人情報の入力欄がない', async () => {
    const page = await fresh();
    assert((await page.locator('#fictionNotice').innerText()).includes('すべて架空のデータです'));
    // 援農者の画面には入力欄がない。生産者の入力欄も作業・人数だけで、氏名・電話・住所・メールは集めない
    assert.equal(await page.locator('#journey input, #journey textarea').count(), 0);
    await page.selectOption('#roleSelect', 'producer');
    assert.deepEqual(await page.locator('input, textarea').evaluateAll(els => els.map(e => e.id)), ['recruitWork', 'recruitCount']);
    assert.equal(await page.locator('input[type="tel"], input[type="email"], input[autocomplete="name"], input[autocomplete="street-address"]').count(), 0);
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
    assert(summary.includes('区間どうしで相殺しません'));
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
    await page.click('.edge-label[data-edge="e3"]');
    const detail = await page.locator('#detail').innerText();
    for (const t of ['週末はたけ部', 'みずべ農園', '活動内容', '直近の交流', '次に相談したいこと', '復路の相乗りの集合場所'])
      assert(detail.includes(t), `詳細に「${t}」`);
    assert(detail.includes('こもれび農園・そよかぜ畑との関係ではありません'));
    const farms = await page.locator('[data-seg]').evaluateAll(els => [...new Set(els.map(e => e.dataset.farm))]);
    assert.deepEqual(farms, ['f2']);
    assert.equal(await page.inputValue('#farmSelect'), 'f2');
    // 解除で全農園に戻る
    await page.getByRole('button', {name: '選択と絞り込みを解除'}).click();
    assert.equal(await page.locator('[data-seg]').count(), 6);
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
    const s = await seg(page, 'd2|out|里山駅|f1|b');
    assert.deepEqual([s.want, s.seats], [3, 3]);
    assert(s.verdict.includes('数量上は一致・未合意'));
    assert(s.ride.includes('1人'));
    // 見送りの人は数えない
    const r = await seg(page, 'd2|ret|里山駅|f2|c');
    assert.deepEqual([r.want, r.seats, r.verdict], [0, 1, '1席余裕']);
    assert.equal(await page.locator('[data-accept-farm="f1"]').count(), 1);
    assert.equal(await page.locator('[data-accept-farm="f5"]').count(), 0);
    await page.close();
  });

  await test('援農者 P-01 は自分の申し込みだけを操作でき、移動の合意は一人ずつ記録される', async () => {
    const page = await fresh();
    const card = page.locator(`[data-seg="${K.outKomorebi}"]`);
    assert.equal(await card.locator('[data-mine-seg]').count(), 1);
    await card.locator('details summary').click();
    // 自分（r01 = P-01）だけにボタン。ほかの参加者と運転者は表示だけ
    assert((await card.locator('[data-rider="r01"] button').count()) > 0);
    for (const id of ['r02', 'r03', 'r04', 'r05']) assert.equal(await card.locator(`[data-rider="${id}"] button`).count(), 0, id);
    assert.equal(await card.locator('[data-offer] button').count(), 0);
    await card.locator('[data-rider="r01"] [data-agree-offer="o01"]').click();
    let s = await seg(page, K.outKomorebi);
    assert(s.ride.includes('1人 ／ 乗りたい 5人'));
    assert.equal(s.verdict, '2席不足');
    assert((await card.locator('[data-rider="r01"] [data-rider-status]').innerText()).includes('移動合意を記録（P-01 側の記録・D-01 の車）'));
    await card.locator('[data-rider="r01"]').getByRole('button', {name: '合意を取り消して相談中へ'}).click();
    assert.equal(await card.locator('[data-rider="r01"] [data-rider-status]').innerText(), '相談中');
    // 自分の申し込みがない便は表示だけ。数が一致していても未合意のまま
    const m = page.locator(`[data-seg="${K.retMizube}"]`);
    assert.equal(await m.locator('[data-mine-seg]').count(), 0);
    await m.locator('details summary').click();
    assert.equal(await m.locator('[data-rider] button, [data-offer] button').count(), 0);
    assert.equal((await seg(page, K.retMizube)).verdict, '数量上は一致・未合意');
    await page.close();
  });

  await test('P-01 の延期／見送りはその区間の人数から外れ、戻せる', async () => {
    const page = await fresh();
    const card = page.locator(`[data-seg="${K.outKomorebi}"]`);
    await card.locator('details summary').click();
    await card.locator('[data-rider="r01"]').getByRole('button', {name: '見送り'}).click();
    let s = await seg(page, K.outKomorebi);
    assert.deepEqual([s.want, s.seats, s.verdict], [4, 3, '1席不足']);
    await card.locator('[data-rider="r01"]').getByRole('button', {name: '希望に戻す'}).click();
    s = await seg(page, K.outKomorebi);
    assert.deepEqual([s.want, s.verdict], [5, '2席不足']);
    // 復路は別に数える
    const r = page.locator(`[data-seg="${K.retKomorebi}"]`);
    await r.locator('details summary').click();
    await r.locator('[data-rider="r09"]').getByRole('button', {name: '延期'}).click();
    const rs = await seg(page, K.retKomorebi);
    assert.deepEqual([rs.want, rs.seats, rs.verdict], [3, 1, '2席不足']);
    assert.equal((await seg(page, K.outKomorebi)).want, 5);
    await page.close();
  });

  await test('農園の受け入れ合意と移動合意は別々に表示され、互いに自動では変わらない', async () => {
    const page = await fresh();
    await page.selectOption('#roleSelect', 'producer');
    await page.click('[data-producer-farm="f1"][data-choice="延期"]');
    assert.equal(await page.locator('[data-producer-state="f1"]').innerText(), '延期');
    let s = await seg(page, K.outKomorebi);
    assert(s.accept.includes('生産者「延期」'));
    assert(s.ride.includes('0人 ／ 乗りたい 5人'));
    assert.equal(s.want, 5);
    await page.selectOption('#roleSelect', 'helper');
    assert.equal(await page.locator('[data-producer-state="f1"]').innerText(), '延期');
    // 援農者は個人の参加を選ぶ（グループの選択は詳細で表示だけ）
    assert.equal(await page.locator('[data-participant-farm]').count(), 0);
    await page.locator('[data-journey-choice="相談したい"]').click();
    assert.equal(await page.locator('[data-journey-state="f1"]').innerText(), '相談したい');
    s = await seg(page, K.outKomorebi);
    assert.equal(s.want, 5);
    await page.close();
  });

  await test('視点の切替：援農者 P-01 は自分の参加・相乗りを、生産者は受け入れだけを操作できる', async () => {
    const page = await fresh();
    // 初期は援農者 P-01 の視点
    assert.equal(await page.inputValue('#roleSelect'), 'helper');
    assert((await page.locator('#roleSelect option:checked').innerText()).includes('P-01'));
    assert.equal(await page.locator('[data-producer-farm]').count(), 0);
    assert.equal(await page.locator('[data-participant-farm]').count(), 0);
    assert((await page.locator('[data-journey-choice]').count()) > 0);
    assert.equal(await page.locator('[data-my-group="true"]').count(), 1);
    assert((await page.locator('#rideSummary').innerText()).includes('あなたの便：2件'));
    // 生産者の視点
    await page.selectOption('#roleSelect', 'producer');
    assert.equal(await page.locator('[data-acting]').count(), 1);
    assert((await page.locator('[data-producer-farm]').count()) > 0);
    assert.equal(await page.locator('[data-participant-farm]').count(), 0);
    assert.equal(await page.locator('[data-mine-seg]').count(), 0);
    const card = page.locator(`[data-seg="${K.outKomorebi}"]`);
    await card.locator('details summary').click();
    assert.equal(await page.locator('#segOut [data-rider] button, #segOut [data-offer] button, #segRet [data-rider] button, #segRet [data-offer] button').count(), 0);
    // 数値と関係図はどちらの視点でも同じ
    const s = await seg(page, K.outKomorebi);
    assert.deepEqual([s.want, s.seats, s.verdict], [5, 3, '2席不足']);
    assert.equal(await page.locator('g.edge').count(), 6);
    // 自分の申し込みがない日
    await page.selectOption('#roleSelect', 'helper');
    await page.selectOption('#daySelect', 'd2');
    assert((await page.locator('#rideSummary').innerText()).includes('あなたの申し込みはありません'));
    // やり直しで援農者の視点に戻る
    await page.selectOption('#roleSelect', 'producer');
    await page.click('#reset');
    assert.equal(await page.inputValue('#roleSelect'), 'helper');
    await page.close();
  });

  await test('概念図：駅と農園を仮の配置で示し、未確認であることを明記し、農園で絞り込める', async () => {
    const page = await fresh();
    assert((await page.locator('[data-geo-note]').textContent()).includes('未確認'));
    assert.deepEqual(await page.locator('[data-geo-hub]').evaluateAll(els => els.map(e => e.textContent)), ['里山駅', 'もみじ台駅']);
    assert.equal(await page.locator('[data-geo-route="f1"]').count(), 2);
    assert.equal(await page.locator('[data-geo-route="f2"]').count(), 1);
    assert.equal(await page.locator('[data-geo-route="f5"]').count(), 0);
    assert((await page.locator('[data-geo-label="f1"]').first().textContent()).includes('不足'));
    assert.equal(await page.locator('[data-geo-mine]').count(), 1);
    await page.click('g.geo-farm[data-geo-farm="f2"]');
    const farms = await page.locator('[data-seg]').evaluateAll(els => [...new Set(els.map(e => e.dataset.farm))]);
    assert.deepEqual(farms, ['f2']);
    assert.equal(await page.inputValue('#farmSelect'), 'f2');
    await page.selectOption('#roleSelect', 'producer');
    assert.equal(await page.locator('[data-geo-mine]').count(), 0);
    await page.close();
  });

  await test('あなたの手順：①畑を選ぶ→②行き方→③伝える→④当日まで（詳細は閉じたまま）', async () => {
    const page = await fresh({width: 1200, height: 1000}, {openDetails: false});
    assert.equal(await page.locator('#coordDetails').evaluate(d => d.open), false);
    // ① 初期はP-01の便がある こもれび農園
    assert.equal(await page.locator('[data-journey-farm="f1"]').getAttribute('aria-pressed'), 'true');
    // ② 自分の便が行き・帰りの2つ、ボタンは最初から見える
    assert.equal(await page.locator('[data-my-seg]').count(), 2);
    await page.locator('[data-my-seg="d1|out|里山駅|f1|a"] [data-agree-offer="o01"]').click();
    assert((await page.locator('[data-journey-status="f1"]').innerText()).includes('1 / 2 便を記録（あなたの側の記録）'));
    // ③ 参加の選択
    await page.locator('[data-journey-choice="相談したい"]').click();
    assert.equal(await page.locator('[data-journey-state="f1"]').innerText(), '相談したい');
    // 生産者の視点：来たい人数と受け入れだけ
    await page.selectOption('#roleSelect', 'producer');
    // 生産者の画面には相乗りの情報を出さない（相乗りは援農者どうしの機能）
    assert.equal(await page.locator('[data-producer-seg]').count(), 0);
    await page.locator('[data-producer-home="f1"] [data-home-choice="延期"]').click();
    // ④ 援農者に戻ると、受け入れは延期・移動の合意は記録のまま（別々）
    await page.selectOption('#roleSelect', 'helper');
    const st = await page.locator('[data-journey-status="f1"]').innerText();
    assert(st.includes('延期') && st.includes('1 / 2 便を記録'));
    // 別の畑：P-01 の便がない
    await page.locator('[data-journey-farm="f2"]').click();
    assert.equal(await page.locator('[data-no-mine]').count(), 1);
    await page.close();
  });

  await test('生産者の入力→援農者の画面に反映→相乗りの相談→受け入れの変更（すべて画面内）', async () => {
    const page = await fresh({width: 1200, height: 1000}, {openDetails: false});
    await page.selectOption('#roleSelect', 'producer');
    // 操作中の農園を切り替えられ、表示される
    await page.selectOption('#producerFarm', 'f5');
    assert.equal(await page.locator('[data-acting]').innerText(), 'そよかぜ畑として操作中');
    // そよかぜ畑は 11/21 の予定がない → 入力して反映
    await page.fill('#recruitWork', '冬の畑の草取り。一緒にやりませんか');
    await page.fill('#recruitCount', '3');
    await page.click('[data-recruit-form="f5"] button[type="submit"]');
    assert((await page.locator('#toast').innerText()).includes('通知・保存・送信はしていません'));
    await page.selectOption('#roleSelect', 'helper');
    const card = page.locator('[data-journey-farm="f5"]');
    assert((await card.innerText()).includes('冬の畑の草取り'));
    assert((await card.locator('[data-recruit]').innerText()).includes('募集 3人（生産者の画面で入力・この画面内の反映）'));
    // 援農者：そよかぜ畑には P-01 の便がない（新しい申し込みはできない）
    await card.click();
    assert.equal(await page.locator('[data-no-mine]').count(), 1);
    // こもれび農園で相乗りを相談
    await page.locator('[data-journey-farm="f1"]').click();
    await page.locator('[data-my-seg="d1|out|里山駅|f1|a"]').getByRole('button', {name: '相談する'}).click();
    // 生産者：こもれび農園を延期 → 行き・帰り・到着予定・再確認の表示
    await page.selectOption('#roleSelect', 'producer');
    await page.selectOption('#producerFarm', 'f1');
    assert((await page.locator('[data-arrival="P-01"]').innerText()).includes('未申告'));
    assert((await page.locator('[data-arrival="P-03"]').innerText()).includes('未申告'));
    await page.locator('[data-producer-home="f1"] [data-home-choice="延期"]').click();
    assert.equal(await page.locator('[data-producer-home="f1"] [data-recheck]').count(), 1);
    // 援農者：受け入れは「延期」と表示（「未決定」ではない）、相談中の記録は残る
    await page.selectOption('#roleSelect', 'helper');
    await page.locator('[data-journey-farm="f1"]').click();
    assert.equal(await page.locator('[data-journey-farm="f1"] [data-accept-badge]').innerText(), '受け入れ：延期');
    assert.equal(await page.locator('[data-journey-status="f1"] [data-recheck]').count(), 1);
    assert.equal(await page.locator('[data-my-seg="d1|out|里山駅|f1|a"] [data-rider-status]').innerText(), '相談中');
    // 見送りは「見送り」と表示
    await page.selectOption('#roleSelect', 'producer');
    await page.locator('[data-producer-home="f1"] [data-home-choice="見送り"]').click();
    await page.selectOption('#roleSelect', 'helper');
    assert.equal(await page.locator('[data-journey-farm="f1"] [data-accept-badge]').innerText(), '受け入れ：見送り');
    await page.close();
  });

  await test('誰がいつ来て、いつ帰るか：P-01 の申告が生産者の表に反映し、未申告・目安より後・変更を区別する（滞在時間のみ）', async () => {
    const page = await fresh({width: 1200, height: 1000}, {openDetails: false});
    // 援農者 P-01：こもれび農園に 10:00 着・14:00 発・自転車で伝える
    assert.equal(await page.locator('[data-attend-mine]').innerText(), 'まだ伝えていません');
    await page.selectOption('#attendArrive', '10:00');
    await page.selectOption('#attendLeave', '14:00');
    await page.selectOption('#attendMode', '自転車');
    await page.click('[data-attend-form="f1"] button[type="submit"]');
    assert((await page.locator('#toast').innerText()).includes('通知・保存・送信はしていません'));
    await page.selectOption('#roleSelect', 'producer');
    await page.selectOption('#producerFarm', 'f1');
    const row = t => page.locator(`[data-arrival="${t}"]`).innerText();
    const p01 = await row('P-01');
    assert(p01.includes('10:00') && p01.includes('14:00') && p01.includes('申告済み'));
    // 生産者には滞在時間だけを見せ、来る方法や相乗りの便は出さない
    assert(!p01.includes('自転車') && !p01.includes('発'));
    assert((await row('P-03')).includes('未申告'));
    assert((await row('P-09')).includes('10:00') && (await row('P-09')).includes('14:00'));
    assert((await row('P-08')).includes('目安より後（受け付け済み）'));
    // 変更を伝えると「変更あり」
    await page.selectOption('#roleSelect', 'helper');
    await page.selectOption('#attendLeave', '15:00');
    await page.click('[data-attend-form="f1"] button[type="submit"]');
    await page.selectOption('#roleSelect', 'producer');
    assert((await row('P-01')).includes('変更あり'));
    await page.close();
  });

  await test('援農者は2種類：相乗りする人（P-01）の合意記録が、運転する人（D-01）の画面に表示だけされる', async () => {
    const page = await fresh({width: 1200, height: 1000}, {openDetails: false});
    assert((await page.locator('#roleSelect option:checked').innerText()).includes('車に相乗りする人'));
    await page.locator('[data-my-seg="d1|out|里山駅|f1|a"] [data-agree-offer="o01"]').click();
    await page.selectOption('#roleSelect', 'driver');
    assert((await page.locator('#roleSelect option:checked').innerText()).includes('車を運転する人'));
    assert((await page.locator('[data-driver-note]').innerText()).includes('承認する機能はありません'));
    assert.equal(await page.locator('[data-driver-seg]').count(), 2);
    assert((await page.locator('[data-driver-agreed="d1|out|里山駅|f1|a"]').innerText()).includes('P-01（乗る人の側の記録）'));
    assert.equal(await page.locator('#journey button, #journey input').count(), 0);
    assert.equal(await page.locator('#journey select[data-driver-hub]').count(), 2);
    assert.equal(await page.locator('[data-geo-mine]').count(), 0);
    await page.close();
  });

  await test('同じ日に2つの畑の予定を入れられない（P-01 個人）', async () => {
    const page = await fresh({width: 1200, height: 1000}, {openDetails: false});
    // 初期：11/21 はこもれび農園に参加希望
    assert.equal(await page.locator('[data-booked="f1"]').count(), 1);
    assert((await page.locator('[data-conflict="f2"]').innerText()).includes('こもれび農園に予定あり'));
    await page.locator('[data-journey-farm="f2"]').click();
    assert.equal(await page.locator('[data-journey-choice="参加希望"]').isDisabled(), true);
    assert.equal(await page.locator('[data-double]').count(), 1);
    assert.equal(await page.locator('[data-attend-blocked]').count(), 1);
    await page.locator('[data-journey-choice="相談したい"]').click();
    assert.equal(await page.locator('[data-journey-state="f2"]').innerText(), '相談したい');
    // こもれび農園を見送ると、みずべ農園に参加希望を出せる
    await page.locator('[data-journey-farm="f1"]').click();
    await page.locator('[data-journey-choice="見送り"]').click();
    await page.locator('[data-journey-farm="f2"]').click();
    assert.equal(await page.locator('[data-journey-choice="参加希望"]').isDisabled(), false);
    await page.locator('[data-journey-choice="参加希望"]').click();
    assert.equal(await page.locator('[data-booked="f2"]').count(), 1);
    await page.close();
  });

  await test('集合場所は運転する人が条件として出し、乗る人が受け入れる', async () => {
    const page = await fresh({width: 1200, height: 1000}, {openDetails: false});
    const card = page.locator('[data-my-seg="d1|out|里山駅|f1|a"]');
    // P-01 には、里山駅の D-01 と、もみじ台駅の D-05 の条件が並ぶ
    assert.equal(await card.locator('[data-offer-hub="里山駅"]').count(), 1);
    assert((await card.locator('[data-agree-offer="o07"]').innerText()).includes('集合：もみじ台駅・希望と別の駅'));
    // D-05 の条件を受け入れると、P-01 はもみじ台駅の便に移る（里山駅の便は 4人／3席）
    await card.locator('[data-agree-offer="o07"]').click();
    assert.equal(await page.locator('[data-my-seg="d1|out|もみじ台駅|f1|a"]').count(), 1);
    assert((await page.locator('[data-my-seg="d1|out|もみじ台駅|f1|a"] [data-rider-status]').innerText()).includes('D-05 の車'));
    assert.equal(await page.locator('[data-geo-mine]').textContent(), 'あなた（P-01）の集合場所');
    await page.evaluate(() => { document.getElementById('coordDetails').open = true; });
    const s = await seg(page, K.outKomorebi);
    assert.deepEqual([s.want, s.seats, s.verdict], [4, 3, '1席不足']);
    // 運転する人 D-01 が集合場所を変えると、合意を記録していた人は相談中に戻る
    await page.reload(); await page.setContent(HTML);
    await page.locator('[data-my-seg="d1|out|里山駅|f1|a"] [data-agree-offer="o01"]').click();
    await page.selectOption('#roleSelect', 'driver');
    await page.selectOption('[data-driver-hub="o01"]', 'もみじ台駅');
    assert((await page.locator('#toast').innerText()).includes('P-01 は相談中に戻ります'));
    await page.selectOption('#roleSelect', 'helper');
    assert.equal(await page.locator('[data-my-seg="d1|out|里山駅|f1|a"] [data-rider-status]').innerText(), '相談中');
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
