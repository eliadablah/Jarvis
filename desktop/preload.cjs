'use strict';
const { contextBridge, ipcRenderer } = require('electron');
// Only speech lifetime/results cross the isolation boundary. No shell, file,
// worker credentials, arbitrary channels, or Node primitives are exposed.
contextBridge.exposeInMainWorld('jarvisSpeech', {
  start: id => ipcRenderer.invoke('jarvis:speech-start', id),
  stop: (id, cancel) => ipcRenderer.invoke('jarvis:speech-stop', id, cancel === true),
  subscribe: callback => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('jarvis:speech-event', listener);
    return () => ipcRenderer.removeListener('jarvis:speech-event', listener);
  }
});
contextBridge.executeInMainWorld({ func: () => {
  class WindowsSpeechRecognition {
    constructor() { this.lang = 'en-US'; this.continuous = true; this.interimResults = true; this.onresult = null; this.onerror = null; this.onend = null; this.id = null; this.results = []; this.stopRequested = false; }
    start() {
      if (this.id) throw new Error('Already listening.');
      this.id = crypto.randomUUID(); const id = this.id;
      this.results = []; this.stopRequested = false; this.startReady = false; this.cancelRequested = false;
      this.unsubscribe = window.jarvisSpeech.subscribe(data => {
        if (data.id !== id || this.id !== id) return;
        if (data.type === 'final' || data.type === 'interim') {
          const index = this.results.length;
          const result = { isFinal: data.type === 'final', 0: { transcript: `${data.text} ` } };
          const results = [...this.results, result];
          if (result.isFinal) this.results.push(result);
          this.onresult?.({ resultIndex: index, results });
        } else if (data.type === 'error') this.onerror?.({ error: data.text || 'audio-capture' });
        else if (data.type === 'end') this.end();
      });
      window.jarvisSpeech.start(id).then(() => { this.startReady = true; if (this.id === id && this.stopRequested) return window.jarvisSpeech.stop(id, this.cancelRequested); }).catch(error => { this.onerror?.({ error: error.message }); this.end(); });
    }
    stop() { this.stopRequested = true; if (this.id && this.startReady) void window.jarvisSpeech.stop(this.id, false); }
    abort() { this.stopRequested = true; this.cancelRequested = true; if (this.id && this.startReady) void window.jarvisSpeech.stop(this.id, true); }
    end() { if (!this.id) return; this.id = null; this.unsubscribe?.(); this.unsubscribe = undefined; this.onend?.(); }
  }
  window.SpeechRecognition = WindowsSpeechRecognition;
  window.webkitSpeechRecognition = WindowsSpeechRecognition;
} });
