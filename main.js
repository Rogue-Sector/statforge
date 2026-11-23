const { app, BrowserWindow, ipcMain, clipboard, ClipboardItem, dialog, nativeTheme, shell } = require('electron');
const path = require('path');
const fs = require('fs');

const libraryFile = () => path.join(app.getPath('userData'), 'library.json');

function createWindow() {
  nativeTheme.themeSource = 'dark';
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1080,
    minHeight: 640,
    title: 'Statblock Builder',
    backgroundColor: '#0f1626',
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.removeMenu();
  // Links open in the real browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.loadFile(path.join(__dirname, 'src', 'index.html'));
}

ipcMain.handle('library:load', () => {
  try {
    return JSON.parse(fs.readFileSync(libraryFile(), 'utf8'));
  } catch {
    return null;
  }
});

ipcMain.handle('library:save', (_e, data) => {
  const file = libraryFile();
  const tmp = `${file}.tmp`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, file);
  return true;
});

// Electron's clipboard is the async W3C-style API: write() takes ClipboardItems and returns a
// promise. Awaiting it means a failed write reaches the app as "Copy failed", not a false "Copied".
ipcMain.handle('clipboard:write', async (_e, { text, html }) => {
  await clipboard.write([new ClipboardItem({ 'text/plain': text, 'text/html': html })]);
  return true;
});

ipcMain.handle('file:export', async (e, { suggestedName, data }) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: 'Export monsters',
    defaultPath: suggestedName,
    filters: [{ name: 'Statblock Builder monsters', extensions: ['json'] }],
  });
  if (canceled || !filePath) return false;
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  return true;
});

ipcMain.handle('file:import', async (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: 'Import monsters',
    properties: ['openFile'],
    filters: [{ name: 'Statblock Builder monsters', extensions: ['json'] }],
  });
  if (canceled || !filePaths.length) return null;
  return JSON.parse(fs.readFileSync(filePaths[0], 'utf8'));
});

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
