'use strict';
const assert = require('assert').strict;
const { flatten, Cache, mergeTags, proposals, resolveMapping, classify } = require('../src/core');
const { mapTags, requestMapping } = require('../src/mapping');
const Worker = require('../src/inference/bridge');
const path = require('path');
const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const storage = () => { const data = new Map(); return { getItem: k => data.get(k) || null, setItem: (k,v) => data.set(k,v) }; };
const m = (character = 'アリス', copyright = '作品A', folderId = null) => ({ character, copyright, folderId });
test('モデル併用時に同じタグを統合し出典を保持', () => {
  const tags = mergeTags([{ model:'camie',tags:{character:[{tag:'alice',confidence:.8}]} }, {model:'pixai',tags:{character:[{tag:'alice',confidence:.9}]}}]);
  assert.equal(tags.character.length,1); assert.equal(tags.character[0].confidence,.9); assert.deepEqual(tags.character[0].sources,['camie','pixai']);
});
test('衣装差分を同じ分類先に統合、複数人物は保持', () => {
  const tags = {character:[{tag:'alice'},{tag:'alice_swimsuit'},{tag:'bob'}]};
  assert.equal(proposals(tags,{alice:m(),alice_swimsuit:m(),bob:m('ボブ')},[],true).length,2);
});
test('既存階層優先・曖昧な同名フォルダは選ばない', () => {
  const folders = flatten([{id:'a',name:'作品A',children:[{id:'aliceA',name:'アリス'}]},{id:'b',name:'作品B',children:[{id:'aliceB',name:'アリス'}]}]);
  assert.equal(resolveMapping(m(),folders,true).folderId,'aliceA');
  assert.equal(resolveMapping(m('アリス','不明'),folders,true),null);
  assert.equal(resolveMapping(m('アリス','作品A','deleted'),folders,true),null);
});
test('新規作成無効・不明な作品・不正名は作成候補にならない', () => {
  assert.equal(resolveMapping(m(),[],false),null);
  assert.equal(resolveMapping(m('アリス',''),[],true),null);
  assert.equal(resolveMapping(m('a/b'),[],true),null);
});
test('キャッシュは言語・ライブラリごとに分離し編集・削除可能', () => {
  const s = storage(), a = new Cache(s,'lib','日本語'); a.put('alice',m());
  assert.equal(new Cache(s,'other','日本語').read().alice,undefined);
  assert.equal(new Cache(s,'lib','English').read().alice,undefined);
  a.put('alice',m('訂正')); assert.equal(a.read().alice.character,'訂正'); a.remove('alice'); assert.equal(a.read().alice,undefined);
});
test('全件キャッシュなら API キーも LLM 呼び出しも不要', async () => {
  const c = new Cache(storage(),'lib','ja'); c.put('alice',m());
  const result = await mapTags([{tags:{character:[{tag:'alice'}]}}],[],c,{},()=>{},()=>{throw Error('呼び出し禁止');});
  assert.equal(result.mappings.alice.character,'アリス'); assert.deepEqual(result.warnings,[]);
});
test('LLM 失敗後もキャッシュを保持、不明タグは次回再試行', async () => {
  const c = new Cache(storage(),'lib','ja'); c.put('alice',m());
  const result = await mapTags([{tags:{character:[{tag:'alice'},{tag:'new'}]}}],[],c,{},()=>{},async()=>{throw Error('offline');});
  assert.equal(result.mappings.alice.character,'アリス'); assert.equal(c.read().new,undefined); assert.equal(result.warnings.length,1);
});
test('LLM は未知 ID を保存せず copyright 文脈を渡す', async () => {
  const c = new Cache(storage(),'lib','ja');
  await mapTags([{tags:{character:[{tag:'alice'}],copyright:[{tag:'series'}]}}],[],c,{},()=>{},async(config,chars)=>{
    assert.deepEqual(chars[0].copyrights,['series']); return {alice:m('アリス','作品A','invented')};
  });
  assert.equal(c.read().alice,undefined);
});
function fixture() {
  const tree = [], saved = [], created = [];
  const api = {library:{path:'lib'}, folder:{getAll:async()=>tree,create:async options=>{
    const folder = {id:String(created.length+1),name:options.name,children:[]}; created.push(options);
    if (options.parent) tree.find(f=>f.id===options.parent).children.push(folder); else tree.push(folder);
    return folder;
  }},item:{getById:async id=>({id,folders:['previous'],save:async function(){saved.push({id,folders:this.folders});}})}};
  const row = id => ({item:{id},decision:'approved',targets:[{...m(),create:true,path:'作品A/アリス'}]});
  return {api,created,saved,row};
}
test('承認分だけ階層作成、所属を保持しフォルダを再利用', async () => {
  const f = fixture(); const rows = [f.row('1'),f.row('2'),{...f.row('3'),decision:'rejected'},{...f.row('4'),decision:'pending'}];
  const result = await classify(f.api,rows,'lib',true);
  assert.deepEqual(result,{saved:2,failed:0}); assert.equal(f.created.length,2);
  assert.deepEqual(f.created[1],{name:'アリス',parent:'1'}); assert.deepEqual(f.saved[0].folders,['previous','2']);
  await classify(f.api,rows,'lib',true); assert.equal(f.saved.length,2);
});
test('ライブラリ変更時は書き込み禁止', async () => {
  const f = fixture(); await assert.rejects(classify(f.api,[f.row('1')],'other',true)); assert.equal(f.created.length,0);
});
test('保存失敗を項目ごとに記録し再試行できる', async () => {
  const f = fixture(); const rows = [f.row('1'),f.row('2')]; let fail = true;
  f.api.item.getById = async id => ({folders:[],save:async()=>{if(id==='1'&&fail)throw Error('保存失敗');}});
  assert.deepEqual(await classify(f.api,rows,'lib',true),{saved:1,failed:1});
  assert.equal(rows[0].applied,undefined); fail = false;
  assert.deepEqual(await classify(f.api,rows,'lib',true),{saved:1,failed:0}); assert.equal(f.created.length,2);
});
test('新規作成無効の場合は保存せず失敗として返す', async () => {
  const f = fixture(); assert.deepEqual(await classify(f.api,[f.row('1')],'lib',false),{saved:0,failed:1}); assert.equal(f.created.length,0);
});
test('LLM 通信は言語・タグ文脈を送信し JSON を復元', async () => {
  const original = global.fetch;
  global.fetch = async (url, options) => {
    assert.equal(url,'http://localhost:1234/v1/chat/completions');
    const body = JSON.parse(options.body);
    assert.ok(body.messages[0].content.includes('日本語'));
    assert.equal(JSON.parse(body.messages[1].content).characters[0].tag,'alice');
    return {ok:true,json:async()=>({choices:[{message:{content:'```json\n'+JSON.stringify({alice:m()})+'\n```'}}]})};
  };
  try {
    const result = await requestMapping({endpoint:'http://localhost:1234/v1/chat/completions',model:'local',language:'日本語'},[{tag:'alice'}],[],{});
    assert.equal(result.alice.character,'アリス');
    await assert.rejects(requestMapping({endpoint:'http://example.com',model:'local'},[],[],{}),/HTTPS/);
  } finally { global.fetch = original; }
});
test('Python 起動失敗を返しプロセスと待機を破棄', async () => {
  const worker = new Worker({pythonPath:'charassify-nonexistent-python-executable'});
  await assert.rejects(worker.start());
  assert.equal(worker.proc,null); assert.equal(worker.pending.size,0);
});
test('承認された画像のすべてのキャラクターを保存', async () => {
  const f = fixture(), row = f.row('1'); row.targets.push({...m('ボブ'),path:'作品A/ボブ',create:true});
  assert.deepEqual(await classify(f.api,[row],'lib',true),{saved:1,failed:0});
  assert.equal(f.created.length,3); assert.deepEqual(f.saved[0].folders,['previous','2','3']);
});
test('Python の相対パスと空欄はプラグイン基準で解決', () => {
  const root = path.resolve(__dirname, '..');
  assert.equal(Worker.resolvePythonPath('venv/Scripts/python.exe'), path.join(root, 'venv', 'Scripts', 'python.exe'));
  assert.equal(Worker.resolvePythonPath('  '), path.resolve(root, Worker.DEFAULT_PYTHON_PATH));
  assert.equal(Worker.resolvePythonPath(undefined), path.resolve(root, Worker.DEFAULT_PYTHON_PATH));
});
test('Python の絶対パスと明示コマンドを保持', () => {
  const absolute = path.resolve(__dirname, 'other env', 'python.exe');
  assert.equal(Worker.resolvePythonPath(absolute), absolute);
  assert.equal(Worker.resolvePythonPath('python3'), 'python3');
});
require('./startup')(test);
test('Camie モデルの相対パス・空欄はプラグイン基準、絶対パスは保持', () => {
  const root = path.resolve(__dirname, '..');
  for (const camiePath of [undefined, '', '  ', 'models']) {
    assert.equal(new Worker({camiePath}).config.camiePath, path.join(root, 'models'));
  }
  assert.equal(new Worker({camiePath:'custom/models'}).config.camiePath, path.join(root, 'custom', 'models'));
  const absolute = path.resolve(root, '..', 'other models');
  assert.equal(new Worker({camiePath:absolute}).config.camiePath, absolute);
});
(async()=>{
  for(const [name,fn] of tests) { await fn(); console.log(`✓ ${name}`); }
  console.log(`${tests.length} tests passed`);
})().catch(e=>{console.error(e);process.exitCode=1;});
