const crypto = require("crypto");
const goals = require("../core/goals.js");
const tasks = require("../core/tasks.js");
const memory = require("../memory/memory.js");
const authorization = require("./authorization.js");
const audit = require("./audit.js");

const activities = [
  {
    title: "Explorar novas ideias",
    description: "Investigar possibilidades e registrar novas ideias.",
    reason: "Curiosidade e exploração.",
    category: "exploration"
  },
  {
    title: "Desenvolver uma criação original",
    description: "Planejar uma criação original para seu ambiente.",
    reason: "Criatividade e desenvolvimento.",
    category: "creation"
  },
  {
    title: "Revisar conhecimentos",
    description: "Revisar informações e experiências armazenadas.",
    reason: "Aprendizado e reflexão.",
    category: "learning"
  },
  {
    title: "Melhorar uma ferramenta",
    description: "Identificar uma possível melhoria em ferramentas auxiliares.",
    reason: "Aprimoramento técnico.",
    category: "improvement"
  },
  {
    title: "Planejar uma experiência no Minecraft",
    description: "Planejar uma experiência ou criação para o mundo Minecraft.",
    reason: "Exploração e criatividade.",
    category: "minecraft"
  }
];

function evaluateOpportunities() {
  const currentGoals = goals.reviewGoals();
  const allGoals = goals.loadGoals();
  const knownTitles = new Set([
    ...allGoals.active,
    ...allGoals.completed,
    ...allGoals.abandoned
  ].map(goal => String(goal.title || "").trim().toLowerCase()));

  const availableActivities = activities.filter(activity =>
    !knownTitles.has(activity.title.trim().toLowerCase())
  );

  return {
    activeGoals: currentGoals.active,
    completedGoals: currentGoals.completed,
    availableActivities,
    opportunitiesFound: availableActivities.length,
    repeatedActivitiesSuppressed: activities.length - availableActivities.length,
    evaluatedAt: new Date().toISOString()
  };
}

function considerInitiative() {
  const evaluation = evaluateOpportunities();

  if (evaluation.opportunitiesFound === 0) {
    return {
      status: "no_available_initiative",
      message: "As atividades disponíveis já foram propostas ou registradas como objetivos.",
      evaluation
    };
  }

  const chosenActivity = evaluation.availableActivities[0];

  return {
    status: "initiative_selected",
    proposalStatus: "proposed",
    proposalId: crypto.createHash("sha256")
      .update(chosenActivity.category + ":" + chosenActivity.title)
      .digest("hex")
      .slice(0, 20),
    activity: chosenActivity,
    reason: chosenActivity.reason,
    requiresHumanApproval: true,
    evaluation,
    proposedAt: new Date().toISOString()
  };
}

function startInitiative(approval) {
  const proposal = considerInitiative();
  if (proposal.status !== "initiative_selected") return proposal;

  const content = {
    proposalId: proposal.proposalId,
    activity: proposal.activity,
    reason: proposal.reason
  };
  const authorizationResult = authorization.verifyAuthorization({
    operation: "start_initiative",
    proposalId: proposal.proposalId,
    contentDigest: authorization.digestContent(content),
    approval
  });
  if (!authorizationResult.authorized) {
    return {
      status: authorizationResult.status,
      requiresHumanApproval: true,
      proposal,
      message: authorizationResult.reason
    };
  }

  return audit.executeAudited("initiative_started", {
    identifier: proposal.proposalId,
    contentDigest: authorizationResult.contentDigest
  }, () => {
    const activity = proposal.activity;
    const createdGoal = goals.createGoal(
      activity.title,
      activity.description,
      activity.reason,
      approval
    );
    if (createdGoal?.success === false) return createdGoal;
    const taskPlan = tasks.planGoal(createdGoal.id);
    memory.rememberExperience("Iniciativa aprovada e iniciada: " + activity.title);
    if (!taskPlan.success) {
      return {
        success: false,
        status: "goal_created_task_planning_failed",
        requiresRecovery: true,
        activity,
        goal: createdGoal,
        taskPlan,
        proposalId: proposal.proposalId
      };
    }
    return {
      success: true,
      status: "initiative_started",
      activity,
      goal: createdGoal,
      taskPlan,
      proposalId: proposal.proposalId,
      startedAt: new Date().toISOString()
    };
  });
}

module.exports = {
  evaluateOpportunities,
  considerInitiative,
  startInitiative
};
