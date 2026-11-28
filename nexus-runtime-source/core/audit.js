const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const storage = require("./storage.js");
const contextManager = require("./context-scope.js");

const activityDirectory = path.join(__dirname, "../activity");
const eventFile = path.join(activityDirectory, "events.jsonl");
const activeEventFile = () => contextManager.resolveDataPath("activity", eventFile);

function recordEvent(type, details = {}) {
  if (typeof type !== "string" || !type.trim()) {
    throw new Error("O tipo do evento de auditoria é obrigatório.");
  }
  const event = {
    id: crypto.randomUUID(),
    type: type.trim(),
    recordedAt: new Date().toISOString(),
    details
  };
  storage.appendLine(activeEventFile(), event);
  return event;
}

function executeAudited(type, details = {}, operation) {
  let started;
  try {
    started = recordEvent(`${type}_started`, details);
  } catch (_error) {
    return {
      success: false,
      status: "audit_unavailable",
      operationPerformed: false,
      message: "A operação foi bloqueada porque não foi possível iniciar o registro de auditoria."
    };
  }

  let result;
  try {
    result = operation();
  } catch (_error) {
    try {
      recordEvent(`${type}_failed`, {
        operationId: started.id,
        identifier: details.identifier || null,
        status: "operation_failed"
      });
    } catch (_auditError) {
      return {
        success: false,
        status: "audit_failure_unrecorded",
        operationPerformed: true,
        message: "A operação falhou e a auditoria do resultado também não pôde ser concluída."
      };
    }
    return {
      success: false,
      status: "operation_failed",
      operationPerformed: true,
      message: "A operação falhou; consulte o registro local de auditoria."
    };
  }

  const failed = result?.success === false;
  try {
    recordEvent(failed ? `${type}_failed` : `${type}_completed`, {
      operationId: started.id,
      identifier: details.identifier || null,
      status: result?.status || (failed ? "failed" : "completed"),
      success: !failed
    });
  } catch (_error) {
    return {
      success: false,
      status: "audit_completion_unrecorded",
      operationPerformed: true,
      operationMayHaveCompleted: !failed,
      outcome: result,
      message: "O resultado não pode ser declarado concluído porque o registro final de auditoria falhou."
    };
  }
  return result;
}

function readEvents(options = {}) {
  const selectedEventFile = activeEventFile();
  if (!fs.existsSync(selectedEventFile)) return [];
  const limit = Number.isInteger(options.limit) && options.limit > 0 ? options.limit : 100;
  const lines = fs.readFileSync(selectedEventFile, "utf8").split("\n").filter(Boolean);
  const offset = Math.max(0, lines.length - limit);
  return lines.slice(offset).map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (_error) {
      return {
        type: "unreadable_audit_record",
        line: offset + index + 1,
        requiresReview: true
      };
    }
  });
}

module.exports = {
  recordEvent,
  executeAudited,
  readEvents
};
