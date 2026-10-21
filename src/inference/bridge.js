'use strict';
const { spawn } = require('child_process');
const { createInterface } = require('readline');
const path = require('path');
const PLUGIN_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_CAMIE_PATH = 'models';
const DEFAULT_PYTHON_PATH = process.platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python';

function resolvePythonPath(value) {
  const executable = value?.trim() || DEFAULT_PYTHON_PATH;
  // 明示指定した python / python3 等のコマンド名は PATH から探す。
  if (path.isAbsolute(executable) || !/[\\/]/.test(executable)) return executable;
  return path.resolve(PLUGIN_ROOT, executable);
}

class Worker {
  constructor(config) {
    this.config = { ...config, camiePath: path.resolve(PLUGIN_ROOT, config.camiePath?.trim() || DEFAULT_CAMIE_PATH) };
    this.pending = new Map(); this.counter = 0;
  }
  start() {
    return new Promise((resolve, reject) => {
      this.rejectStart = reject;
      this.proc = spawn(resolvePythonPath(this.config.pythonPath), ['-u', path.join(__dirname, 'worker.py')], {
        windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
      });
      this.timer = setTimeout(() => this.stop(new Error('モデル読み込みがタイムアウトしました（10分）。')), 600000);
      this.proc.stderr.on('data', chunk => { this.log = ((this.log || '') + chunk.toString()).slice(-3000); });
      this.proc.stdin.on('error', e => this.stop(e));
      this.proc.on('error', e => this.stop(e));
      this.proc.on('exit', code => this.stop(new Error(`推論プロセスが終了しました (${code})。${this.log || ''}`)));
      this.lines = createInterface({ input: this.proc.stdout });
      this.lines.on('line', line => {
        let data;
        try { data = JSON.parse(line); } catch { return; }
        if (data.ready) { clearTimeout(this.timer); this.rejectStart = null; resolve(); }
        else if (data.id && this.pending.has(data.id)) {
          const p = this.pending.get(data.id); this.pending.delete(data.id); clearTimeout(p.timer);
          data.error ? p.reject(new Error(data.error)) : p.resolve(data.tags);
        } else if (data.error) this.stop(new Error(data.error));
      });
      this.proc.stdin.write(JSON.stringify(this.config) + '\n');
    });
  }
  infer(file) {
    return new Promise((resolve, reject) => {
      if (!this.proc) return reject(new Error('推論プロセスが停止しています。'));
      const id = String(++this.counter);
      const timer = setTimeout(() => this.stop(new Error('画像の解析がタイムアウトしました（3分）。')), 180000);
      this.pending.set(id, { resolve, reject, timer });
      this.proc.stdin.write(JSON.stringify({ id, path: file }) + '\n');
    });
  }
  stop(error = new Error('解析を中止しました。')) {
    clearTimeout(this.timer);
    if (this.rejectStart) { this.rejectStart(error); this.rejectStart = null; }
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(error); }
    this.pending.clear();
    const proc = this.proc; this.proc = null;
    if (this.lines) { this.lines.close(); this.lines = null; }
    if (proc) proc.kill();
  }
}
module.exports = Worker;
module.exports.DEFAULT_PYTHON_PATH = DEFAULT_PYTHON_PATH;
module.exports.DEFAULT_CAMIE_PATH = DEFAULT_CAMIE_PATH;
module.exports.resolvePythonPath = resolvePythonPath;
