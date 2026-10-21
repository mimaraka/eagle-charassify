'use strict';
const { spawn } = require('child_process');
const { createInterface } = require('readline');
const path = require('path');

class Worker {
  constructor(config) { this.config = config; this.pending = new Map(); this.counter = 0; }
  start() {
    return new Promise((resolve, reject) => {
      this.rejectStart = reject;
      this.proc = spawn(this.config.pythonPath || 'python', ['-u', path.join(__dirname, 'worker.py')], {
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
