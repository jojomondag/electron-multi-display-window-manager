const { BrowserWindow, screen } = require('electron');
const Store = require('electron-store');

class ManagedWindow {
  constructor(id, browserWindow, meta = {}) {
    this.id = id;
    this.window = browserWindow;
    this.meta = meta;
  }
}

class WindowRegistry {
  constructor() {
    this.store = new Store({ name: 'window-registry' });
    this.REGISTRY_KEY = 'window-registry';
    this.COUNTER_KEY = 'window-counter';
  }

  // Get the next unique window ID
  getNextWindowId() {
    const counter = this.store.get(this.COUNTER_KEY, 0);
    const newId = `win${counter + 1}`;
    this.store.set(this.COUNTER_KEY, counter + 1);
    return newId;
  }

  // Register a new window in the registry
  registerWindow(id, meta = {}) {
    const registry = this.getRegistry();
    registry[id] = {
      id,
      ...meta,
      registeredAt: new Date().toISOString(),
    };
    this.setRegistry(registry);
  }

  // Unregister a window from the registry
  unregisterWindow(id) {
    if (id === 'main') return; // Never unregister main window
    const registry = this.getRegistry();
    delete registry[id];
    this.setRegistry(registry);
  }

  // Get all registered windows
  getRegistry() {
    return this.store.get(this.REGISTRY_KEY, {});
  }

  // Set the registry
  setRegistry(registry) {
    this.store.set(this.REGISTRY_KEY, registry);
  }

  // Get all registered window IDs
  getAllWindowIds() {
    return Object.keys(this.getRegistry());
  }

  // Check if a window ID exists in registry
  isWindowRegistered(id) {
    const registry = this.getRegistry();
    return id in registry;
  }

  // Get window metadata from registry
  getWindowMeta(id) {
    const registry = this.getRegistry();
    return registry[id] || null;
  }

  // Update window metadata in registry
  updateWindowMeta(id, meta) {
    const registry = this.getRegistry();
    if (registry[id]) {
      registry[id] = { ...registry[id], ...meta };
      this.setRegistry(registry);
    }
  }
}

class WindowManager {
  constructor(options = {}) {
    this.windows = new Map(); // id → ManagedWindow (active windows)
    this.store = new Store({ name: options.storeName || 'window-state' });
    this.registry = new WindowRegistry(); // Persistent window registry
    this.WINDOW_LIST_KEY = 'window-list'; // Legacy key for backward compatibility
    this.isQuitting = false; // Track if app is quitting
    this.zOrderCounter = 0; // Counter for tracking window stacking order
    this.focusOrder = new Map(); // Track focus order: id → timestamp
  }

  // Set quitting flag
  setQuitting(quitting = true) {
    this.isQuitting = quitting;
  }

  // Generate a unique window ID
  generateWindowId() {
    return this.registry.getNextWindowId();
  }

  // Get the persistent list of window metadata (legacy method for backward compatibility)
  getWindowList() {
    // Convert registry to list format for backward compatibility
    const registry = this.registry.getRegistry();
    return Object.values(registry);
  }

  // Set the persistent list of window metadata (legacy method for backward compatibility)
  setWindowList(list) {
    // Convert list to registry format
    const registry = {};
    for (const item of list) {
      registry[item.id] = item;
    }
    this.registry.setRegistry(registry);
  }

  // Add or update a window in the persistent registry
  upsertWindowMeta(id, meta) {
    if (this.registry.isWindowRegistered(id)) {
      this.registry.updateWindowMeta(id, meta);
    } else {
      this.registry.registerWindow(id, meta);
    }
  }

  // Remove a window from the persistent registry
  removeWindowMeta(id) {
    if (id === 'main') return; // Never remove main window metadata
    if (this.isQuitting) return; // Don't remove windows during quit
    this.registry.unregisterWindow(id);
  }

  // Get state for a window by ID
  getWindowState(id, defaults = {}) {
    const state = this.store.get(id, defaults);
    return state;
  }

