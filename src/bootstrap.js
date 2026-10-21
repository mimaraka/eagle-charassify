'use strict';

// Eagle の作業ディレクトリに依存せず、作成イベントから明示的に起動する。
(() => {
  const report = error => {
    document.getElementById('status').textContent = `起動エラー: ${error.message || error}`;
    console.error('[Charassify]', error);
  };
  if (typeof eagle === 'undefined') {
    report('Eagle のプラグイン開発メニューからこのフォルダを読み込んでください。');
    return;
  }
  eagle.onPluginCreate(async plugin => {
    try {
      const path = require('path');
      const app = require(path.join(plugin.path, 'src', 'app.js'));
      await app.init();
    } catch (error) { report(error); }
  });
})();
