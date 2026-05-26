import { create } from 'zustand';

export interface LogEntry {
  id: string;
  timestamp: number;
  level: 'info' | 'warn' | 'error' | 'sensor';
  message: string;
  details?: string;
}

interface ErrorLogState {
  logs: LogEntry[];
  addLog: (message: string, level?: LogEntry['level'], details?: string) => void;
  clearLogs: () => void;
}

export const useErrorLog = create<ErrorLogState>((set) => ({
  logs: [
    {
      id: 'init',
      timestamp: Date.now(),
      level: 'info',
      message: 'Archery diagnostics console initialized.'
    }
  ],
  
  addLog: (message, level = 'info', details) => {
    // Log to standard browser console as well
    const formattedMsg = `[TelemetryLog] [${level.toUpperCase()}] ${message}`;
    if (level === 'error') {
      console.error(formattedMsg, details || '');
    } else if (level === 'warn') {
      console.warn(formattedMsg, details || '');
    } else {
      console.log(formattedMsg, details || '');
    }

    set((state) => {
      const newEntry: LogEntry = {
        id: Math.random().toString(36).substring(2, 9),
        timestamp: Date.now(),
        level,
        message,
        details
      };
      
      // Cap at 150 items to prevent any possible memory leaks
      const updatedLogs = [newEntry, ...state.logs];
      if (updatedLogs.length > 150) {
        updatedLogs.pop();
      }
      
      return { logs: updatedLogs };
    });
  },
  
  clearLogs: () => set({ logs: [] })
}));