  // Save both state and metadata for a window by ID
  saveWindowStateAndMeta(id, win, managed, forceFlag = false) {
    if (win.isDestroyed()) return;
    const bounds = win.getBounds();
    const display = screen.getDisplayMatching(bounds);
    
    // Detect if window is likely snapped by Windows
    const snapInfo = this.detectWindowSnap(bounds, display);
    const isNativeSnap = this.isLikelyWindowsNativeSnap(bounds, display);
    
    // Get current z-order information
    const focusTimestamp = this.focusOrder.get(id) || 0;
    const isAlwaysOnTop = win.isAlwaysOnTop();
    
    const stateToSave = {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      isMaximized: win.isMaximized(),
      isFullScreen: win.isFullScreen(),
      displayId: display.id,
      isSnapped: snapInfo.isSnapped,
      snapType: snapInfo.snapType,
      workArea: snapInfo.workArea, // Store work area for accurate restoration
      nativeSnap: isNativeSnap, // Mark if this was positioned by Windows native snap
      zOrder: focusTimestamp, // Store focus timestamp for z-order restoration
      isAlwaysOnTop: isAlwaysOnTop, // Store always-on-top state
      isThirdParty: snapInfo.isThirdParty, // Mark third-party snap tools
    };

    // DEBUG: Log snap detection and save operation
    console.log(`Saving window ${id} state: (${bounds.x}, ${bounds.y}) ${bounds.width}×${bounds.height}`);
    if (snapInfo.isSnapped) {
      console.log(`Window ${id} snap detected - Type: ${snapInfo.snapType}, Third-party: ${snapInfo.isThirdParty}`);
    } else {
      console.log(`Window ${id} not detected as snapped`);
    }
    

    
    // Save window state
    this.store.set(id, stateToSave);
    
    // Save metadata
    if (managed && managed.meta) {
      this.upsertWindowMeta(id, managed.meta);
    }
  }

  // Detect if a window is likely snapped - enhanced for third-party snap tools
  detectWindowSnap(bounds, display) {
    const workArea = display.workArea;
    const displayBounds = display.bounds;
    
    // First check for exact Windows Snap Layout matches
    const snapCalculations = this.getWindowsSnapCalculations(workArea);
    
    // Check against Windows' exact snap calculations
    const isLeftHalf = this.boundsMatch(bounds, snapCalculations.leftHalf);
    const isRightHalf = this.boundsMatch(bounds, snapCalculations.rightHalf);
    const isTopHalf = this.boundsMatch(bounds, snapCalculations.topHalf);
    const isBottomHalf = this.boundsMatch(bounds, snapCalculations.bottomHalf);
    const isTopLeft = this.boundsMatch(bounds, snapCalculations.topLeft);
    const isTopRight = this.boundsMatch(bounds, snapCalculations.topRight);
    const isBottomLeft = this.boundsMatch(bounds, snapCalculations.bottomLeft);
    const isBottomRight = this.boundsMatch(bounds, snapCalculations.bottomRight);
    const isLeftThird = this.boundsMatch(bounds, snapCalculations.leftThird);
    const isMiddleThird = this.boundsMatch(bounds, snapCalculations.middleThird);
    const isRightThird = this.boundsMatch(bounds, snapCalculations.rightThird);
    const isLeftTwoThirds = this.boundsMatch(bounds, snapCalculations.leftTwoThirds);
    const isRightTwoThirds = this.boundsMatch(bounds, snapCalculations.rightTwoThirds);
    
    let snapType = 
      isLeftHalf ? 'left-half' :
      isRightHalf ? 'right-half' :
      isTopHalf ? 'top-half' :
      isBottomHalf ? 'bottom-half' :
      isTopLeft ? 'top-left' :
      isTopRight ? 'top-right' :
      isBottomLeft ? 'bottom-left' :
      isBottomRight ? 'bottom-right' :
      isLeftThird ? 'left-third' :
      isMiddleThird ? 'middle-third' :
      isRightThird ? 'right-third' :
      isLeftTwoThirds ? 'left-two-thirds' :
      isRightTwoThirds ? 'right-two-thirds' :
      null;
    
    // ENHANCED: Check for third-party snap patterns (like Windows StickySnap)
    if (!snapType) {
      const tolerance = 10; // Allow some variance for third-party tools
      
      // Check if positioned at display edges (common for snap tools)
      const atLeftEdge = Math.abs(bounds.x - displayBounds.x) <= tolerance;
      const atRightEdge = Math.abs((bounds.x + bounds.width) - (displayBounds.x + displayBounds.width)) <= tolerance;
      const atTopEdge = Math.abs(bounds.y - displayBounds.y) <= tolerance;
      const atBottomEdge = Math.abs((bounds.y + bounds.height) - (displayBounds.y + displayBounds.height)) <= tolerance;
      
      // Check for approximate half sizes (third-party tools may use slightly different calculations)
      const isApproxHalfWidth = Math.abs(bounds.width - Math.floor(workArea.width / 2)) <= tolerance;
      const isApproxHalfHeight = Math.abs(bounds.height - Math.floor(workArea.height / 2)) <= tolerance;
      const isFullHeight = Math.abs(bounds.height - workArea.height) <= tolerance;
      const isFullWidth = Math.abs(bounds.width - workArea.width) <= tolerance;
      
      // Detect third-party snap patterns
      if (atLeftEdge && isApproxHalfWidth && isFullHeight) {
        snapType = 'third-party-left-half';
      } else if (atRightEdge && isApproxHalfWidth && isFullHeight) {
        snapType = 'third-party-right-half';
      } else if (atTopEdge && isFullWidth && isApproxHalfHeight) {
        snapType = 'third-party-top-half';
      } else if (atBottomEdge && isFullWidth && isApproxHalfHeight) {
        snapType = 'third-party-bottom-half';
      } else if (atLeftEdge && atTopEdge && isApproxHalfWidth && isApproxHalfHeight) {
        snapType = 'third-party-top-left';
      } else if (atRightEdge && atTopEdge && isApproxHalfWidth && isApproxHalfHeight) {
        snapType = 'third-party-top-right';
      } else if (atLeftEdge && atBottomEdge && isApproxHalfWidth && isApproxHalfHeight) {
        snapType = 'third-party-bottom-left';
      } else if (atRightEdge && atBottomEdge && isApproxHalfWidth && isApproxHalfHeight) {
        snapType = 'third-party-bottom-right';
      }
    }
    
    return {
      isSnapped: snapType !== null,
      snapType: snapType,
      workArea: workArea, // Store work area for restoration
      isThirdParty: snapType?.startsWith('third-party-') || false
    };
  }

