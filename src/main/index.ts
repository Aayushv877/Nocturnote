import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { join, resolve } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import fs from 'fs/promises'
import icon from '../../resources/icon.png?asset'

// State Management
const windowFiles = new Map<number, string>() // windowId -> filePath
const pendingFiles = new Map<number, { content: string; filePath: string }>() // windowId -> fileData

async function loadFileFromArgv(
  argv: string[]
): Promise<{ content: string; filePath: string } | null> {
  // Iterate through arguments to find a valid file path.
  // We skip the first argument (executable path).
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i]
    // Skip flags (arguments starting with -) and the '.' argument often present in dev
    if (!arg.startsWith('-') && arg !== '.') {
      try {
        // Verify it's a file before reading
        const stat = await fs.stat(arg)
        if (stat.isFile()) {
          const content = await fs.readFile(arg, 'utf-8')
          return { content, filePath: resolve(arg) }
        }
      } catch (error) {
        // Ignore errors (not a file, doesn't exist, etc.) and continue searching
        console.log(`Arg '${arg}' is not a loadable file:`, error)
      }
    }
  }
  return null
}

function createWindow(fileData: { content: string; filePath: string } | null = null): void {
  const newWindow = new BrowserWindow({
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

  // Track the file associated with this window
  if (fileData) {
    windowFiles.set(newWindow.id, fileData.filePath)
    pendingFiles.set(newWindow.id, fileData)
  }

  newWindow.on('ready-to-show', () => {
    newWindow.show()
  })

  newWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for dev or load file for prod
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    newWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    newWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // Cleanup
  newWindow.on('closed', () => {
    windowFiles.delete(newWindow.id)
    pendingFiles.delete(newWindow.id)
  })
}

// Single Instance Lock
const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', async (_, argv) => {
    // Check for file in the new arguments
    const fileData = await loadFileFromArgv(argv)

    if (fileData) {
      // Check if this file is already open in a window
      const targetPath = fileData.filePath
      const existingEntry = [...windowFiles.entries()].find(([_, path]) => {
        if (process.platform === 'win32') {
          return path.toLowerCase() === targetPath.toLowerCase()
        }
        return path === targetPath
      })

      if (existingEntry) {
        const [windowId] = existingEntry
        const win = BrowserWindow.fromId(windowId)
        if (win) {
          if (win.isMinimized()) win.restore()
          win.focus()
          return // Found and focused, done.
        }
      }

      // If not found, open a new window for this file
      createWindow(fileData)
    } else {
      // No file provided, just focus the most recently active window or create one
      const allWindows = BrowserWindow.getAllWindows()
      if (allWindows.length > 0) {
        const win = allWindows[0]
        if (win.isMinimized()) win.restore()
        win.focus()
      } else {
        createWindow()
      }
    }
  })

  app.whenReady().then(async () => {
    electronApp.setAppUserModelId('com.fezcode.nocturnote')

    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    // --- Window Control Handlers (Context Aware) ---
    ipcMain.on('window-minimize', (event) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      win?.minimize()
    })
    ipcMain.on('window-maximize', (event) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      if (win) {
        if (win.isMaximized()) {
          win.unmaximize()
        } else {
          win.maximize()
        }
      }
    })
    ipcMain.on('window-close', (event) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      win?.close()
    })

    // --- File I/O Handlers ---

    // Handle Save
    ipcMain.handle('save-file', async (event, { content, filePath }) => {
      try {
        let targetPath = filePath
        // If no path provided, show Save Dialog
        const win = BrowserWindow.fromWebContents(event.sender)

        if (!targetPath) {
          if (!win) return { success: false, error: 'No window found' }

          const { canceled, filePath: savePath } = await dialog.showSaveDialog(win, {
            title: 'Save Note',
            defaultPath: 'Untitled.txt',
            filters: [
              { name: 'Text File', extensions: ['txt'] },
              { name: 'Markdown File', extensions: ['md'] }
            ]
          })
          if (canceled) return { success: false }
          targetPath = savePath
        }

        await fs.writeFile(targetPath, content, 'utf-8')

        // Update window file association
        if (win) {
          windowFiles.set(win.id, targetPath)
        }

        return { success: true, filePath: targetPath }
      } catch (error) {
        console.error(error)
        return { success: false, error: 'Failed to save' }
      }
    })

    // Handle Open
    ipcMain.handle('open-file', async (event) => {
      try {
        const win = BrowserWindow.fromWebContents(event.sender)
        if (!win) return { canceled: true }

        const { canceled, filePaths } = await dialog.showOpenDialog(win, {
          properties: ['openFile'],
          filters: [{ name: 'Text Files', extensions: ['txt', 'md'] }]
        })

        if (canceled || filePaths.length === 0) return { canceled: true }

        const content = await fs.readFile(filePaths[0], 'utf-8')

        // Update window file association
        windowFiles.set(win.id, filePaths[0])

        return { canceled: false, filePath: filePaths[0], content }
      } catch (error) {
        console.error(error)
        return { canceled: true, error: 'Failed to open' }
      }
    })

    // Handle Initial File Check from Renderer
    ipcMain.handle('get-initial-file', (event) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      if (!win) return null

      const file = pendingFiles.get(win.id)
      pendingFiles.delete(win.id) // Clear it once retrieved
      return file || null
    })

    ipcMain.handle('get-app-version', () => app.getVersion())

    // Check initial file on startup
    const initialFile = await loadFileFromArgv(process.argv)
    createWindow(initialFile)

    app.on('activate', function () {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})