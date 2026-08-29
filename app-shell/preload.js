/**
 * NovaPlay — Preload bridge (REVOLUTIONIZED v2)
 *
 * NovaTune-style minimal API surface — exposes invoke/on/send via
 * contextBridge so the renderer can talk to the main process without
 * nodeIntegration.
 *
 * Channels are NOT allowlisted here — the main process validates each
 * channel in ipc.js. This keeps the preload tiny while still blocking
 * arbitrary IPC from compromised renderers.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('novaAPI', {
  /** Promise-based RPC: invoke a channel and await the result. */
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),

  /** Subscribe to a main→renderer event. Returns an unsubscribe function. */
  on: (channel, callback) => {
    const handler = (_event, ...args) => callback(...args);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },

  /** Fire-and-forget send. */
  send: (channel, ...args) => ipcRenderer.send(channel, ...args),

  /** Convenience: send + oneshot reply listener (send + once). */
  request: (channel, ...args) => {
    return new Promise((resolve) => {
      const replyChannel = channel + ':reply:' + Math.random().toString(36).slice(2);
      const handler = (_e, result) => {
        ipcRenderer.removeListener(replyChannel, handler);
        resolve(result);
      };
      ipcRenderer.on(replyChannel, handler);
      ipcRenderer.send(channel, ...args, replyChannel);
    });
  }
});
