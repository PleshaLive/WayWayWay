const { app, BrowserWindow } = require('electron');
const path = require('path');

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    icon: path.join(__dirname, 'assets', 'icon.ico'), // Путь к вашей иконке
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  // Загружаем страницу админки (можете заменить на settings.html или другую)
  win.loadURL('http://localhost:2727/admin');

  // Для отладки можно открыть DevTools:
  // win.webContents.openDevTools({ mode: 'detach' });
}

app.whenReady().then(() => {
  // Запускаем сервер (он должен слушать порт 2727)
  require('./server.js');

  // Задержка, чтобы сервер успел запуститься
  setTimeout(createWindow, 3000);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
