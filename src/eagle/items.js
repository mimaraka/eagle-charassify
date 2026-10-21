/**
 * 対象アイテム取得モジュール
 *
 * Eagleライブラリから未分類アイテム、または現在選択中のアイテムを取得し、
 * 画像ファイルのみにフィルタリングする。
 */

/** 解析対象の指定方法 */
const TARGET_SOURCES = {
  /** ライブラリ内の未分類アイテムすべて */
  UNFILED: "unfiled",
  /** Eagle上で現在選択中のアイテム */
  SELECTED: "selected",
};

/** 既定の解析対象 */
const DEFAULT_TARGET_SOURCE = TARGET_SOURCES.UNFILED;

/** 対応する画像拡張子 */
const IMAGE_EXTENSIONS = new Set([
  "jpg",
  "jpeg",
  "png",
  "gif",
  "bmp",
  "webp",
  "ico",
  "tiff",
  "tif",
  "avif",
]);

/**
 * 拡張子が画像ファイルかどうかを判定する。
 * @param {string} ext - 拡張子（ドットなし）
 * @returns {boolean}
 */
function isImageFile(ext) {
  if (!ext) return false;
  return IMAGE_EXTENSIONS.has(ext.toLowerCase());
}

/**
 * 未分類アイテムをすべて取得する。
 * @returns {Promise<object[]>} 未分類アイテムの配列
 */
async function getUnfiledItems() {
  const items = await eagle.item.get({ isUnfiled: true });
  return items;
}

/**
 * アイテム配列から画像ファイルのみを抽出する。
 * @param {object[]} items - Eagleアイテムの配列
 * @returns {object[]} 画像アイテムのみの配列
 */
function filterImageItems(items) {
  return items.filter((item) => isImageFile(item.ext));
}

/**
 * 未分類の画像アイテムのみを取得する便利関数。
 * @returns {Promise<object[]>} 未分類画像アイテムの配列
 */
async function getUnfiledImageItems() {
  const items = await getUnfiledItems();
  return filterImageItems(items);
}

/**
 * Eagle上で現在選択中のアイテムをすべて取得する。
 * @returns {Promise<object[]>} 選択中アイテムの配列
 */
async function getSelectedItems() {
  const items = await eagle.item.getSelected();
  return items || [];
}

/**
 * 現在選択中の画像アイテムのみを取得する便利関数。
 * @returns {Promise<object[]>} 選択中画像アイテムの配列
 */
async function getSelectedImageItems() {
  const items = await getSelectedItems();
  return filterImageItems(items);
}

/**
 * 現在選択中のアイテム数を取得する。
 * 画像以外も含む件数である点に注意。
 * @returns {Promise<number>} 選択中アイテム数
 */
async function countSelectedItems() {
  if (typeof eagle.item.countSelected === "function") {
    return eagle.item.countSelected();
  }
  const items = await getSelectedItems();
  return items.length;
}

/**
 * 指定された解析対象の画像アイテムを取得する。
 * @param {string} [source=DEFAULT_TARGET_SOURCE] - TARGET_SOURCESのいずれか
 * @returns {Promise<object[]>} 対象画像アイテムの配列
 */
async function getTargetImageItems(source = DEFAULT_TARGET_SOURCE) {
  if (source === TARGET_SOURCES.SELECTED) {
    return getSelectedImageItems();
  }
  return getUnfiledImageItems();
}

module.exports = {
  IMAGE_EXTENSIONS,
  TARGET_SOURCES,
  DEFAULT_TARGET_SOURCE,
  isImageFile,
  getUnfiledItems,
  filterImageItems,
  getUnfiledImageItems,
  getSelectedItems,
  getSelectedImageItems,
  countSelectedItems,
  getTargetImageItems,
};
