const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('windowManager', {
  createWindow: (opts) => ipcRenderer.invoke('window-manager:create', opts),
  closeWindow: (id) => ipcRenderer.invoke('window-manager:close', id),
  listWindows: () => ipcRenderer.invoke('window-manager:list'),
  renameWindow: (id, title) => ipcRenderer.invoke('window-manager:rename', { id, title }),
  getStats: () => ipcRenderer.invoke('window-manager:stats'),
  getDebugInfo: () => ipcRenderer.invoke('window-manager:debug'),
  getCurrentWindowInfo: () => ipcRenderer.invoke('window-manager:current-window'),
  focusMain: () => ipcRenderer.invoke('window-manager:focus-main'),
  saveState: (id) => ipcRenderer.invoke('window-manager:save-state', id),
  forceSave: () => ipcRenderer.invoke('window-manager:force-save'),
  getDisplays: () => ipcRenderer.invoke('window-manager:get-displays'),
  moveToDisplay: (windowId, displayId, bounds) => ipcRenderer.invoke('window-manager:move-to-display', { windowId, displayId, bounds }),
  // Z-order management methods
  restoreZOrder: () => ipcRenderer.invoke('window-manager:restore-z-order'),
  bringToTop: (id) => ipcRenderer.invoke('window-manager:bring-to-top', id),
  setAlwaysOnTop: (id, alwaysOnTop) => ipcRenderer.invoke('window-manager:set-always-on-top', { id, alwaysOnTop }),
  getZOrderInfo: () => ipcRenderer.invoke('window-manager:get-z-order-info'),
  // Menu bar visibility methods
  setMenuBarVisibility: (id, visible) => ipcRenderer.invoke('window-manager:set-menu-bar-visibility', { id, visible }),
  getMenuBarVisibility: (id) => ipcRenderer.invoke('window-manager:get-menu-bar-visibility', id),
  // Clipboard functionality
  copyToClipboard: (text) => ipcRenderer.invoke('clipboard:write-text', text),
}); 