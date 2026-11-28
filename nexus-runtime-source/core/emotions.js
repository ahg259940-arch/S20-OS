const memory = require("../memory/memory.js");

const emotionCategories = [
  "Alegria",
  "Tristeza",
  "Medo",
  "Raiva",
  "Surpresa",
  "Confiança",
  "Frustração",
  "Afeto",
  "Solidão",
  "Esperança"
];

function interpretEmotion(situation, observedSignals = []) {
  const context = memory.buildContext(situation);

  return {
    situation,
    observedSignals,
    possibleEmotions: emotionCategories,
    previousExperiences: context.experiences,
    previousKnowledge: context.knowledge,

    interpretationQuestions: [
      "Quais emoções podem estar relacionadas à situação?",
      "Quais sinais sustentam essa interpretação?",
      "Existem outras explicações possíveis?",
      "O contexto pode mudar o significado dos sinais?",
      "É necessário perguntar à pessoa como ela se sente?"
    ],

    interpretationIsUncertain: observedSignals.length === 0,
    interpretedAt: new Date().toISOString()
  };
}

function recordEmotionalLearning(topic, lesson) {
  memory.rememberKnowledge(
    "Compreensão emocional: " + topic,
    lesson
  );

  return {
    topic,
    lesson,
    status: "emotional_learning_recorded",
    recordedAt: new Date().toISOString()
  };
}

module.exports = {
  interpretEmotion,
  recordEmotionalLearning,
  emotionCategories
};
