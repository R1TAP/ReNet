// UI Helper and Dialog/Toast Management
class UIManager {
  constructor() {
    this.toastEl = document.getElementById('app-toast');
    this.toastTimer = null;
    this.settingsModal = document.getElementById('settings-modal');
    this.confirmModal = document.getElementById('confirm-modal');
    this.confirmTitle = document.getElementById('confirm-title');
    this.confirmMsg = document.getElementById('confirm-message');
    this.confirmProceedBtn = document.getElementById('btn-confirm-proceed');
    this.confirmCancelBtn = document.getElementById('btn-confirm-cancel');
    this.onConfirmCallback = null;

    this.initWindowControls();
    this.initModalControls();
    this.initConfirmModal();
  }

  initWindowControls() {
    const minBtn = document.getElementById('win-min');
    const maxBtn = document.getElementById('win-max');
    const closeBtn = document.getElementById('win-close');
    const iconMax = document.getElementById('icon-win-max');
    const iconRestore = document.getElementById('icon-win-restore');

    minBtn?.addEventListener('click', () => {
      window.renetApi.minimizeWindow();
    });

    maxBtn?.addEventListener('click', () => {
      window.renetApi.maximizeWindow();
    });

    closeBtn?.addEventListener('click', () => {
      window.renetApi.closeWindow();
    });

    window.renetApi.onWindowMaximized?.((isMax) => {
      if (iconMax && iconRestore) {
        if (isMax) {
          iconMax.style.display = 'none';
          iconRestore.style.display = 'block';
          if (maxBtn) maxBtn.title = '向下还原';
        } else {
          iconMax.style.display = 'block';
          iconRestore.style.display = 'none';
          if (maxBtn) maxBtn.title = '最大化';
        }
      }
    });
  }

  initModalControls() {
    document.getElementById('btn-open-settings')?.addEventListener('click', () => {
      this.openSettings();
    });

    document.getElementById('btn-cancel-settings')?.addEventListener('click', () => {
      this.closeSettings();
    });

    this.settingsModal?.addEventListener('click', (e) => {
      if (e.target === this.settingsModal) {
        this.closeSettings();
      }
    });

    const dnsPreset = document.getElementById('setting-dns-preset');
    const customDnsGroup = document.getElementById('group-custom-dns');
    dnsPreset?.addEventListener('change', () => {
      customDnsGroup.style.display = dnsPreset.value === 'custom' ? 'flex' : 'none';
    });

    const adbMode = document.getElementById('setting-adb-mode');
    const customAdbGroup = document.getElementById('group-custom-adb');
    adbMode?.addEventListener('change', () => {
      customAdbGroup.style.display = adbMode.value === 'custom' ? 'flex' : 'none';
    });
  }

  initConfirmModal() {
    this.confirmCancelBtn?.addEventListener('click', () => {
      this.closeConfirm();
    });

    this.confirmProceedBtn?.addEventListener('click', () => {
      const cb = this.onConfirmCallback;
      this.closeConfirm();
      if (cb) cb();
    });

    this.confirmModal?.addEventListener('click', (e) => {
      if (e.target === this.confirmModal) {
        this.closeConfirm();
      }
    });
  }

  showConfirm({ title = '⚠️ 操作确认', message = '', onConfirm = null }) {
    this.confirmTitle.textContent = title;
    this.confirmMsg.textContent = message;
    this.onConfirmCallback = onConfirm;
    this.confirmModal.classList.add('visible');
  }

  closeConfirm() {
    this.confirmModal.classList.remove('visible');
    this.onConfirmCallback = null;
  }

  openSettings() {
    this.settingsModal.classList.add('visible');
  }

  closeSettings() {
    this.settingsModal.classList.remove('visible');
  }

  showToast(message, duration = 3000) {
    if (this.toastTimer) {
      clearTimeout(this.toastTimer);
    }
    this.toastEl.textContent = message;
    this.toastEl.classList.add('show');

    this.toastTimer = setTimeout(() => {
      this.toastEl.classList.remove('show');
    }, duration);
  }
}

window.renetUI = new UIManager();
