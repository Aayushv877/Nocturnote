import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// Custom API for our Notepad
const api = {
  // File Operations
  saveFile: (content: string, filePath: string | null) =>
    ipcRenderer.invoke('save-file', { content, filePath }),

  openFile: () => ipcRenderer.invoke('open-file'),

  // Startup & External Open
  getInitialFile: () => ipcRenderer.invoke('get-initial-file'),
  onFileOpened: (callback: (content: string, filePath: string) => void) =>
    ipcRenderer.on('open-file-content', (_, value) => callback(value.content, value.filePath)),

  // Window Controls
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),

  // System Info
  platform: process.platform
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in d.ts)
  window.electron = electronAPI
  // @ts-ignore (define in d.ts)
  window.api = api
}
