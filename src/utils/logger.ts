
type Level = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

import * as readline from 'readline';

const levelPriority: Record<Level, number> = {
  DEBUG: 10,
  INFO: 20,
  WARN: 30,
  ERROR: 40,
};

const levelColors: Record<Level, string> = {
  DEBUG: '\x1b[2m',
  INFO: '\x1b[32m',
  WARN: '\x1b[33m',
  ERROR: '\x1b[31m',
};

const resetColor = '\x1b[0m';

let currentLevel: Level = (process.env.LOG_LEVEL as Level) || 'DEBUG';
let colorEnabled = process.env.LOG_COLOR === 'true';

function formatTimestamp(date = new Date()) {
  return date.toISOString();
}

function stripEnhanced(s: string) {
  return s.replace(/Enhanced/gi, '').replace(/\s{2,}/g, ' ').trim();
}

function shouldLog(level: Level) {
  return levelPriority[level] >= levelPriority[currentLevel];
}

function formatArgs(level: Level, args: any[]) {
  const transformed = args.map((a) => {
    if (typeof a === 'string') {
      const cleaned = stripEnhanced(a);
      return cleaned;
    }
    return a;
  });

  const timestamp = formatTimestamp();
  const colorPrefix = colorEnabled ? levelColors[level] : '';
  const colorSuffix = colorEnabled ? resetColor : '';
  const prefix = `${colorPrefix}[${timestamp}] ${level}:${colorSuffix}`;
  
  if (transformed.length === 0) return [prefix];
  if (typeof transformed[0] === 'string') {
    transformed[0] = `${prefix} ${transformed[0]}`.trim();
    return transformed;
  }
  return [prefix, ...transformed];
}

export function setLogLevel(level: Level | string) {
  const up = (level || 'DEBUG').toString().toUpperCase() as Level;
  if (up in levelPriority) {
    currentLevel = up;
  }
}

export function setColorEnabled(enabled: boolean) {
  colorEnabled = enabled;
}

let installed = false;
let originalConsoleMethods: {
  log: typeof console.log;
  info: typeof console.info;
  warn: typeof console.warn;
  error: typeof console.error;
  debug: typeof console.debug;
} | null = null;

type LogStatus = 'in-progress' | 'success' | 'failed';
type LogStep = { name: string; status: LogStatus; message?: string; time: string };
type LogEvent = { id: string; name: string; startedAt: string; steps: LogStep[]; metadata?: any };

const events: Map<string, LogEvent> = new Map();

let interactiveEnabled = process.env.LOG_INTERACTIVE === 'true';

export function setInteractiveEnabled(enabled: boolean) {
  interactiveEnabled = enabled;
}

export function startEvent(id: string, name: string, metadata?: any) {
  const ev: LogEvent = { id, name, startedAt: new Date().toISOString(), steps: [], metadata };
  events.set(id, ev);
  console.info(JSON.stringify({ event: 'start', id, name, metadata }));
  return ev;
}

export function stepEvent(id: string, stepName: string, status: LogStatus, message?: string) {
  const ev = events.get(id);
  const time = new Date().toISOString();
  const step: LogStep = { name: stepName, status, message, time };
  if (ev) {
    ev.steps.push(step);
  }
  console.info(JSON.stringify({ event: 'step', id, step }));
}

export function finishEvent(id: string, finalStatus: LogStatus, message?: string) {
  const ev = events.get(id);
  const finishedAt = new Date().toISOString();
  if (ev) {
    ev.steps.push({ name: 'finish', status: finalStatus, message, time: finishedAt });
  }
  console.info(JSON.stringify({ event: 'finish', id, finalStatus, message, finishedAt }));
  events.delete(id);
}

export function promptInteractive(_id: string, question: string, options?: string[], timeoutMs = 15000): Promise<string | null> {
  if (!interactiveEnabled) return Promise.resolve(null);
  if (!process.stdin || !process.stdin.isTTY) return Promise.resolve(null);

  const rl = (readline as any).createInterface({ input: process.stdin, output: process.stdout });

  return new Promise((resolve) => {
    let resolved = false;
    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        rl.close();
        resolve(null);
      }
    }, timeoutMs).unref();

    const promptText = options && options.length ? `${question} (${options.join('/')}) ` : `${question} `;
    rl.question(promptText, (answer: string) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      rl.close();
      resolve(answer.trim() || null);
    });
  });
}

export function install() {
  if (installed) return;
  installed = true;

  setLogLevel(process.env.LOG_LEVEL || 'DEBUG');
  setColorEnabled(process.env.LOG_COLOR === 'true');

  originalConsoleMethods = {
    log: console.log.bind(console),
    info: console.info.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
    debug: (console as any).debug ? (console as any).debug.bind(console) : console.log.bind(console),
  };

  console.log = (...args: any[]) => {
    if (!shouldLog('INFO')) return;
    originalConsoleMethods!.log(...formatArgs('INFO', args));
  };

  console.info = (...args: any[]) => {
    if (!shouldLog('INFO')) return;
    originalConsoleMethods!.info(...formatArgs('INFO', args));
  };

  console.warn = (...args: any[]) => {
    if (!shouldLog('WARN')) return;
    originalConsoleMethods!.warn(...formatArgs('WARN', args));
  };

  console.error = (...args: any[]) => {
    if (!shouldLog('ERROR')) return;
    originalConsoleMethods!.error(...formatArgs('ERROR', args));
  };

  (console as any).debug = (...args: any[]) => {
    if (!shouldLog('DEBUG')) return;
    originalConsoleMethods!.debug(...formatArgs('DEBUG', args));
  };
}

export function reset() {
  if (originalConsoleMethods) {
    console.log = originalConsoleMethods.log;
    console.info = originalConsoleMethods.info;
    console.warn = originalConsoleMethods.warn;
    console.error = originalConsoleMethods.error;
    (console as any).debug = originalConsoleMethods.debug;
    originalConsoleMethods = null;
  }
  installed = false;
}

export default {
  install,
  setLogLevel,
  setColorEnabled,
  reset,
};
