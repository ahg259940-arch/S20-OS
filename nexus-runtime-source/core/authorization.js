const crypto = require("crypto");

function digestContent(value) {
  return crypto.createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex");
}

function verifyAuthorization(request = {}) {
  const validRequest = request &&
    typeof request.operation === "string" &&
    typeof request.proposalId === "string" &&
    typeof request.contentDigest === "string";
  const result = {
    authorized: false,
    status: "authorization_unavailable",
    operation: validRequest ? request.operation : null,
    proposalId: validRequest ? request.proposalId : null,
    contentDigest: validRequest ? request.contentDigest : null,
    reason: "Nenhum provedor confiável de autenticação humana está configurado. Campos fornecidos pelo chamador não são prova de autorização."
  };

  if (validRequest) {
    try {
      require("./audit.js").recordEvent("authorization_denied", {
        operation: result.operation,
        proposalId: result.proposalId,
        contentDigest: result.contentDigest,
        status: result.status
      });
    } catch (_error) {
      // Authorization remains denied even when the denial cannot be recorded.
    }
  }
  return result;
}

module.exports = {
  digestContent,
  verifyAuthorization
};
