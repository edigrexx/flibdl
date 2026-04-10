/**
 * PWA регистрация и установка
 */

let deferredPrompt = null;

export function initPWA() {
  // Регистрируем Service Worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => {
        console.log('[PWA] Service Worker зарегистрирован:', reg.scope);
      })
      .catch((err) => {
        console.warn('[PWA] Ошибка регистрации SW:', err);
      });
  }

  // Перехватываем prompt установки
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    showInstallButton();
  });

  // После установки
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    hideInstallButton();
    showToast('Приложение установлено! 🎉');
  });
}

export async function promptInstall() {
  if (!deferredPrompt) {
    showToast('Используйте меню браузера для установки');
    return;
  }
  deferredPrompt.prompt();
  const { outcome } = await deferredPrompt.userChoice;
  if (outcome === 'accepted') {
    deferredPrompt = null;
  }
}

function showInstallButton() {
  const btn = document.getElementById('install-btn');
  if (btn) {
    btn.style.display = 'flex';
    btn.addEventListener('click', promptInstall);
  }
}

function hideInstallButton() {
  const btn = document.getElementById('install-btn');
  if (btn) btn.style.display = 'none';
}

export function showToast(message, type = 'info', duration = 3500) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;

  container.appendChild(toast);

  // Анимация появления
  requestAnimationFrame(() => {
    toast.classList.add('toast-visible');
    setTimeout(() => {
      toast.classList.remove('toast-visible');
      setTimeout(() => toast.remove(), 400);
    }, duration);
  });
}
