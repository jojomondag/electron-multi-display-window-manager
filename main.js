const { app, screen, ipcMain, clipboard } = require('electron');
const path = require('path');
const { WindowManager } = require('./window-manager');

const manager = new WindowManager();



app.whenReady().then(() => {
  const displays = screen.getAllDisplays();

  // Clean up any orphaned window states
  manager.cleanupOrphanedStates();

  // First, restore all other windows from persistent storage BEFORE creating main window
  manager.restoreAllWindows((meta) => {
    // Don't set x,y here - let the WindowManager handle positioning from saved state
    // Only provide fallback if there's no saved state
    const existingState = manager.getWindowState(meta.id);
    const hasExistingState = existingState && (existingState.x !== undefined || existingState.y !== undefined);
    
    let windowOptions = {
      width: 800,
      height: 600,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, 'preload.js'),
      },
      // Work WITH Windows snap instead of fighting it
      titleBarStyle: 'default',
      minimizable: true,
      maximizable: true,
      resizable: true,
      // Standard size constraints
      minWidth: 200,
      minHeight: 150,
      // Standard window options
      skipTaskbar: false,
      alwaysOnTop: false,
      movable: true,
      frame: true,
      show: true
    };
    
    // Only set fallback position if there's no saved state
    if (!hasExistingState && meta.displayId) {
      const displays = screen.getAllDisplays();
      const targetDisplay = displays.find(d => d.id === meta.displayId);
      if (targetDisplay) {
        windowOptions.x = targetDisplay.bounds.x + 50;
        windowOptions.y = targetDisplay.bounds.y + 50;
      }
    }
    
    const managed = manager.createWindow(meta.id, windowOptions, meta);
    // Load the regular window HTML for non-main windows
    managed.window.loadFile('window.html');
  });

  // Then create the main window with ID 'main'
  const mainMeta = manager.getWindowList().find(w => w.id === 'main') || {};
  
  const mainWin = manager.createWindow('main', {
    width: 800,
    height: 600,
    x: displays[0].bounds.x + 50,
    y: displays[0].bounds.y + 50,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
    // Enable Windows native snap layouts and window management
    titleBarStyle: 'default', // Use native title bar for snap layout support
    minimizable: true,
    maximizable: true,
    resizable: true,
    // Ensure minimum size for snap layout compatibility (per Microsoft docs)
    minWidth: 330,
    minHeight: 200,
    // Remove show: true to let window manager control visibility
  }, { title: mainMeta.title || 'Window Manager', isMain: true, ...mainMeta });
  
  // UNIFIED: Set title once - the window manager handles this
  
  // Load the main window manager HTML for the main window
  mainWin.window.loadFile('index.html');

  // UNIFIED: Main window close handler
  mainWin.window.on('closed', () => {
    // Set quitting flag to prevent windows from being removed from persistent list
    manager.setQuitting(true);
    
    // Use unified save system
    manager.forceSaveAllWindows();
    
    // Close all other windows - their 'close' handlers will save state
    for (const win of manager.windows.values()) {
      if (win.id !== 'main') {
        win.window.close();
      }
    }
    
    // Simple app quit
    app.quit();
  });
});

ipcMain.handle('window-manager:create', (event, { id, title }) => {
  // Use provided ID or generate a unique one
  if (!id) {
    id = manager.generateWindowId();
  }
  
  // Check if this window already has saved state
  const existingState = manager.getWindowState(id);
  const hasExistingState = existingState && (existingState.x !== undefined || existingState.y !== undefined);
  
  let windowOptions = {
    width: 800,
    height: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
    // Enable Windows native snap layouts and window management
    titleBarStyle: 'default', // Use native title bar for snap layout support
    minimizable: true,
    maximizable: true,
    resizable: true,
    // Ensure minimum size for snap layout compatibility (per Microsoft docs)
    minWidth: 330,
    minHeight: 200,
  };
  
  // Only set position for truly new windows (no existing state)
  if (!hasExistingState) {
    const displays = screen.getAllDisplays();
    // Use a better distribution algorithm for multiple displays
    const allRegisteredIds = manager.registry.getAllWindowIds();
    const windowIndex = allRegisteredIds.length;
    const display = displays[windowIndex % displays.length];
    
    // Offset windows slightly so they don't overlap completely
    const offsetX = (windowIndex % 5) * 30; // Max 5 windows per row
    const offsetY = Math.floor(windowIndex / 5) * 30; // Then start new row
    
    windowOptions.x = display.bounds.x + 50 + offsetX;
    windowOptions.y = display.bounds.y + 50 + offsetY;
  }
  
  // Ensure we have a proper title
  const windowTitle = title || `Window ${id}`;
  
  const managed = manager.createWindow(id, windowOptions, { 
    title: windowTitle,
    createdAt: new Date().toISOString()
  });
  
  // UNIFIED: Window manager handles title setting
  
  // Load the appropriate HTML file based on window type
  if (id === 'main' || (managed.meta && managed.meta.isMain)) {
    managed.window.loadFile('index.html');
  } else {
    managed.window.loadFile('window.html');
  }
  
  return { id: managed.id, title: managed.meta.title, isMain: managed.meta.isMain };
});