   // Check if two bounds objects match exactly (for Windows Snap Layout detection)
   boundsMatch(bounds1, bounds2) {
     return bounds1.x === bounds2.x &&
            bounds1.y === bounds2.y &&
            bounds1.width === bounds2.width &&
            bounds1.height === bounds2.height;
   }

   // Detect if a window position is likely the result of Windows native snap layouts
   isLikelyWindowsNativeSnap(bounds, display) {
     const workArea = display.workArea;
     const snapCalculations = this.getWindowsSnapCalculations(workArea);
     
     // Check if the bounds exactly match any Windows snap layout
     const matchesSnapLayout = Object.values(snapCalculations).some(snapBounds => 
       this.boundsMatch(bounds, snapBounds)
     );
     
     // Additional heuristics for Windows native snap:
     // 1. Position aligns exactly with work area edges
     // 2. Size is exactly half, third, or quarter of work area
     const alignsWithWorkArea = 
       bounds.x === workArea.x || 
       bounds.x === workArea.x + Math.floor(workArea.width / 2) ||
       bounds.x === workArea.x + Math.floor(workArea.width / 3) ||
       bounds.x === workArea.x + 2 * Math.floor(workArea.width / 3);
       
     const alignsWithWorkAreaY = 
       bounds.y === workArea.y || 
       bounds.y === workArea.y + Math.floor(workArea.height / 2);
     
     return matchesSnapLayout && alignsWithWorkArea && alignsWithWorkAreaY;
   }

   // Get Windows' exact snap layout calculations
   getWindowsSnapCalculations(workArea) {
     // Windows uses these exact formulas for snap layouts
     return {
       // Half divisions
       leftHalf: {
         x: workArea.x,
         y: workArea.y,
         width: Math.floor(workArea.width / 2),
         height: workArea.height
       },
       rightHalf: {
         x: workArea.x + Math.floor(workArea.width / 2),
         y: workArea.y,
         width: workArea.width - Math.floor(workArea.width / 2),
         height: workArea.height
       },
       topHalf: {
         x: workArea.x,
         y: workArea.y,
         width: workArea.width,
         height: Math.floor(workArea.height / 2)
       },
       bottomHalf: {
         x: workArea.x,
         y: workArea.y + Math.floor(workArea.height / 2),
         width: workArea.width,
         height: workArea.height - Math.floor(workArea.height / 2)
       },
       // Quarter divisions
       topLeft: {
         x: workArea.x,
         y: workArea.y,
         width: Math.floor(workArea.width / 2),
         height: Math.floor(workArea.height / 2)
       },
       topRight: {
         x: workArea.x + Math.floor(workArea.width / 2),
         y: workArea.y,
         width: workArea.width - Math.floor(workArea.width / 2),
         height: Math.floor(workArea.height / 2)
       },
       bottomLeft: {
         x: workArea.x,
         y: workArea.y + Math.floor(workArea.height / 2),
         width: Math.floor(workArea.width / 2),
         height: workArea.height - Math.floor(workArea.height / 2)
       },
       bottomRight: {
         x: workArea.x + Math.floor(workArea.width / 2),
         y: workArea.y + Math.floor(workArea.height / 2),
         width: workArea.width - Math.floor(workArea.width / 2),
         height: workArea.height - Math.floor(workArea.height / 2)
       },
       // Third divisions (Windows 11 specific)
       leftThird: {
         x: workArea.x,
         y: workArea.y,
         width: Math.floor(workArea.width / 3),
         height: workArea.height
       },
       middleThird: {
         x: workArea.x + Math.floor(workArea.width / 3),
         y: workArea.y,
         width: Math.floor(workArea.width / 3),
         height: workArea.height
       },
       rightThird: {
         x: workArea.x + 2 * Math.floor(workArea.width / 3),
         y: workArea.y,
         width: workArea.width - 2 * Math.floor(workArea.width / 3),
         height: workArea.height
       },
       // Two-thirds divisions
       leftTwoThirds: {
         x: workArea.x,
         y: workArea.y,
         width: 2 * Math.floor(workArea.width / 3),
         height: workArea.height
       },
       rightTwoThirds: {
         x: workArea.x + Math.floor(workArea.width / 3),
         y: workArea.y,
         width: workArea.width - Math.floor(workArea.width / 3),
         height: workArea.height
       }
     };
   }

