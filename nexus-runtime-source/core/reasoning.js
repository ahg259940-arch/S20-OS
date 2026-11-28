const memory = require("../memory/memory.js");
const intelligence = require("./intelligence.js");

function persistGenerativeInteraction(situation, enrichedReasoning) {
  if (enrichedReasoning?.generative?.status !== "available") {
    return { success: false, status: "no_generated_response" };
  }
  return intelligence.persistInteraction(situation, enrichedReasoning.generative.answer);
}

function analyzeSituation(situation) {
  const context = memory.buildContext(situation);
  const recordedEvidence = context.knowledge.map(item => ({
    type: "recorded_knowledge",
    content: item.information,
    topic: item.topic,
    source: "persistent_memory",
    verified: false
  }));

  return {
    situation,
    context,
    recordedEvidence,
    hypotheses: [],
    suggestions: [],
    analysis: "Situação recebida; registros relacionados recuperados sem tratá-los como fatos verificados.",
    timestamp: new Date().toISOString()
  };
}

async function enrichWithIntelligence(
  situation,
  localReasoning,
  cognitiveContext = {},
  options = {}
) {
  if (options.generative !== true) {
    return {
      ...localReasoning,
      generative: {
        status: "disabled",
        answer: null,
        message: "A inteligência generativa exige ativação explícita nesta execução; somente a análise local foi usada."
      }
    };
  }
  try {
    const result = await intelligence.think(situation, {
      context: {
        ...cognitiveContext,
        localReasoning
      },
      aiClient: options.aiClient,
      persist: false
    });
    const generatedSuggestion = {
      type: "generated_suggestion",
      content: result.answer,
      source: "generative_provider",
      verified: false,
      requiresReview: true
    };

    return {
      ...localReasoning,
      suggestions: [...(localReasoning.suggestions || []), generatedSuggestion],
      generative: {
        status: "available",
        answer: result.answer,
        provider: result.provider || "gemini",
        persistence: result.persistence,
        classification: "suggestion_unverified"
      }
    };
  } catch (error) {
    return {
      ...localReasoning,
      generative: {
        status: "unavailable",
        answer: null,
        message: "A análise local foi mantida; a IA online não pôde responder."
      }
    };
  }
}

module.exports = {
  analyzeSituation,
  enrichWithIntelligence,
  persistGenerativeInteraction
};
