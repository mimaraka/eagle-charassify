'use strict';
const assert = require('assert').strict;
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createRequire } = require('module');
const root = path.resolve(__dirname, '..');

// 実際の HTML の要素を用意し、画面の切替と起動順序を検証する。
function environment(getAll, saved = '{}') {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const elements = new Map();
  for (const match of html.matchAll(/<[^>]*\bid="([^"]+)"[^>]*>/g)) {
    elements.set(match[1], { hidden: /\bhidden\b/.test(match[0]), value: '', replaceChildren() {}, setAttribute(name, value) { this[name] = value; } });
  }
  const fields = [...html.matchAll(/<input\b[^>]*\bname="([^"]+)"[^>]*>/g)].map(match => ({
    name: match[1], type: /\btype="([^"]+)"/.exec(match[0])?.[1] || 'text', value: ''
  }));
  fields.namedItem = name => fields.find(f => f.name === name);
  elements.get('settingsForm').elements = fields;
  const context = {
    module: { exports: {} }, require: createRequire(path.join(root, 'src', 'app.js')),
    document: { getElementById: id => elements.get(id), createElement: () => ({}) },
    window: { addEventListener() {} }, localStorage: { getItem: () => saved, setItem: (key, value) => { saved = value; } },
    eagle: { library: { path: 'test-library', name: 'テスト' }, folder: { getAll } }
  };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'src', 'app.js'), 'utf8'), context);
  return { init: context.module.exports.init, elements, stored: () => saved };
}

module.exports = test => {
  test('API キーを保存・再起動で復元し、タブ移動では保持、空欄保存で削除', async () => {
    const app = environment(async () => []);
    await app.init();
    app.elements.get('settingsTab').onclick();
    app.elements.get('settingsForm').elements.namedItem('apiKey').value = 'test-only-key';
    app.elements.get('settingsForm').onsubmit({ preventDefault() {} });
    const reopened = environment(async () => [], app.stored());
    await reopened.init();
    reopened.elements.get('settingsTab').onclick();
    const field = reopened.elements.get('settingsForm').elements.namedItem('apiKey');
    assert.equal(field.value, 'test-only-key');
    field.value = 'discarded-edit';
    reopened.elements.get('reviewTab').onclick();
    assert.equal(reopened.elements.get('reviewTab')['aria-selected'], 'true');
    assert.equal(reopened.elements.get('settingsTab')['aria-selected'], 'false');
    assert.equal(JSON.parse(reopened.stored()).apiKey, 'test-only-key');
    reopened.elements.get('settingsTab').onclick();
    assert.equal(field.value, 'test-only-key');
    field.value = '';
    reopened.elements.get('settingsForm').onsubmit({ preventDefault() {} });
    assert.equal(JSON.parse(reopened.stored()).apiKey, '');
  });
  test('保存済みの空の Python 設定を仮想環境の既定値で表示', async () => {
    const app = environment(async () => [], JSON.stringify({ pythonPath: '', camiePath: '' }));
    await app.init(); app.elements.get('settingsTab').onclick();
    assert.equal(app.elements.get('settingsForm').elements.namedItem('pythonPath').value,
      require('../src/inference/bridge').DEFAULT_PYTHON_PATH);
    assert.equal(app.elements.get('settingsForm').elements.namedItem('camiePath').value, 'models');
  });
  test('起動時は plugin.path から絶対パスで読み込み、明示的に初期化', async () => {
    let callback, initialized = 0;
    vm.runInNewContext(fs.readFileSync(path.join(root, 'src', 'bootstrap.js'), 'utf8'), {
      eagle: { onPluginCreate: cb => { callback = cb; } },
      require: id => {
        if (id === 'path') return path;
        assert.equal(id, path.join(root, 'src', 'app.js'));
        return { init: async () => { initialized++; } };
      }, console
    });
    assert.equal(initialized, 0);
    await callback({ path: root }); assert.equal(initialized, 1);
  });
  test('フォルダ取得が未完了でも設定画面を開いてレビューに戻れる', async () => {
    let finish;
    const app = environment(() => new Promise(resolve => { finish = resolve; }));
    const ready = app.init();
    assert.equal(typeof app.elements.get('settingsTab').onclick, 'function');
    app.elements.get('settingsTab').onclick();
    assert.equal(app.elements.get('settingsPanel').hidden, false);
    assert.equal(app.elements.get('reviewPanel').hidden, true);
    assert.equal(app.elements.get('settingsForm').elements.namedItem('language').value, '日本語');
    app.elements.get('reviewTab').onclick();
    assert.equal(app.elements.get('reviewPanel').hidden, false);
    finish([]); await ready;
  });
  test('フォルダ取得失敗時も設定ボタンを操作できる', async () => {
    const app = environment(async () => { throw new Error('offline'); });
    await app.init(); app.elements.get('settingsTab').onclick();
    assert.equal(app.elements.get('settingsPanel').hidden, false);
    assert.match(app.elements.get('status').textContent, /offline/);
  });
  test('保存設定の破損時も設定画面を開ける', async () => {
    const app = environment(async () => [], '{broken');
    await app.init(); app.elements.get('settingsTab').onclick();
    assert.equal(app.elements.get('settingsPanel').hidden, false);
  });
  test('起動ファイルの読み込み失敗を画面に表示', async () => {
    let callback; const status = {};
    vm.runInNewContext(fs.readFileSync(path.join(root, 'src', 'bootstrap.js'), 'utf8'), {
      eagle: { onPluginCreate: cb => { callback = cb; } },
      document: { getElementById: () => status }, console: { error() {} },
      require: id => { if (id === 'path') return path; throw new Error('module unavailable'); }
    });
    await callback({ path: root }); assert.match(status.textContent, /起動エラー: module unavailable/);
  });
};