   // Calculate bounds for a given snap type and work area using Windows' exact algorithms
   calculateSnapBounds(snapType, workArea) {
     const snapCalculations = this.getWindowsSnapCalculations(workArea);
     
     switch (snapType) {
       case 'left-half':
         return snapCalculations.leftHalf;
       case 'right-half':
         return snapCalculations.rightHalf;
       case 'top-half':
         return snapCalculations.topHalf;
       case 'bottom-half':
         return snapCalculations.bottomHalf;
       case 'top-left':
         return snapCalculations.topLeft;
       case 'top-right':
         return snapCalculations.topRight;
       case 'bottom-left':
         return snapCalculations.bottomLeft;
       case 'bottom-right':
         return snapCalculations.bottomRight;
       case 'left-third':
         return snapCalculations.leftThird;
       case 'middle-third':
         return snapCalculations.middleThird;
       case 'right-third':
         return snapCalculations.rightThird;
       case 'left-two-thirds':
         return snapCalculations.leftTwoThirds;
       case 'right-two-thirds':
         return snapCalculations.rightTwoThirds;
       default:
         return null;
     }
      }



   // SINGLE SOURCE OF TRUTH: The only method for setting window bounds
   // SNAP-AWARE: Preserves exact bounds for snap restoration
   setWindowBounds(win, bounds, preserveExact = false) {
     if (win.isDestroyed()) return false;
     
     let safeBounds;
     
     if (preserveExact) {
       // CRITICAL: For snap restoration, preserve exact dimensions
       safeBounds = {
         x: Math.round(Number.isFinite(bounds.x) ? bounds.x : 100),
         y: Math.round(Number.isFinite(bounds.y) ? bounds.y : 100),
         width: Math.round(Number.isFinite(bounds.width) ? bounds.width : 800),
         height: Math.round(Number.isFinite(bounds.height) ? bounds.height : 600)
       };
       console.log(`setWindowBounds: preserving exact bounds (${safeBounds.x}, ${safeBounds.y}) ${safeBounds.width}×${safeBounds.height}`);
     } else {
       // Apply size constraints for new windows
       safeBounds = {
         x: Math.round(Number.isFinite(bounds.x) ? bounds.x : 100),
         y: Math.round(Number.isFinite(bounds.y) ? bounds.y : 100),
         width: Math.max(200, Math.round(Number.isFinite(bounds.width) ? bounds.width : 800)),
         height: Math.max(150, Math.round(Number.isFinite(bounds.height) ? bounds.height : 600))
       };
     }
     
     try {
       // Single, reliable method - Windows handles snap states internally
       win.setBounds(safeBounds, true);
       return true;
     } catch (error) {
       console.error('Error setting window bounds:', error);
       return false;
     }
   }

   // Get detailed information about all displays
   async getDisplayInfo() {
     const displays = screen.getAllDisplays();
     const primaryDisplay = screen.getPrimaryDisplay();
     
     // Get manufacturer information (Windows only)
     const manufacturerInfo = await this.getDisplayManufacturerInfo();
     
     return displays.map((display, index) => {
       // Try to get more detailed display information
       const hasGenericLabel = !display.label || 
         display.label.match(/^(Display \d+|\d+|Generic PnP Monitor)$/i);
       
       // Try to get manufacturer name
       const displayIndex = index + 1; // WMI usually starts from 1
       const manufacturerData = manufacturerInfo[displayIndex];
       const realDisplayName = manufacturerData ? manufacturerData.fullName : null;
       const hasRealName = !!realDisplayName;
       
       // Extract additional properties that might contain manufacturer info
       const displayProps = {
         id: display.id,
         label: display.label || `Display ${display.id}`,
         realName: realDisplayName,
         manufacturer: manufacturerData?.manufacturer,
         model: manufacturerData?.model,
         bounds: display.bounds,
         workArea: display.workArea,
         scaleFactor: display.scaleFactor,
         rotation: display.rotation,
         isPrimary: display.id === primaryDisplay.id,
         colorSpace: display.colorSpace,
         colorDepth: display.colorDepth,
         hasGenericLabel: hasGenericLabel,
         hasRealName: hasRealName,
         // Calculate usable positioning info
         positioning: {
           centerX: display.workArea.x + Math.floor(display.workArea.width / 2),
           centerY: display.workArea.y + Math.floor(display.workArea.height / 2),
           safeZone: {
             x: display.workArea.x,
             y: display.workArea.y,
             width: display.workArea.width,
             height: display.workArea.height
           }
         }
       };
       
       console.log(`Display ${display.id}:`, {
         label: display.label,
         realName: realDisplayName,
         manufacturer: manufacturerData?.manufacturer,
         model: manufacturerData?.model
       });
       
       return displayProps;
     });
   }

