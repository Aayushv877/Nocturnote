import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import fs from 'fs/promises'
import icon from '../../resources/icon.png?asset'

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    show: false,
    frame: false, // Disables native window chrome
    autoHideMenuBar: true,
    backgroundColor: '#1e1e2e',
    icon: icon,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for dev or load file for prod
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // --- Window Control Handlers ---
  ipcMain.on('window-minimize', () => mainWindow.minimize())
  ipcMain.on('window-maximize', () => {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize()
    } else {
      mainWindow.maximize()
    }
  })
  ipcMain.on('window-close', () => mainWindow.close())
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.electron')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // --- File I/O Handlers ---

  // Handle Save
  ipcMain.handle('save-file', async (_, { content, filePath }) => {
    try {
      let targetPath = filePath
      // If no path provided, show Save Dialog
      if (!targetPath) {
        const { canceled, filePath: savePath } = await dialog.showSaveDialog({
          title: 'Save Note',
          defaultPath: 'Untitled.txt',
          filters: [{ name: 'Text Files', extensions: ['txt', 'md'] }]
        })
        if (canceled) return { success: false }
        targetPath = savePath
      }

      await fs.writeFile(targetPath, content, 'utf-8')
      return { success: true, filePath: targetPath }
    } catch (error) {
      console.error(error)
      return { success: false, error: 'Failed to save' }
    }
  })

  // Handle Open
  ipcMain.handle('open-file', async () => {
    try {
      const { canceled, filePaths } = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [{ name: 'Text Files', extensions: ['txt', 'md'] }]
      })

      if (canceled || filePaths.length === 0) return { canceled: true }

      const content = await fs.readFile(filePaths[0], 'utf-8')
      return { canceled: false, filePath: filePaths[0], content }
    } catch (error) {
      console.error(error)
      return { canceled: true, error: 'Failed to open' }
    }
  })

  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
