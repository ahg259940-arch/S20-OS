const INPUT_CONTRACT_VERSION = "1.0";

function normalizeSituationInput(input) {
  const value = typeof input === "string"
    ? { situation: input, source: "unknown" }
    : input;

  if (!value || typeof value !== "object" ||
      typeof value.situation !== "string" || !value.situation.trim()) {
    return {
      success: false,
      status: "invalid_input",
      contractVersion: INPUT_CONTRACT_VERSION,
      message: "A entrada precisa conter uma situação em texto não vazio."
    };
  }

  const source = typeof value.source === "string" && value.source.trim()
    ? value.source.trim().slice(0, 80)
    : "unknown";

  return {
    success: true,
    contractVersion: INPUT_CONTRACT_VERSION,
    situation: value.situation.trim(),
    source
  };
}

function createResultEnvelope(result, source = "unknown") {
  return {
    contractVersion: INPUT_CONTRACT_VERSION,
    source,
    result
  };
}

module.exports = {
  INPUT_CONTRACT_VERSION,
  normalizeSituationInput,
  createResultEnvelope
};
