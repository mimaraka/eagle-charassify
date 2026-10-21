'use strict';
const { pathToFileURL } = require('url');
const { flatten, Cache, mergeTags, proposals, resolveMapping, classify } = require('./core');
const { mapTags } = require('./mapping');
const { getTargetImageItems } = require('./eagle/items');
const Worker = require('./inference/bridge');
const $ = id => document.getElementById(id);
const defaults = { pythonPath: Worker.DEFAULT_PYTHON_PATH, camiePath: Worker.DEFAULT_CAMIE_PATH, pixaiPath: 'pixai-labs/pixai-tagger-v1.0',
  camieCharacter: 0.35, camieCopyright: 0.35, pixaiCharacter: 0.27, pixaiCopyright: 0.24,
  language: '日本語', allowCreate: true, endpoint: '', model: '', apiKey: '', source: 'selected', tagger: 'camie' };
let config = { ...defaults }, rows = [], folders = [], library = '', analysisLibrary = '', busy = false, cancelled = false, worker = null;
function node(tag, text, className) {
  const el = document.createElement(tag); if (text != null) el.textContent = text;
  if (className) el.className = className; return el;
}
function button(text, action) { const b = node('button', text); b.onclick = action; return b; }
function message(text) { $('status').textContent = text; }
function cache() { return new Cache(localStorage, library, config.language); }
function show(panel) {
  for (const id of ['review', 'settings', 'cache']) {
    $(`${id}Panel`).hidden = id !== panel;
    $(`${id}Tab`).setAttribute('aria-selected', String(id === panel));
    $(`${id}Tab`).tabIndex = id === panel ? 0 : -1;
  }
}
function setBusy(value) {
  busy = value;
  for (const id of ['analyze', 'apply', 'approveAll', 'rejectAll', 'source', 'tagger', 'settingsTab', 'cacheTab']) $(id).disabled = value;
  $('cancel').hidden = !value;
  render();
}
async function refreshLibrary() {
  if (!eagle.library.path) throw new Error('Eagle ライブラリを開いてください。');
  library = eagle.library.path;
  folders = flatten(await eagle.folder.getAll());
  $('libraryName').textContent = `${eagle.library.name} · ${config.language}`;
  $('folderPaths').replaceChildren(...folders.map(f => { const o = node('option'); o.value = f.path; return o; }));
}
function visibleRows() {
  const filter = $('filter').value;
  return rows.filter(r => filter === 'all' || (filter === 'error' ? r.errors.length || r.applyError : r.decision === filter));
}
function render() {
  const approved = rows.filter(r => r.decision === 'approved' && !r.applied).length;
  $('summary').textContent = `${rows.length} 件 · 承認 ${approved} 件 · 分類済み ${rows.filter(r => r.applied).length} 件`;
  $('apply').disabled = busy || !approved;
  if (!rows.length) return;
  const cards = visibleRows().map(row => {
    const card = node('article', null, `card ${row.decision}`);
    const img = node('img'); img.loading = 'lazy'; img.alt = row.item.name;
    img.src = pathToFileURL(row.item.thumbnailPath || row.item.filePath).href;
    const body = node('div', null, 'cardbody'); body.append(node('h3', row.item.name));
    body.append(node('span', row.applied ? '分類済み' : { pending: '未確認', approved: '承認', rejected: '却下' }[row.decision], 'badge'));
    body.append(node('p', (row.tags.character || []).map(t => `${t.tag} ${Math.round(t.confidence * 100)}% (${t.sources.join(' + ')})`).join(' / ') || 'キャラクター未検出', 'tags'));
    if (row.errors.length || row.applyError) body.append(node('p', [...row.errors, row.applyError].filter(Boolean).join('\n'), 'error'));
    const targets = node('div', null, 'targets');
    row.targets.forEach((t, i) => {
      const line = node('div', null, 'target'); line.append(node('span', `${t.create ? '新規: ' : ''}${t.path}`));
      const remove = button('×', () => { row.targets.splice(i, 1); row.decision = 'pending'; render(); });
      remove.title = '分類先を削除'; remove.disabled = busy || row.applied; line.append(remove); targets.append(line);
    });
    body.append(targets);
    if (!row.applied) {
      const entry = node('input'); entry.setAttribute('list', 'folderPaths'); entry.placeholder = '既存パス または 作品名/キャラクター名'; entry.setAttribute('aria-label', '追加する分類先');
      const add = button('分類先を追加', () => {
        const path = entry.value.trim(); const matches = folders.filter(f => f.path === path);
        const parts = path.split('/');
        const m = matches.length === 1 ? { character: matches[0].name, copyright: '', folderId: matches[0].id }
          : { character: parts[1], copyright: parts[0], folderId: null };
        const target = (matches.length === 1 || parts.length === 2) && resolveMapping(m, folders, config.allowCreate);
        if (!target) { message('分類先を一意に指定してください。新規作成には作品名/キャラクター名が必要です。'); return; }
        if (!row.targets.some(t => (t.folderId || t.path) === (target.folderId || target.path))) row.targets.push(target);
        row.decision = 'pending'; render();
      });
      entry.disabled = add.disabled = busy; body.append(entry, add);
      const actions = node('div', null, 'actions');
      const approve = button('承認', () => { row.decision = 'approved'; render(); });
      approve.disabled = busy || !row.targets.length;
      const reject = button('却下', () => { row.decision = 'rejected'; render(); }); reject.disabled = busy;
      actions.append(approve, reject); body.append(actions);
    }
    card.append(img, body); return card;
  });
  $('results').replaceChildren(...(cards.length ? cards : [node('div', '該当する結果はありません。', 'empty')]));
}
async function analyze() {
  if (busy) return;
  cancelled = false; setBusy(true); $('warnings').textContent = '';
  try {
    await refreshLibrary();
    analysisLibrary = library;
    config.source = $('source').value; config.tagger = $('tagger').value; saveConfig();
    const items = await getTargetImageItems(config.source);
    rows = items.map(item => ({ item, tags: {}, detections: [], errors: [], targets: [], decision: 'pending', applied: false }));
    $('results').replaceChildren(node('div', items.length ? '解析を準備しています…' : '対象の画像はありません。', 'empty'));
    if (!items.length) { message('対象の画像はありません。'); return; }
    const models = config.tagger === 'both' ? ['camie', 'pixai'] : [config.tagger];
    for (const model of models) {
      if (cancelled) break;
      message(`${model} を読み込み中… 初回は時間がかかります。`);
      worker = new Worker({ model, pythonPath: config.pythonPath, camiePath: config.camiePath, pixaiPath: config.pixaiPath,
        characterThreshold: config[`${model}Character`], copyrightThreshold: config[`${model}Copyright`] });
      try {
        await worker.start();
        for (let i = 0; i < rows.length && !cancelled; i++) {
          message(`${model} で解析中 ${i + 1} / ${rows.length}`);
          try { rows[i].detections.push({ model, tags: await worker.infer(rows[i].item.filePath) }); }
          catch (e) { rows[i].errors.push(`${model}: ${e.message}`); }
        }
      } catch (e) { rows.forEach(r => r.errors.push(`${model}: ${e.message}`)); }
      finally { worker.stop(); worker = null; }
    }
    for (const row of rows) row.tags = mergeTags(row.detections);
    if (cancelled) { rows = []; $('results').replaceChildren(node('div', '解析を中止しました。', 'empty')); message('中止しました。'); return; }
    $('cancel').hidden = true;
    const mapped = await mapTags(rows, folders, cache(), config, message);
    for (const row of rows) row.targets = proposals(row.tags, mapped.mappings, folders, config.allowCreate);
    $('warnings').textContent = [...new Set(mapped.warnings)].join('\n');
    message('解析が完了しました。分類先を確認し、各画像を承認してください。');
  } catch (e) { message(e.message); }
  finally { setBusy(false); }
}
function saveConfig() { localStorage.setItem('charassify:settings:v1', JSON.stringify(config)); }
function loadSettingsForm() {
  const form = $('settingsForm');
  for (const [key, value] of Object.entries(config)) {
    const input = form.elements.namedItem(key); if (!input) continue;
    if (input.type === 'checkbox') input.checked = value; else input.value = value;
  }
}
function renderCache() {
  const search = $('cacheSearch').value.toLowerCase();
  const entries = Object.entries(cache().read()).filter(([tag, m]) => `${tag} ${m.character} ${m.copyright}`.toLowerCase().includes(search));
  $('cacheList').replaceChildren(...entries.map(([tag, m]) => {
    const row = node('div', null, 'cache-entry'); row.append(node('strong', tag));
    const character = node('input'); character.value = m.character; character.setAttribute('aria-label', 'キャラクター名');
    const copyright = node('input'); copyright.value = m.copyright; copyright.setAttribute('aria-label', '作品名');
    const folder = node('select'); folder.setAttribute('aria-label', '分類先フォルダ');
    const automatic = node('option', '名前から照合 / 新規作成'); automatic.value = ''; folder.append(automatic);
    if (m.folderId && !folders.some(f => f.id === m.folderId)) { const stale = node('option', '削除されたフォルダ（再選択が必要）'); stale.value = m.folderId; folder.append(stale); }
    for (const f of folders) { const opt = node('option', f.path); opt.value = f.id; folder.append(opt); }
    folder.value = m.folderId || '';
    row.append(character, copyright, folder, button('保存', () => {
      try { cache().put(tag, { character: character.value.trim(), copyright: copyright.value.trim(), folderId: folder.value || null }); renderCache(); }
      catch (e) { window.alert(e.message); }
    }), button('削除', () => { cache().remove(tag); renderCache(); }));
    return row;
  }));
  if (!entries.length) $('cacheList').append(node('p', '保存済みの対応はありません。'));
}
let initialized = false;
async function init() {
  if (initialized) return;
  initialized = true;
  try {
    config = { ...defaults, ...JSON.parse(localStorage.getItem('charassify:settings:v1') || '{}') };
    config.pythonPath = config.pythonPath?.trim() || defaults.pythonPath;
    config.camiePath = config.camiePath?.trim() || defaults.camiePath;
    loadSettingsForm();
    $('source').value = config.source; $('tagger').value = config.tagger;
  } catch (e) { message(`初期化エラー: ${e.message}`); }
  $('analyze').onclick = analyze;
  $('cancel').onclick = () => { cancelled = true; worker?.stop(); };
  $('filter').onchange = render;
  $('reviewTab').onclick = () => show('review');
  $('settingsTab').onclick = () => { loadSettingsForm(); show('settings'); };
  const tabs = ['reviewTab', 'cacheTab', 'settingsTab'].map($);
  for (const tab of tabs) tab.onkeydown = event => {
    const available = tabs.filter(t => !t.disabled);
    const index = available.indexOf(tab);
    let next;
    if (event.key === 'ArrowRight') next = available[(index + 1) % available.length];
    if (event.key === 'ArrowLeft') next = available[(index + available.length - 1) % available.length];
    if (event.key === 'Home') next = available[0];
    if (event.key === 'End') next = available[available.length - 1];
    if (next) { event.preventDefault(); next.focus(); }
  };
  $('cacheTab').onclick = async () => {
    try {
      await refreshLibrary();
      if (analysisLibrary && library !== analysisLibrary) {
        rows = []; $('results').replaceChildren(node('div', 'ライブラリが変更されました。解析し直してください。', 'empty')); render();
      }
      renderCache(); show('cache');
    } catch (e) { message(e.message); }
  };
  $('cacheSearch').oninput = renderCache;
  $('settingsForm').onsubmit = event => {
    event.preventDefault();
    const next = { ...config };
    for (const input of $('settingsForm').elements) if (input.name) next[input.name] = input.type === 'checkbox' ? input.checked : input.type === 'number' ? Number(input.value) : input.value.trim();
    next.pythonPath = next.pythonPath || defaults.pythonPath;
    next.camiePath = next.camiePath || defaults.camiePath;
    config = next; saveConfig();
    // 言語・新規作成ポリシーを変更した後は古い承認結果を使わない。
    rows = []; $('results').replaceChildren(node('div', '設定を保存しました。解析を開始してください。', 'empty'));
    render(); show('review'); message('設定を保存しました。');
  };
  $('approveAll').onclick = () => { visibleRows().forEach(r => { if (r.targets.length && !r.applied) r.decision = 'approved'; }); render(); };
  $('rejectAll').onclick = () => { visibleRows().forEach(r => { if (!r.applied) r.decision = 'rejected'; }); render(); };
  $('apply').onclick = async () => {
    if (busy) return;
    setBusy(true); $('cancel').hidden = true;
    try {
      const result = await classify(eagle, rows, analysisLibrary, config.allowCreate, r => message(`分類中: 成功 ${r.saved} 件 / 失敗 ${r.failed} 件`));
      message(`分類完了: 成功 ${result.saved} 件 / 失敗 ${result.failed} 件。失敗した画像は修正後に再実行できます。`);
    } catch (e) { message(e.message); }
    finally { setBusy(false); }
  };
  render();
  // ライブラリ情報の取得中や失敗時も、設定画面は操作できる状態にする。
  try { await refreshLibrary(); }
  catch (e) { message(`ライブラリ取得エラー: ${e.message}`); }
}
window.addEventListener('beforeunload', () => worker?.stop());
module.exports = { init };