ipcMain.handle('window-manager:close', (event, id) => {
  if (id === 'main') return false; // Prevent closing main window from UI
  manager.closeWindow(id);
  return true;
});

ipcMain.handle('window-manager:list', async () => {
  return await manager.listWindows();
});

ipcMain.handle('window-manager:rename', (event, { id, title }) => {
  // The renameWindow method now handles both metadata and window title updates
  manager.renameWindow(id, title);
  return true;
});

ipcMain.handle('window-manager:stats', () => {
  return manager.getWindowStats();
});

ipcMain.handle('window-manager:debug', () => {
  const stats = manager.getWindowStats();
  const allMeta = manager.getAllWindowMeta();
  const activeWindows = Array.from(manager.windows.keys());
  
  return {
    stats,
    allMeta,
    activeWindows,
    registeredIds: manager.registry.getAllWindowIds(),
  };
});

ipcMain.handle('window-manager:current-window', (event) => {
  const webContents = event.sender;
  const browserWindow = require('electron').BrowserWindow.fromWebContents(webContents);
  
  // Find the managed window that corresponds to this BrowserWindow
  for (const [id, managed] of manager.windows) {
    if (managed.window === browserWindow) {
      return {
        id: managed.id,
        title: managed.meta.title,
        isMain: !!managed.meta.isMain,
        meta: managed.meta,
      };
    }
  }
  
  return null;
});

ipcMain.handle('window-manager:focus-main', () => {
  const mainWindow = manager.getWindow('main');
  if (mainWindow && !mainWindow.window.isDestroyed()) {
    mainWindow.window.focus();
    mainWindow.window.show();
    return true;
  }
  return false;
});

ipcMain.handle('window-manager:save-state', (event, id) => {
  if (id) {
    return manager.saveWindowState(id);
  } else {
    return manager.saveAllWindowStates();
  }
});

ipcMain.handle('window-manager:force-save', () => {
  return manager.saveAllWindowStates();
});

ipcMain.handle('window-manager:get-displays', async () => {
  return await manager.getDisplayInfo();
});

ipcMain.handle('window-manager:move-to-display', (event, { windowId, displayId, bounds }) => {
  const managed = manager.getWindow(windowId);
  if (managed && !managed.window.isDestroyed()) {
    const safeBounds = manager.getSafeBounds(displayId, bounds);
    const success = manager.setWindowBounds(managed.window, safeBounds);
    return { success, bounds: success ? safeBounds : null };
  }
  return { success: false, error: 'Window not found or destroyed' };
});

// Z-order management IPC handlers
ipcMain.handle('window-manager:restore-z-order', () => {
  return manager.restoreZOrder();
});

ipcMain.handle('window-manager:bring-to-top', (event, id) => {
  return manager.bringWindowToTop(id);
});

ipcMain.handle('window-manager:set-always-on-top', (event, { id, alwaysOnTop }) => {
  return manager.setWindowAlwaysOnTop(id, alwaysOnTop);
});

ipcMain.handle('window-manager:get-z-order-info', () => {
  return manager.getZOrderInfo();
});

// Menu bar visibility IPC handlers
ipcMain.handle('window-manager:set-menu-bar-visibility', (event, { id, visible }) => {
  return manager.setWindowMenuBarVisibility(id, visible);
});

ipcMain.handle('window-manager:get-menu-bar-visibility', (event, id) => {
  return manager.getWindowMenuBarVisibility(id);
});

// Clipboard functionality
ipcMain.handle('clipboard:write-text', (event, text) => {
  try {
    clipboard.writeText(text);
    return { success: true };
  } catch (error) {
    console.error('Clipboard write error:', error);
    return { success: false, error: error.message };
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
}); 