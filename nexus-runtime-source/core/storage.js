const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const LOCK_TIMEOUT_MS = 10000;
const WAIT_BUFFER = new Int32Array(new SharedArrayBuffer(4));

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function withFileLock(filePath, operation, timeoutMs = LOCK_TIMEOUT_MS) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const lockPath = filePath + ".lock";
  const deadline = Date.now() + timeoutMs;
  let descriptor;

  while (descriptor === undefined) {
    try {
      descriptor = fs.openSync(lockPath, "wx", 0o600);
      fs.writeFileSync(descriptor, JSON.stringify({
        pid: process.pid,
        acquiredAt: new Date().toISOString()
      }));
      fs.fsyncSync(descriptor);
    } catch (error) {
      if (descriptor !== undefined) {
        try { fs.closeSync(descriptor); } catch (_closeError) {}
        descriptor = undefined;
        try { fs.unlinkSync(lockPath); } catch (_unlinkError) {}
      }
      if (error.code !== "EEXIST") throw error;
      if (Date.now() >= deadline) {
        const timeoutError = new Error("Timed out waiting for the data file lock; inspect the lock file before recovery.");
        timeoutError.code = "FILE_LOCK_TIMEOUT";
        throw timeoutError;
      }
      Atomics.wait(WAIT_BUFFER, 0, 0, 10);
    }
  }

  try {
    return operation();
  } finally {
    try { fs.closeSync(descriptor); } finally {
      try { fs.unlinkSync(lockPath); } catch (_error) {}
    }
  }
}

function readJson(filePath, initialValue) {
  if (!fs.existsSync(filePath)) return clone(initialValue);
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function atomicWriteUnlocked(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp-${process.pid}-${crypto.randomUUID()}`;
  let descriptor;

  try {
    descriptor = fs.openSync(temporaryPath, "wx", 0o600);
    fs.writeFileSync(descriptor, JSON.stringify(value, null, 2) + "\n", "utf8");
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(temporaryPath, filePath);
    try {
      const directoryDescriptor = fs.openSync(path.dirname(filePath), "r");
      try { fs.fsyncSync(directoryDescriptor); } finally { fs.closeSync(directoryDescriptor); }
    } catch (_directorySyncError) {
      // Directory fsync is unavailable on some supported platforms.
    }
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function writeJsonAtomic(filePath, value) {
  return withFileLock(filePath, () => atomicWriteUnlocked(filePath, value));
}

function updateJson(filePath, initialValue, updater) {
  return withFileLock(filePath, () => {
    const data = readJson(filePath, initialValue);
    const update = updater(data);
    if (!update || update.commit !== false) {
      atomicWriteUnlocked(filePath, update && Object.hasOwn(update, "data") ? update.data : data);
    }
    return update?.result;
  });
}

function appendLine(filePath, value) {
  return withFileLock(filePath, () => {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const descriptor = fs.openSync(filePath, "a", 0o600);
    try {
      fs.writeFileSync(descriptor, JSON.stringify(value) + "\n", "utf8");
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }
  });
}

module.exports = {
  withFileLock,
  readJson,
  writeJsonAtomic,
  updateJson,
  appendLine
};
