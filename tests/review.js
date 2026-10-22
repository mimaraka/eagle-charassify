'use strict';
const assert = require('assert').strict;
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createRequire } = require('module');
const root = path.resolve(__dirname, '..');

module.exports = test => {
  test('検出の進捗、LLM 設定修正後のマッピングのみ再試行、対応表の即時反映', async () => {
    const element = () => ({ children: [], value: '', hidden: false,
      append(...children) { this.children.push(...children); },
      replaceChildren(...children) { this.children = children; },
      setAttribute(k, v) { this[k] = v; } });
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    const elements = new Map([...html.matchAll(/<[^>]*\bid="([^"]+)"[^>]*>/g)].map(m => [m[1], { ...element(), checked: /\bchecked\b/.test(m[0]) }]));
    const fields = [...html.matchAll(/<input\b[^>]*\bname="([^"]+)"[^>]*>/g)].map(m => ({
      name: m[1], type: /\btype="([^"]+)"/.exec(m[0])?.[1] || 'text', value: ''
    }));
    fields.namedItem = name => fields.find(f => f.name === name);
    elements.get('settingsForm').elements = fields;
    const data = new Map();
    let inferences = 0, requests = 0;
    class Worker {
      async start() { assert.equal(elements.get('detectionProgress').hidden, false); }
      async infer() {
        assert.equal(elements.get('detectionProgress').value, inferences++);
        return { character: [{ tag: 'alice', confidence: inferences === 1 ? .9 : .7 }],
          copyright: [{ tag: 'series', confidence: inferences === 1 ? .5 : .95 }] };
      }
      stop() {}
    }
    Worker.DEFAULT_PYTHON_PATH = 'python'; Worker.DEFAULT_CAMIE_PATH = 'models';
    const realRequire = createRequire(path.join(root, 'src/app.js'));
    const context = {
      module: { exports: {} },
      require: name => name === './inference/bridge' ? Worker : name === './eagle/items' ? {
        getTargetImageItems: async () => [1, 2].map(id => ({ id, name: `test${id}`, filePath: path.join(root, 'test.png') }))
      } : name === './mapping' ? {
        mapTags: (...args) => realRequire('./mapping').mapTags(...args, async () => {
          requests++;
          if (requests === 1) throw Error('offline');
          return { alice: { character: 'アリス', copyright: '作品', folderId: null } };
        })
      } : realRequire(name),
      document: { getElementById: id => elements.get(id), createElement: element },
      window: { addEventListener() {}, alert: text => { throw Error(text); } },
      localStorage: { getItem: k => data.get(k) || null, setItem: (k, v) => data.set(k, v) },
      eagle: { library: { path: 'lib', name: 'test' }, folder: { getAll: async () => [] } }
    };
    vm.runInNewContext(fs.readFileSync(path.join(root, 'src/app.js'), 'utf8'), context);
    await context.module.exports.init();
    await elements.get('analyze').onclick();
    assert.equal(inferences, 2);
    assert.equal(elements.get('detectionProgress').value, 2);
    assert.equal(elements.get('detectionProgress').hidden, true);
    assert.equal(elements.get('retryMapping').hidden, false);
    fields.namedItem('endpoint').value = 'http://localhost:1234';
    elements.get('settingsForm').onsubmit({ preventDefault() {} });
    await elements.get('retryMapping').onclick();
    assert.equal(inferences, 2); assert.equal(requests, 2);
    assert.equal(elements.get('retryMapping').hidden, true);
    const names = () => Array.from(elements.get('results').children, card => card.children[0].alt);
    elements.get('sort').value = 'probabilityDesc'; elements.get('sort').onchange();
    assert.deepEqual(names(), ['test2', 'test1']);
    elements.get('sort').value = 'probabilityAsc'; elements.get('sort').onchange();
    assert.deepEqual(names(), ['test1', 'test2']);
    elements.get('filter-pending').checked = false;
    elements.get('filter-pending').onchange();
    assert.equal(elements.get('results').children[0].textContent, '該当する結果はありません。');
    elements.get('approveAll').onclick();
    assert.match(elements.get('summary').textContent, /承認 0 件/);
    elements.get('filter-pending').checked = true;
    elements.get('filter-pending').onchange();
    assert.deepEqual(names(), ['test1', 'test2']);
    elements.get('sort').value = 'original'; elements.get('sort').onchange();
    assert.deepEqual(names(), ['test1', 'test2']);
    elements.get('approveAll').onclick();
    await elements.get('cacheTab').onclick();
    const entry = elements.get('cacheList').children[0];
    entry.children[1].value = '訂正';
    entry.children[4].onclick();
    assert.match(elements.get('summary').textContent, /承認 0 件/);
    const findBadge = el => el.className === 'folder-badge folder-badge-new' ? el : el.children?.map(findBadge).find(Boolean);
    for (const card of elements.get('results').children) assert.equal(findBadge(card).textContent, '新規 · 訂正');
    // 別のアプリインスタンスでもチェック解除（全解除を含む）を復元する。
    const filterValues = Object.values(realRequire('./filters').filterGroups).flat();
    for (const value of filterValues) elements.get(`filter-${value}`).checked = false;
    elements.get('filter-error').onchange();
    const reopen = async () => {
      const next = { ...context, module: { exports: {} } };
      vm.runInNewContext(fs.readFileSync(path.join(root, 'src/app.js'), 'utf8'), next);
      await next.module.exports.init();
    };
    for (const value of filterValues) elements.get(`filter-${value}`).checked = true;
    await reopen();
    for (const value of filterValues) assert.equal(elements.get(`filter-${value}`).checked, false);
    elements.get('filter-approved').checked = true;
    elements.get('filter-approved').onchange();
    await reopen();
    for (const value of filterValues) assert.equal(elements.get(`filter-${value}`).checked, value === 'approved');
    data.set('charassify:filters:v1', '{broken');
    await reopen();
    for (const value of filterValues) assert.equal(elements.get(`filter-${value}`).checked, true);
    data.set('charassify:filters:v1', JSON.stringify({ approved: false, error: 'invalid' }));
    await reopen();
    for (const value of filterValues) assert.equal(elements.get(`filter-${value}`).checked, value !== 'approved');
  });
};