   // Get safe bounds for a window on a specific display
   // SNAP-AWARE: Preserves exact snap positions and sizes
   getSafeBounds(displayId, preferredBounds = {}, isRestoration = false) {
     const displays = screen.getAllDisplays();
     const targetDisplay = displays.find(d => d.id === displayId) || screen.getPrimaryDisplay();
     const workArea = targetDisplay.workArea;
     
     let width, height, x, y;
     
     if (isRestoration) {
       // CRITICAL: During restoration, preserve EXACT saved dimensions
       // No size constraints or modifications for restored windows
       width = preferredBounds.width || 800;
       height = preferredBounds.height || 600;
       x = preferredBounds.x;
       y = preferredBounds.y;
       
       console.log(`Restoration: preserving exact bounds (${x}, ${y}) ${width}×${height}`);
     } else {
       // For new windows, apply size constraints
       width = Math.max(200, preferredBounds.width || 800);
       height = Math.max(150, preferredBounds.height || 600);
       
       // Only constrain size if it exceeds the work area
       if (width > workArea.width) width = workArea.width;
       if (height > workArea.height) height = workArea.height;
       
       x = preferredBounds.x;
       y = preferredBounds.y;
       
       // Position handling for new windows
       if (typeof x !== 'number' || typeof y !== 'number') {
         x = workArea.x + Math.floor((workArea.width - width) / 2);
         y = workArea.y + Math.floor((workArea.height - height) / 2);
       } else {
         // For new windows, ensure they fit within the work area
         x = Math.max(workArea.x, Math.min(x, workArea.x + workArea.width - width));
         y = Math.max(workArea.y, Math.min(y, workArea.y + workArea.height - height));
       }
     }
     
     return { x, y, width, height };
   }

