// Log Manager for Live Monospace Terminal
class LogManager {
  constructor() {
    this.container = document.getElementById('terminal-body');
    this.counterEl = document.getElementById('log-counter');
    this.maxEntries = 600;
    this.entries = [];

    document.getElementById('btn-clear-logs').addEventListener('click', () => this.clear());
    document.getElementById('btn-copy-logs').addEventListener('click', () => this.copyToClipboard());
  }

  append(entry) {
    const text = entry.text || '';
    if (!text.trim()) return;

    this.entries.push(text);
    if (this.entries.length > this.maxEntries) {
      this.entries.shift();
      if (this.container.firstElementChild) {
        this.container.removeChild(this.container.firstElementChild);
      }
    }

    const lineEl = document.createElement('div');
    lineEl.className = 'log-line';

    // Highlight colors
    if (text.includes('ERROR') || text.includes('error') || entry.level === 'error') {
      lineEl.classList.add('error');
    } else if (text.includes('Client started') || text.includes('Relay server started') || text.includes('connected')) {
      lineEl.classList.add('success');
    } else if (text.includes('[ReNet]')) {
      lineEl.classList.add('info');
    } else if (text.includes('WARN') || text.includes('warning')) {
      lineEl.classList.add('warn');
    }

    lineEl.textContent = text;
    this.container.appendChild(lineEl);

    // Auto-scroll to bottom
    this.container.scrollTop = this.container.scrollHeight;

    // Update counter
    this.counterEl.textContent = `${this.entries.length} 条记录`;
  }

  clear() {
    this.entries = [];
    this.container.replaceChildren();
    this.counterEl.textContent = '0 条记录';
  }

  async copyToClipboard() {
    if (this.entries.length === 0) return;
    const allText = this.entries.join('\n');
    try {
      await navigator.clipboard.writeText(allText);
      window.renetUI.showToast('日志已复制到剪贴板');
    } catch {
      window.renetUI.showToast('复制失败');
    }
  }
}

window.renetLog = new LogManager();
