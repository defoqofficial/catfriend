const { app, BrowserWindow, ipcMain, screen, globalShortcut } = require('electron');
const path = require('path');
const { exec } = require('child_process');

let mainWindow;
let timer;
let mousePollingInterval;
let isCatActive = false;
let windowsInterval;

// Using a 5-second debug timer
const TIMER_DURATION = 5000; 

function createWindow() {
  const { width, height } = screen.getPrimaryDisplay().bounds;

  mainWindow = new BrowserWindow({
    width: width,
    height: height,
    x: 0,
    y: 0,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    }
  });

  // Ignore mouse events by default so user can click through the transparent fullscreen window
  mainWindow.setIgnoreMouseEvents(true, { forward: true });

  mainWindow.loadFile('index.html');
  
  // Stream open windows from high-speed C# tracker
  const trackerProcess = require('child_process').spawn('WindowTracker.exe', [], { cwd: __dirname });
  let dataBuffer = '';
  trackerProcess.stdout.on('data', (data) => {
    dataBuffer += data.toString();
    let parts = dataBuffer.split('\n');
    dataBuffer = parts.pop();
    for (let part of parts) {
      if (!part.trim()) continue;
      try {
        const windows = JSON.parse(part.trim());
        if (mainWindow) {
          mainWindow.webContents.send('windows-data', windows);
        }
      } catch(e) {}
    }
  });
  app.on('will-quit', () => {
    if (trackerProcess) trackerProcess.kill();
    globalShortcut.unregisterAll();
  });

  ipcMain.on('drag-mouse', (event, { x, y }) => {
    if (trackerProcess && trackerProcess.stdin) {
      trackerProcess.stdin.write(`MOUSE:${Math.round(x)}:${Math.round(y)}\n`);
    }
  });

  ipcMain.on('move-window', (event, { hwnd, x, y }) => {
    if (trackerProcess && trackerProcess.stdin) {
      trackerProcess.stdin.write(`WINDOW:${hwnd}:${Math.round(x)}:${Math.round(y)}\n`);
    }
  });

  ipcMain.on('close-window', (event, { hwnd }) => {
    if (trackerProcess && trackerProcess.stdin) {
      trackerProcess.stdin.write(`CLOSE:${hwnd}\n`);
    }
  });

  startTimer();
}

function startMousePolling() {
  if (mousePollingInterval) clearInterval(mousePollingInterval);
  mousePollingInterval = setInterval(() => {
    if (mainWindow && isCatActive) {
      const point = screen.getCursorScreenPoint();
      mainWindow.webContents.send('mouse-position', point);
    }
  }, 16); // ~60fps update rate
}

function stopMousePolling() {
  if (mousePollingInterval) {
    clearInterval(mousePollingInterval);
    mousePollingInterval = null;
  }
}

function startTimer() {
  if (timer) clearTimeout(timer);
  isCatActive = false;
  stopMousePolling();
  
  timer = setTimeout(() => {
    if (mainWindow) {
      isCatActive = true;
      startMousePolling();
      mainWindow.webContents.send('show-cat');
    }
  }, TIMER_DURATION);
}

app.whenReady().then(() => {
  createWindow();
  
  globalShortcut.register('CommandOrControl+Shift+S', () => {
    if (mainWindow) mainWindow.webContents.send('toggle-draw-mode');
  });
  
  globalShortcut.register('CommandOrControl+Shift+H', () => {
    if (mainWindow) mainWindow.webContents.send('toggle-shelves-visibility');
  });

  globalShortcut.register('CommandOrControl+Shift+C', () => {
    if (mainWindow) mainWindow.webContents.send('clear-shelves');
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

ipcMain.on('reset-timer', () => {
  startTimer();
  // Ensure we go back to ignoring mouse events when cat is hidden
  mainWindow.setIgnoreMouseEvents(true, { forward: true });
});

ipcMain.on('set-ignore-mouse-events', (event, ignore, options) => {
  if (mainWindow) {
    mainWindow.setIgnoreMouseEvents(ignore, options);
  }
});