   // Create a new window with state persistence and display support
  createWindow(id, options = {}, meta = {}) {
    const state = this.getWindowState(id, {
      width: options.width || 800,
      height: options.height || 600,
    });

    // Prioritize saved state completely for existing windows
    const hasSavedState = state.x !== undefined && state.y !== undefined;
    const preferredBounds = hasSavedState ? {
      x: state.x,
      y: state.y,
      width: state.width || options.width || 800,
      height: state.height || options.height || 600
    } : {
      x: options.x,
      y: options.y,
      width: options.width || 800,
      height: options.height || 600
    };
    
    // For initial window creation, use minimal safe bounds to avoid conflicts
    // The precise restoration will happen in restoreWindowState()
    const targetDisplayId = state.displayId || screen.getPrimaryDisplay().id;
    const displays = screen.getAllDisplays();
    const targetDisplay = displays.find(d => d.id === targetDisplayId) || screen.getPrimaryDisplay();
    
    // Use minimal safe bounds for initial creation
    const initialBounds = hasSavedState ? {
      x: targetDisplay.workArea.x + 50, // Small offset to avoid issues
      y: targetDisplay.workArea.y + 50,
      width: preferredBounds.width,
      height: preferredBounds.height
    } : this.getSafeBounds(targetDisplayId, preferredBounds, false);

    console.log(`Creating window ${id}:`);
    console.log(`  Saved state: x=${state.x}, y=${state.y}, w=${state.width}, h=${state.height}`);
    console.log(`  hasSavedState: ${hasSavedState}`);
    console.log(`  targetDisplay: ${targetDisplay.id} (${targetDisplay.bounds.x}, ${targetDisplay.bounds.y})`);
    console.log(`  preferredBounds: (${preferredBounds.x}, ${preferredBounds.y}) ${preferredBounds.width}×${preferredBounds.height}`);
    console.log(`  initialBounds: (${initialBounds.x}, ${initialBounds.y}) ${initialBounds.width}×${initialBounds.height}`);
    console.log(`  isSnapped: ${state.isSnapped}, snapType: ${state.snapType}`);

    // Create options without positioning to avoid conflicts
    const { x: optX, y: optY, width: optWidth, height: optHeight, show, ...cleanOptions } = options;

    const win = new BrowserWindow({
      ...cleanOptions,
      ...initialBounds,
      show: false, // Never show immediately - we'll control this precisely
    });

    // ENHANCED STATE RESTORATION: Handles both Windows and third-party snaps
    const restoreWindowState = () => {
      if (win.isDestroyed()) return;

      try {
        // Apply window state first (maximize/fullscreen)
        if (state.isMaximized) {
          win.maximize();
        } else if (state.isFullScreen) {
          win.setFullScreen(true);
        } else if (hasSavedState) {
          // ENHANCED: Restore any window with saved state (snapped or not)
          console.log(`Restoring window ${id} with saved state`);
          console.log(`Saved state: (${state.x}, ${state.y}) ${state.width}×${state.height}`);
          console.log(`Display ID: ${state.displayId}, Snapped: ${state.isSnapped}, Type: ${state.snapType}`);
          
          // Get the target display for restoration
          const displays = screen.getAllDisplays();
          const targetDisplay = displays.find(d => d.id === state.displayId) || screen.getPrimaryDisplay();
          
          // For snapped windows, check if we need to recalculate
          if (state.isSnapped && !state.snapType?.startsWith('third-party-')) {
            const workAreaChanged = !state.workArea || 
              JSON.stringify(state.workArea) !== JSON.stringify(targetDisplay.workArea);
            
            if (workAreaChanged) {
              // Recalculate Windows snap positions for changed work area
              const newSnapBounds = this.calculateSnapBounds(state.snapType, targetDisplay.workArea);
              if (newSnapBounds) {
                console.log(`Work area changed, recalculating snap bounds for ${state.snapType}`);
                console.log(`New snap bounds: (${newSnapBounds.x}, ${newSnapBounds.y}) ${newSnapBounds.width}×${newSnapBounds.height}`);
                this.setWindowBounds(win, newSnapBounds, true);
              } else {
                console.log(`Fallback to exact saved bounds: (${state.x}, ${state.y}) ${state.width}×${state.height}`);
                this.setWindowBounds(win, { x: state.x, y: state.y, width: state.width, height: state.height }, true);
              }
            } else {
              console.log(`Using exact saved bounds (Windows snap): (${state.x}, ${state.y}) ${state.width}×${state.height}`);
              this.setWindowBounds(win, { x: state.x, y: state.y, width: state.width, height: state.height }, true);
            }
          } else {
            // For non-snapped windows and third-party snaps, always use exact saved bounds
            console.log(`Using exact saved bounds (non-snap/third-party): (${state.x}, ${state.y}) ${state.width}×${state.height}`);
            this.setWindowBounds(win, { x: state.x, y: state.y, width: state.width, height: state.height }, true);
          }
        }
        
        // Show window after positioning
        win.show();
        
      } catch (error) {
        console.error(`Error restoring window state for ${id}:`, error);
        win.show(); // Always show the window
      }
    };

    // Use ready-to-show for proper timing
    win.once('ready-to-show', restoreWindowState);

    const managed = new ManagedWindow(id, win, {
      ...meta,
      createdAt: meta.createdAt || new Date().toISOString(),
      displayId: state.displayId,
      title: meta.title || `Window ${id}`,
      isMain: !!meta.isMain,
    });

    // SINGLE SOURCE OF TRUTH: Unified save system
    let saveTimeout = null;
    const unifiedSave = (immediate = false) => {
      if (win.isDestroyed() || this.windowClosing) return;
      
      if (immediate) {
        // Clear any pending saves and save immediately
        if (saveTimeout) {
          clearTimeout(saveTimeout);
          saveTimeout = null;
        }
        this.saveWindowStateAndMeta(id, win, managed, true);
        return;
      }
      
      // Debounced save - check if it's a snap operation for immediate save
      const bounds = win.getBounds();
      const display = screen.getDisplayMatching(bounds);
      const snapInfo = this.detectWindowSnap(bounds, display);
      
      if (snapInfo.isSnapped) {
        // Snap detected - save immediately
        console.log(`Window ${id} snap detected (${snapInfo.snapType}), saving immediately`);
        unifiedSave(true);
        return;
      }
      
      // Regular movement - use debounced save
      if (saveTimeout) clearTimeout(saveTimeout);
      saveTimeout = setTimeout(() => {
        if (!win.isDestroyed() && !this.windowClosing) {
          this.saveWindowStateAndMeta(id, win, managed);
        }
      }, 1000); // Single consistent delay
    };

    // Z-order tracking - update focus order when window gains focus
    const updateZOrder = () => {
      this.zOrderCounter++;
      this.focusOrder.set(id, this.zOrderCounter);
      unifiedSave(true); // Save z-order changes immediately
    };

    // CONSOLIDATED EVENT HANDLERS: Single save system for all events
    // User-initiated state changes - save immediately
    win.on('close', () => unifiedSave(true));
    win.on('maximize', () => unifiedSave(true));
    win.on('unmaximize', () => unifiedSave(true));
    win.on('enter-full-screen', () => unifiedSave(true));
    win.on('leave-full-screen', () => unifiedSave(true));
    win.on('restore', () => unifiedSave(true));
    
    // Movement events - intelligent save (immediate for snaps, debounced for regular moves)
    win.on('moved', () => unifiedSave(false));
    win.on('resized', () => unifiedSave(false));
    
    // Focus events - immediate save for z-order
    win.on('focus', updateZOrder);
    win.on('show', updateZOrder);

    this.windows.set(id, managed);
    this.upsertWindowMeta(id, managed.meta);
    win.on('closed', () => {
      this.windows.delete(id);
      this.removeWindowMeta(id);
    });
    return managed;
  }

