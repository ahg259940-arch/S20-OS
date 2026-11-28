const memory = require("../memory/memory.js");

function learnFromExperience(experience, lesson) {
  if (typeof experience !== "string" || !experience.trim() ||
      typeof lesson !== "string" || !lesson.trim()) {
    return {
      success: false,
      message: "Informe a experiência e o aprendizado observado."
    };
  }

  const stored = memory.rememberExperience(
    "Experiência: " + experience.trim() + " | Aprendizado: " + lesson.trim()
  );

  return {
    success: true,
    experience,
    lesson,
    duplicate: !stored.added,
    learnedAt: stored.entry.date,
    status: stored.added ? "learning_recorded" : "learning_already_recorded"
  };
}

function learnKnowledge(topic, information) {
  if (typeof topic !== "string" || !topic.trim() ||
      typeof information !== "string" || !information.trim()) {
    return {
      success: false,
      message: "Informe um tópico e uma informação válida."
    };
  }

  const stored = memory.rememberKnowledge(topic.trim(), information.trim());

  return {
    success: true,
    topic,
    information,
    duplicate: !stored.added,
    learnedAt: stored.entry.date,
    status: stored.added ? "knowledge_recorded" : "knowledge_already_recorded"
  };
}

function recordOutcome(input = {}) {
  const source = input && typeof input === "object" ? input : {};
  const { situation, decision, outcome, lesson, evidence } = source;
  const required = [situation, decision, outcome, lesson];
  if (required.some(value => typeof value !== "string" || !value.trim())) {
    return {
      success: false,
      message: "Situação, decisão, resultado e aprendizado são obrigatórios."
    };
  }

  const record = [
    "Resultado acompanhado",
    "Situação: " + situation.trim(),
    "Decisão: " + decision.trim(),
    "Resultado: " + outcome.trim(),
    "Aprendizado: " + lesson.trim(),
    evidence ? "Evidência: " + String(evidence).trim() : null
  ].filter(Boolean).join(" | ");
  const stored = memory.rememberExperience(record);

  return {
    success: true,
    duplicate: !stored.added,
    status: stored.added ? "outcome_recorded" : "outcome_already_recorded",
    recordedAt: stored.entry.date
  };
}

function reviewLearning(term = "") {
  const context = memory.buildContext(term);
  return {
    ...context,
    context,
    knowledgeReview: memory.reviewKnowledge(),
    reviewedAt: new Date().toISOString()
  };
}

module.exports = {
  learnFromExperience,
  learnKnowledge,
  recordOutcome,
  reviewLearning
};
