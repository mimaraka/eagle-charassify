'use strict';

// 表示用パスではなく ID と階層を保持し、同名フォルダを区別する。
function flatten(tree, parent = '', parentId = null) {
  return tree.flatMap(f => {
    const path = parent ? `${parent}/${f.name}` : f.name;
    return [{ id: f.id, name: f.name, path, parentId }, ...flatten(f.children || [], path, f.id)];
  });
}
function segment(value) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 200 && !/[\\/\x00-\x1f]/.test(value) && !['.', '..'].includes(value.trim());
}
function validMapping(m) {
  return m && segment(m.character) && (m.copyright === '' || segment(m.copyright)) &&
    (m.folderId === null || typeof m.folderId === 'string');
}
function resolveMapping(m, folders, allowCreate) {
  if (!validMapping(m)) return null;
  if (m.folderId) {
    const folder = folders.find(f => f.id === m.folderId);
    // 削除された ID を別のフォルダへ暗黙的に置き換えない。
    return folder ? { ...m, path: folder.path, create: false } : null;
  }
  const exact = folders.filter(f => f.path === `${m.copyright}/${m.character}`);
  const names = folders.filter(f => f.name === m.character);
  const candidates = exact.length ? exact : names;
  if (candidates.length === 1) return { ...m, folderId: candidates[0].id, path: candidates[0].path, create: false };
  if (candidates.length > 1 || !allowCreate || !m.copyright) return null;
  return { ...m, path: `${m.copyright}/${m.character}`, create: true };
}
function mergeTags(results) {
  const groups = {};
  for (const { model, tags } of results) for (const [category, entries] of Object.entries(tags || {})) {
    if (!groups[category]) groups[category] = new Map();
    for (const t of entries) {
      const old = groups[category].get(t.tag);
      groups[category].set(t.tag, { tag: t.tag, confidence: Math.max(old?.confidence || 0, t.confidence),
        sources: [...new Set([...(old?.sources || []), model])] });
    }
  }
  return Object.fromEntries(Object.entries(groups).map(([key, values]) => [key, [...values.values()].sort((a,b) => b.confidence-a.confidence)]));
}
function proposals(tags, mappings, folders, allowCreate) {
  const unique = new Map();
  for (const t of tags.character || []) {
    const m = resolveMapping(mappings[t.tag], folders, allowCreate);
    if (m) unique.set(m.folderId || m.path, m);
  }
  return [...unique.values()];
}
class Cache {
  constructor(storage, library, language) {
    if (!library) throw new Error('ライブラリを識別できません。');
    this.storage = storage;
    this.key = `charassify:mapping:v1:${JSON.stringify([library, language])}`;
  }
  read() {
    const raw = this.storage.getItem(this.key);
    if (!raw) return Object.create(null);
    const data = JSON.parse(raw);
    if (!data || Array.isArray(data) || typeof data !== 'object' || Object.values(data).some(m => !validMapping(m))) {
      throw new Error('マッピングキャッシュが不正です。保存データを確認してください。');
    }
    return Object.assign(Object.create(null), data);
  }
  put(tag, value) {
    if (!tag.trim() || !validMapping(value)) throw new Error('タグ・キャラクター名・作品名を確認してください。');
    const data = this.read(); data[tag] = value;
    this.storage.setItem(this.key, JSON.stringify(data));
  }
  remove(tag) {
    const data = this.read(); delete data[tag]; this.storage.setItem(this.key, JSON.stringify(data));
  }
}

// 一括実行の直前に再取得し、ライブラリ切替・削除・外部変更を検出する。
async function classify(api, rows, library, allowCreate, progress = () => {}) {
  const checkLibrary = () => { if (api.library.path !== library) throw new Error('ライブラリが変更されました。解析し直してください。'); };
  checkLibrary();
  const folders = flatten(await api.folder.getAll());
  const result = { saved: 0, failed: 0 };
  const ensure = async (name, parentId, path) => {
    const matches = folders.filter(f => f.name === name && f.parentId === parentId);
    if (matches.length > 1) throw new Error(`同名フォルダが複数あります: ${path}`);
    if (matches.length) return matches[0].id;
    checkLibrary();
    const made = await api.folder.create({ name, ...(parentId ? { parent: parentId } : {}) });
    if (!made?.id) throw new Error('フォルダ作成結果に ID がありません。');
    folders.push({ id: made.id, name, parentId, path });
    return made.id;
  };
  for (const row of rows.filter(r => r.decision === 'approved' && !r.applied)) {
    try {
      checkLibrary();
      if (!row.targets.length) throw new Error('分類先を選択してください。');
      const targets = row.targets.map(t => resolveMapping(t, folders, allowCreate));
      if (targets.some(t => !t)) throw new Error('分類先が削除・重複しているか、新規作成が無効です。再確認してください。');
      const item = await api.item.getById(row.item.id);
      if (!item) throw new Error('アイテムが見つかりません。');
      const ids = [];
      for (const t of targets) {
        if (t.folderId) ids.push(t.folderId);
        else {
          const parent = await ensure(t.copyright, null, t.copyright);
          ids.push(await ensure(t.character, parent, t.path));
        }
      }
      checkLibrary();
      item.folders = [...new Set([...(item.folders || []), ...ids])];
      await item.save();
      row.applied = true; row.applyError = null; result.saved++;
    } catch (e) { row.applyError = e.message; result.failed++; }
    progress(result, row);
  }
  return result;
}
module.exports = { flatten, segment, validMapping, resolveMapping, mergeTags, proposals, Cache, classify };