  // Force save all current window states and metadata
  forceSaveAllWindows() {
    for (const [id, managed] of this.windows) {
      if (!managed.window.isDestroyed()) {
        this.saveWindowStateAndMeta(id, managed.window, managed, true); // Force save
      }
    }
  }

  // Get statistics about windows
  getWindowStats() {
    const registry = this.registry.getRegistry();
    const activeWindows = this.windows.size;
    const registeredWindows = Object.keys(registry).length;
    const mainWindow = registry.main ? 1 : 0;
    const regularWindows = registeredWindows - mainWindow;
    
    return {
      active: activeWindows,
      registered: registeredWindows,
      main: mainWindow,
      regular: regularWindows,
      nextId: this.registry.getNextWindowId(),
    };
  }

  // Get all window metadata from registry
  getAllWindowMeta() {
    return this.registry.getRegistry();
  }

  // Restore all windows from the persistent registry (except main, which is handled separately)
  restoreAllWindows(createWindowCallback) {
    const registry = this.registry.getRegistry();
    const windowsToRestore = Object.values(registry).filter(meta => meta.id !== 'main');
    
    for (const meta of windowsToRestore) {
      createWindowCallback(meta);
    }
  }

  // Clean up orphaned window states (states without registry entries)
  cleanupOrphanedStates() {
    const registeredIds = this.registry.getAllWindowIds();
    const stateKeys = Object.keys(this.store.store).filter(key => 
      key !== this.WINDOW_LIST_KEY && 
      key.startsWith('win') && 
      !registeredIds.includes(key)
    );
    
    for (const key of stateKeys) {
      this.store.delete(key);
    }
  }

  // Get a window by ID
  getWindow(id) {
    return this.windows.get(id);
  }

  // List all open window IDs
  async listWindows() {
    // Return array of essential window information
    return Array.from(this.windows.values()).map(w => {
      // Try to get saved state first, fall back to live bounds if needed
      const savedState = this.getWindowState(w.id, {});
      const liveBounds = w.window.getBounds();
      
      // Use saved bounds if available and valid, otherwise use live bounds
      const bounds = (savedState.x !== undefined && savedState.y !== undefined && 
                     savedState.width !== undefined && savedState.height !== undefined) 
        ? { x: savedState.x, y: savedState.y, width: savedState.width, height: savedState.height }
        : liveBounds;
        
      const display = screen.getDisplayMatching(bounds);
      const isMaximized = w.window.isMaximized();
      const isFullScreen = w.window.isFullScreen();
      
      return {
        id: w.id,
        title: w.meta.title,
        createdAt: w.meta.createdAt,
        displayId: w.meta.displayId,
        isMain: !!w.meta.isMain,
        // Current window bounds
        bounds: {
          x: bounds.x,
          y: bounds.y,
          width: bounds.width,
          height: bounds.height,
        },
        // Window state
        state: {
          isMaximized,
          isFullScreen,
          isMinimized: w.window.isMinimized(),
          isVisible: w.window.isVisible(),
        },
        // Essential display information
        display: {
          id: display.id,
          bounds: display.bounds,
          scaleFactor: display.scaleFactor,
          rotation: display.rotation,
          primary: display.primary,
          colorSpace: display.colorSpace,
          colorDepth: display.colorDepth,
          label: display.label || `Display ${display.id}`, // Keep display name/label
        },
        // Relative position within display
        relativePosition: {
          x: bounds.x - display.bounds.x,
          y: bounds.y - display.bounds.y,
          percentX: Math.round(((bounds.x - display.bounds.x) / display.bounds.width) * 100),
          percentY: Math.round(((bounds.y - display.bounds.y) / display.bounds.height) * 100),
        },
      };
    });
  }

