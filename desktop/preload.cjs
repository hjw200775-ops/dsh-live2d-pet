const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('dshDesktop', {
  setIgnore(ignore) { ipcRenderer.send('desktop:set-ignore', !!ignore); },
  onPointer(callback) {
    const listener = (_event, point) => callback(point);
    ipcRenderer.on('desktop:pointer', listener);
    return () => ipcRenderer.removeListener('desktop:pointer', listener);
  },
  dragStart(origin) { ipcRenderer.send('desktop:drag-start', origin); },
  dragMove() { ipcRenderer.send('desktop:drag-move'); },
  dragEnd() { ipcRenderer.send('desktop:drag-end'); },
  scaleBy(factor) { ipcRenderer.send('desktop:scale-by', factor); },
  resetScale() { ipcRenderer.send('desktop:reset-scale'); },
  setPinned(pinned) { ipcRenderer.send('desktop:set-top', !!pinned); },
  getMouseFollow() { return ipcRenderer.invoke('desktop:get-mouse-follow'); },
  setMouseFollow(value) { ipcRenderer.send('desktop:set-mouse-follow', value); },
  quit() { ipcRenderer.send('desktop:quit'); },
  refreshBalance() { ipcRenderer.send('desktop:refresh-balance'); },
  getWardrobe() { return ipcRenderer.invoke('desktop:get-wardrobe'); },
  setWardrobe(value) { ipcRenderer.send('desktop:set-wardrobe', value); },
  getQuitWithHost() { return ipcRenderer.invoke('desktop:get-quit-with-host'); },
  setQuitWithHost(value) { ipcRenderer.send('desktop:set-quit-with-host', !!value); },
  onQuitWithHost(callback) {
    const listener = (_event, value) => callback(value === true);
    ipcRenderer.on('desktop:quit-with-host', listener);
  },
  onResume(callback) {
    const listener = () => callback();
    ipcRenderer.on('desktop:resume', listener);
  },
});