  closeWindow(id) {
    const managed = this.windows.get(id);
    if (managed) {
      // UNIFIED APPROACH: Simply close the window
      // The 'close' event handler will trigger unifiedSave(true) automatically
      managed.window.close();
    }
  }

  renameWindow(id, newTitle) {
    const managed = this.windows.get(id);
    if (managed && !managed.window.isDestroyed()) {
      managed.meta.title = newTitle;
      // Immediately update the actual window title
      managed.window.setTitle(newTitle);
      // Save the updated metadata
      this.upsertWindowMeta(id, managed.meta);
    }
  }

  // UNIFIED: Save a window's current state immediately
  saveWindowState(id) {
    const managed = this.windows.get(id);
    if (managed && !managed.window.isDestroyed()) {
      // Use the unified save system with immediate flag
      const bounds = managed.window.getBounds();
      const display = screen.getDisplayMatching(bounds);
      this.saveWindowStateAndMeta(id, managed.window, managed, true);
      return true;
    }
    return false;
  }

  // UNIFIED: Save all window states immediately 
  saveAllWindowStates() {
    let savedCount = 0;
    for (const [id, managed] of this.windows) {
      if (!managed.window.isDestroyed()) {
        this.saveWindowStateAndMeta(id, managed.window, managed, true);
        savedCount++;
      }
    }
    return savedCount;
  }

  // Restore z-order for all windows based on saved focus timestamps
  restoreZOrder() {
    // Get all managed windows with their z-order info
    const windowsWithZOrder = [];
    
    for (const [id, managed] of this.windows) {
      if (!managed.window.isDestroyed()) {
        const state = this.getWindowState(id, {});
        windowsWithZOrder.push({
          id,
          window: managed.window,
          zOrder: state.zOrder || 0,
          isAlwaysOnTop: state.isAlwaysOnTop || false
        });
      }
    }
    
    // Sort by z-order (lower numbers = further back)
    windowsWithZOrder.sort((a, b) => a.zOrder - b.zOrder);
    
    // Apply z-order by bringing windows to front in order
    for (const item of windowsWithZOrder) {
      try {
        if (item.isAlwaysOnTop) {
          item.window.setAlwaysOnTop(true);
        } else {
          item.window.moveTop(); // Bring to front in order
        }
      } catch (error) {
        console.warn(`Failed to restore z-order for window ${item.id}:`, error);
      }
    }
    

    return windowsWithZOrder.length;
  }

  // Move a window to the top of the z-order
  bringWindowToTop(id) {
    const managed = this.windows.get(id);
    if (managed && !managed.window.isDestroyed()) {
      managed.window.moveTop();
      // Update focus order tracking
      this.zOrderCounter++;
      this.focusOrder.set(id, this.zOrderCounter);
      this.saveWindowStateAndMeta(id, managed.window, managed);
      return true;
    }
    return false;
  }

  // Set a window to always be on top
  setWindowAlwaysOnTop(id, alwaysOnTop = true) {
    const managed = this.windows.get(id);
    if (managed && !managed.window.isDestroyed()) {
      managed.window.setAlwaysOnTop(alwaysOnTop);
      // Update focus order if bringing to top
      if (alwaysOnTop) {
        this.zOrderCounter++;
        this.focusOrder.set(id, this.zOrderCounter);
      }
      this.saveWindowStateAndMeta(id, managed.window, managed);
      return true;
    }
    return false;
  }

  // Get z-order information for all windows
  getZOrderInfo() {
    const zOrderInfo = [];
    
    for (const [id, managed] of this.windows) {
      if (!managed.window.isDestroyed()) {
        const state = this.getWindowState(id, {});
        const focusTimestamp = this.focusOrder.get(id) || 0;
        
        zOrderInfo.push({
          id,
          title: managed.meta.title,
          zOrder: state.zOrder || 0,
          currentFocusOrder: focusTimestamp,
          isAlwaysOnTop: managed.window.isAlwaysOnTop(),
          isFocused: managed.window.isFocused(),
          isVisible: managed.window.isVisible()
        });
      }
    }
    
    // Sort by current focus order (most recently focused first)
    zOrderInfo.sort((a, b) => b.currentFocusOrder - a.currentFocusOrder);
    
    return zOrderInfo;
  }

  // Get real display manufacturer names using Windows WMI
  async getDisplayManufacturerInfo() {
    // TEMPORARILY DISABLED: This feature was causing UI blocking issues
    // Return empty object immediately to ensure smooth operation
    return {};
  }
}

module.exports = { WindowManager, ManagedWindow }; 