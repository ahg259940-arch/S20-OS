'use strict';

(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const state = { context: null, profile: null, preferences: null, deferredInstall: null, layoutDraft: null, originalLayout: null, drag: null, projects: [], projectFilter: 'active', openProjectId: null };
  let localDeviceToken = '';
  try {
    const launchUrl = new URL(window.location.href);
    localDeviceToken = launchUrl.searchParams.get('nexusDeviceToken') || sessionStorage.getItem('nexus-device-token-v1') || '';
    if (launchUrl.searchParams.has('nexusDeviceToken')) {
      sessionStorage.setItem('nexus-device-token-v1', localDeviceToken);
      launchUrl.searchParams.delete('nexusDeviceToken');
      history.replaceState(null, '', launchUrl.pathname + launchUrl.search + launchUrl.hash);
    }
  } catch (_error) {}
  if (localDeviceToken) {
    const adminToken = document.querySelector('#create-context-form [name="adminToken"]');
    const adminField = document.getElementById('admin-token-field');
    const adminHelp = document.getElementById('admin-token-help');
    if (adminToken) adminToken.value = localDeviceToken;
    if (adminField) adminField.hidden = true;
    if (adminHelp) adminHelp.textContent = 'O acesso administrativo é protegido pelo token aleatório desta instalação Android.';
  }
  const sessionKey = 'nexus-preview-session-v2';
  sessionStorage.removeItem('nexus-preview-session-v1');
  const readSession = () => { try { const value = JSON.parse(sessionStorage.getItem(sessionKey) || 'null'); return value && typeof value.userId === 'string' && typeof value.universeId === 'string' ? value : null; } catch (_error) { return null; } };
  let session = readSession();

  function announce(message, target = 'app-notice', kind = '') {
    const element = document.getElementById(target);
    if (!element) return;
    element.textContent = message || '';
    element.dataset.kind = kind;
  }
  async function api(path, options = {}, auth = "context") {
    const headers = { ...(options.body ? { "Content-Type": "application/json" } : {}), ...(options.headers || {}) };
    if (localDeviceToken) headers["X-Nexus-Device-Token"] = localDeviceToken;
    if (auth === "context" && session) { headers["X-Nexus-User"] = session.userId; headers["X-Nexus-Universe"] = session.universeId; }
    else if (typeof auth === "string" && auth.startsWith("Bearer ")) headers.Authorization = auth;
    const response = await fetch(path, { ...options, headers, credentials: "same-origin", cache: "no-store" });
    const payload = await response.json().catch(() => ({ success: false, error: { message: "Resposta inválida do servidor local." } }));
    if (!response.ok || payload.success === false) {
      const error = new Error(payload.error?.message || payload.message || "A operação não foi concluída."); error.status = response.status;
      if ((response.status === 401 || response.status === 409) && auth === "context" && session) logout("A sessão expirou ou o contexto ativo mudou. Entre novamente.", false);
      throw error;
    }
    return payload;
  }
  const post = (path, body, method = "POST", auth = "context") => api(path, { method, body: JSON.stringify(body) }, auth)
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const dateText = value => { const date = new Date(value); return Number.isNaN(date.getTime()) ? 'Data indisponível' : new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium', timeStyle: 'short' }).format(date); };

  function captureWorkspacePositions() {
    if (!state.layoutDraft || !window.NexusLayoutGeometry) return;
    for (const node of $('.workspace-node')) {
      const candidate = window.NexusLayoutGeometry.normalizeNode({
        x: parseFloat(node.style.getPropertyValue('--node-x')) || 0,
        y: parseFloat(node.style.getPropertyValue('--node-y')) || 0,
        width: parseFloat(node.style.getPropertyValue('--node-width')) || 230
      });
      if (candidate) state.layoutDraft.workspace.nodes[node.dataset.nodeId] = candidate;
    }
  }
  function setCoreState(value) {
    $('#core-state').textContent = value;
    $('#core-visual').dataset.state = ['ANALISANDO', 'PROCESSANDO', 'ATUALIZANDO TAREFA'].includes(value) ? 'processing' : value === 'AGUARDANDO AUTORIZAÇÃO' ? 'approval' : value === 'ERRO' || value === 'INDISPONÍVEL' ? 'offline' : 'ready';
    $('#core-visual').setAttribute('aria-label', `Núcleo N.E.X.U.S., estado ${value.toLowerCase()}`);
    const assistantState = $('#assistant-state');
    if (assistantState) assistantState.textContent = value === 'AGUARDANDO AUTORIZAÇÃO' ? 'Proposta aguardando revisão humana; nenhuma ação foi executada.' : value === 'ERRO' ? 'Falha na solicitação. Consulte a mensagem e tente novamente quando apropriado.' : value === 'ANALISANDO' ? 'O núcleo está analisando a entrada local.' : value === 'PROCESSANDO' ? 'O núcleo está processando a solicitação.' : value === 'DISPONÍVEL' ? 'Disponível para análise no contexto ativo.' : value === 'INDISPONÍVEL' ? 'Núcleo local indisponível.' : 'Aguardando um contexto autenticado.';
  }
  function showAuthenticatedView(context) {
    document.body.classList.remove('guest-mode');
    state.context = context;
    $('#setup-view').hidden = true;
    $('#application-view').hidden = false;
    $('#logout-button').hidden = false;
    $('#context-label').textContent = `${context.displayName} · ${context.universeName}`;
    setCoreState('DISPONÍVEL');
    loadProfile().catch(error => announce(error.message, 'app-notice', 'error'));
  }
  function logout(message = "", revoke = true) {
    if (revoke && session) post("/api/context/logout", {}, "POST").catch(() => {});
    sessionStorage.removeItem(sessionKey); session = null; state.context = null; state.profile = null;
    $("#application-view").hidden = true; $("#setup-view").hidden = false; $("#logout-button").hidden = true;
    $("#context-label").textContent = "Contexto não selecionado"; setCoreState("AGUARDANDO CONTEXTO");
    announce(message, "setup-notice", message ? "success" : "");
  }
  function enterLocalMode() {
    if (session) return;
    document.body.classList.add('guest-mode');
    $('#setup-view').hidden = true;
    $('#application-view').hidden = false;
    $('#logout-button').hidden = true;
    $('#context-label').textContent = 'Modo local · sem conta';
    setCoreState('NÚCLEO LOCAL');
    $('#core-subtitle').textContent = 'Central de Controle local disponível. Conecte uma conta somente para recursos vinculados a contexto e sincronização.';
    $('#identity-full-name').textContent = 'N.E.X.U.S. · Sessão local';
    $('#identity-purpose').textContent = 'A Central de Controle e a configuração Minecraft estão disponíveis sem login.';
    loadMinecraft().catch(error => announce(error.message, 'app-notice', 'error'));
  }
  function countActiveGoals() { return state.profile?.goals?.active?.length ?? 0; }
  function countPendingTasks() { return state.profile?.tasks?.pending?.length ?? 0; }
  function renderProfile(profile) {
    state.profile = profile;
    state.preferences = structuredClone(profile.preferences);
    $('#memory-count').textContent = profile.memory.total;
    $('#goal-count').textContent = countActiveGoals();
    $('#task-count').textContent = countPendingTasks();
    const latest = profile.audit[profile.audit.length - 1];
    $('#activity-label').textContent = latest ? latest.type.replaceAll('_', ' ') : 'Sem atividade recente.';
    $('#activity-time').textContent = latest ? dateText(latest.recordedAt) : '—';
    renderSystemProfile(profile);
    renderAIStatus(profile.system?.operationalState?.generative || { configured: false, provider: 'openai', source: 'none' });
    $('#health-dot').classList.add('online');
    renderMemory(profile.memory);
    renderKnowledgeReview(profile.memoryReview || { possibleConflicts: [], potentiallyStale: [], status: 'no_review_needed' }, 365);
    renderHistory(profile.conversations);
    renderConversation(profile.conversations);
    loadUniverseChoices().catch(error => announce(error.message, 'app-notice', 'error'));
    loadProjects().catch(error => announce(error.message, 'app-notice', 'error'));
    renderGoals(profile.goals);
    renderWorkspace(profile.goals, profile.tasks, profile.preferences);
    renderAudit(profile.audit);
    renderPreferenceControls(profile.preferences);
    applyPanels(profile.preferences);
  }
  function statusLabel(status) { return ({ available: 'Disponível', experimental: 'Experimental', disabled: 'Desativado', unavailable: 'Indisponível' })[status] || 'Estado desconhecido'; }
  function renderAIStatus(ai) {
    const toggle = $('#chat-generative-toggle');
    const note = $('#chat-generative-note');
    toggle.disabled = !ai.configured;
    $('#ai-provider').value = ai.provider || 'openai';
    $('#ai-configuration-status').textContent = ai.configured
      ? `${ai.provider === 'openai' ? 'OpenAI' : 'Google Gemini'} configurado · ${ai.source === 'environment' ? 'chave do ambiente' : 'chave em memória até encerrar o processo'}. A disponibilidade será confirmada no primeiro envio.`
      : 'IA online não configurada. A análise local continua disponível.';
    note.textContent = ai.configured
      ? `Ao marcar, esta mensagem e o contexto relevante serão enviados à ${ai.provider === 'openai' ? 'OpenAI' : 'Google Gemini'}; pode haver cobrança. A sugestão volta como não verificada.`
      : 'A análise local funciona sem chave. Configure um provedor em Preferências.';
    $('#chat-processing-mode').textContent = ai.configured
      ? 'Local por padrão · IA online somente ao marcar'
      : 'Até 4.000 caracteres · processamento local';
    $('#provider-state').textContent = ai.configured
      ? `IA ${ai.provider.toUpperCase()} DISPONÍVEL · USO SOB OPT-IN`
      : 'GERAÇÃO EXTERNA DESATIVADA';
  }
  function renderSystemProfile(profile) {
    const system = profile.system;
    if (!system) return;
    const identity = system.identity;
    $('#brand-identity-name').textContent = identity.name;
    $('#brand-identity-subtitle').textContent = identity.nature;
    $('#identity-full-name').textContent = identity.fullName;
    $('#identity-purpose').textContent = identity.purpose;
    document.title = identity.name + ' — Núcleo';
    renderCapabilities(system.capabilities);
    renderPetal(system.petal);
  }
  function renderCapabilities(capabilities) {
    const list = $('#capability-list');
    if (!list) return;
    list.innerHTML = capabilities.map(capability => '<article class="glass-panel capability-entry"><div class="record-head"><div><div class="panel-kicker">' + escapeHtml(capability.group === 'future' ? 'MÓDULO FUTURO' : 'CAPACIDADE REGISTRADA') + '</div><h2>' + escapeHtml(capability.name) + '</h2></div><span class="capability-state state-' + escapeHtml(capability.status) + '">' + escapeHtml(statusLabel(capability.status)) + '</span></div><p>' + escapeHtml(capability.description) + '</p><small>Permissões: ' + escapeHtml((capability.permissions || []).join(', ') || 'nenhuma declarada') + '</small><small>Evidências: ' + escapeHtml((capability.evidence || []).join(', ') || 'não disponíveis') + '</small>' + ((capability.limits || []).length ? '<p class="muted">Limites: ' + escapeHtml(capability.limits.join(' ')) + '</p>' : '') + '</article>').join('');
  }
  function renderPetal(petal) {
    if (!petal) return;
    $('#petal-summary').innerHTML = '<article class="glass-panel petal-state"><div class="panel-kicker">SESSÃO ATUAL</div><strong>' + (petal.session.active ? 'Sessão local ativa' : 'Sem sessão ativa') + '</strong><p>' + (petal.session.humanAuthenticated ? 'Autenticação humana verificada.' : 'A sessão local não verifica identidade humana.') + '</p></article><article class="glass-panel petal-state"><div class="panel-kicker">DADOS EM REPOUSO</div><strong>JSON sem criptografia em repouso</strong><p>Somente arquivos exportados são cifrados; nenhuma migração foi feita.</p></article><article class="glass-panel petal-state"><div class="panel-kicker">ESTADO PETAL</div><strong>' + escapeHtml(petal.state === 'partial' ? 'Parcial · consulte cada módulo' : petal.state) + '</strong><p>Hardware confiável: indisponível. Biometria: não conectada.</p></article>';
    $('#petal-module-list').innerHTML = petal.modules.map(module => '<article class="glass-panel petal-module"><div class="record-head"><div><div class="panel-kicker">PETAL · ' + escapeHtml(module.id) + '</div><h2>' + escapeHtml(module.name) + '</h2></div><span class="capability-state state-' + escapeHtml(module.status) + '">' + escapeHtml(statusLabel(module.status)) + '</span></div><p>Implementação: ' + escapeHtml(module.implementation.join(', ')) + '</p><small>Permissões relacionadas: ' + escapeHtml((module.permissions || []).join(', ') || 'nenhuma declarada') + '</small><small>Evidências: ' + escapeHtml(module.evidence.join(', ')) + '</small><ul>' + module.limits.map(limit => '<li>' + escapeHtml(limit) + '</li>').join('') + '</ul></article>').join('');
  }
  async function loadProfile() {
    const result = await api('/api/profile');
    renderProfile(result.profile);
  }
  function record(title, body, timestamp, badge = '') {
    return `<article class="record"><div class="record-head"><b>${escapeHtml(title)}</b>${badge ? `<span class="record-badge">${escapeHtml(badge)}</span>` : ''}</div><p>${escapeHtml(body)}</p><small>${escapeHtml(dateText(timestamp))}</small></article>`;
  }
  function renderMemory(memory) {
    const entries = [...memory.experiences.map(item => ({ title: 'Experiência', body: item.description, date: item.date })),
      ...memory.knowledge.map(item => ({ title: item.topic, body: item.information, date: item.date })),
      ...memory.relationships.map(item => ({ title: item.name, body: item.description, date: item.date }))]
      .sort((a, b) => String(b.date).localeCompare(String(a.date)));
    $('#memory-list').innerHTML = entries.length ? entries.map(item => record(item.title, item.body, item.date)).join('') : '<p class="empty-state">Ainda não há registros neste contexto.</p>';
  }
  function renderKnowledgeReview(review, days) {
    const results = $('#memory-review-results');
    const conflicts = review.possibleConflicts || [];
    const stale = review.potentiallyStale || [];
    if (!conflicts.length && !stale.length) {
      results.innerHTML = `<p class="review-clear">Nenhum conflito aparente ou conhecimento com mais de ${Number(days)} dias.</p>`;
      return;
    }
    const sections = [];
    if (conflicts.length) sections.push(`<div><div class="panel-kicker">TÓPICOS COM REGISTROS DIFERENTES · ${conflicts.length}</div>${conflicts.map(item => `<article class="review-item"><b>${escapeHtml(item.topic)}</b><p>${escapeHtml(item.reason)}</p>${item.entries.map(entry => record('Registro para revisar', entry.information, entry.date)).join('')}</article>`).join('')}</div>`);
    if (stale.length) sections.push(`<div><div class="panel-kicker">POSSIVELMENTE ANTIGOS · ${stale.length}</div>${stale.map(item => record(item.topic, item.information, item.date)).join('')}</div>`);
    results.innerHTML = sections.join('');
  }
  async function refreshKnowledgeReview() {
    const button = $('#memory-review-button');
    button.disabled = true;
    $('#memory-review-results').innerHTML = '<p class="empty-state">Revisando conhecimento…</p>';
    try {
      const days = Number($('#memory-review-age').value);
      const result = await api(`/api/memory/review?staleAfterDays=${days}`);
      renderKnowledgeReview(result.review, result.staleAfterDays);
    } catch (error) {
      $('#memory-review-results').innerHTML = `<p class="empty-state">${escapeHtml(error.message)}</p>`;
    } finally { button.disabled = false; }
  }
  function renderHistory(history) {
    const conversations = history.slice(-30).reverse();
    const assistantName = state.profile?.system?.identity?.name || 'Assistente';
    $('#history-list').innerHTML = conversations.length ? conversations.map(item => record(item.role === 'user' ? 'Usuário' : assistantName, item.content || '', item.timestamp || '')).join('') : '<p class="empty-state">Ainda não há conversas neste contexto.</p>';
  }
  function renderConversation(history) {
    const timeline = window.NexusPresentation.conversationEntries(history, state.profile?.system?.identity?.name, 40);
    $('#conversation-count').textContent = timeline.length + (timeline.length === 1 ? ' registro' : ' registros');
    $('#conversation-list').innerHTML = timeline.length
      ? timeline.map(item => '<article class="record conversation-entry conversation-' + item.role + '"><div class="record-head"><b>' + escapeHtml(item.title) + '</b><span class="conversation-tools"><span class="record-badge">' + escapeHtml(item.badge) + '</span><button class="message-speak" type="button" data-speak-text="' + escapeHtml(item.content) + '" aria-label="Ouvir mensagem de ' + escapeHtml(item.title) + '" title="Ouvir mensagem">◖))</button></span></div><p>' + escapeHtml(item.content) + '</p><small>' + escapeHtml(dateText(item.timestamp)) + '</small></article>').join('')
      : '<p class="empty-state">Ainda não há mensagens neste contexto.</p>';
  }
  async function loadUniverseChoices() {
    if (!state.context) return;
    const result = await api('/api/universes');
    const select = $('#context-universe-select');
    const allowed = Array.isArray(result.universes) ? result.universes : [];
    select.innerHTML = allowed.map(universe => '<option value="' + escapeHtml(universe.id) + '">' + escapeHtml(universe.name) + '</option>').join('');
    select.value = state.context.universeId;
    $('#context-switcher').hidden = allowed.length < 2;
    $('#context-switch-button').disabled = allowed.length < 2 || select.value === state.context.universeId;
  }
  function projectKindLabel(kind) { return ({ general: 'Geral', tool: 'Ferramenta', game: 'Jogo', experiment: 'Experimento' })[kind] || 'Projeto'; }
  function renderProjects(projects = state.projects) {
    state.projects = projects;
    const visible = state.projectFilter === 'all' ? projects : projects.filter(project => project.status === state.projectFilter);
    $('#project-count').textContent = visible.length + (visible.length === 1 ? ' projeto' : ' projetos');
    $('#project-list').innerHTML = visible.length ? visible.map(project => '<article class="glass-panel project-card"><div class="record-head"><div><div class="panel-kicker">' + escapeHtml(projectKindLabel(project.kind)) + ' · REV. ' + escapeHtml(project.revision) + '</div><h2>' + escapeHtml(project.name) + '</h2></div><span class="capability-state ' + (project.status === 'active' ? 'state-available' : 'state-disabled') + '">' + (project.status === 'active' ? 'Ativo' : 'Arquivado') + '</span></div><p>' + escapeHtml(project.description || 'Projeto sem descrição.') + '</p><small>Atualizado em ' + escapeHtml(dateText(project.updatedAt)) + '</small><div class="project-actions"><button type="button" data-project-open="' + escapeHtml(project.id) + '">Abrir</button><button type="button" data-project-edit="' + escapeHtml(project.id) + '" ' + (project.status !== 'active' ? 'disabled' : '') + '>Editar</button>' + (project.status === 'active' ? '<button type="button" data-project-archive="' + escapeHtml(project.id) + '">Arquivar</button>' : '<button type="button" data-project-restore="' + escapeHtml(project.id) + '">Restaurar</button><button type="button" data-project-delete="' + escapeHtml(project.id) + '">Excluir…</button>') + '</div></article>').join('') : '<p class="empty-state">Nenhum projeto ' + (state.projectFilter === 'archived' ? 'arquivado' : 'nesta visualização') + ' neste contexto.</p>';
    $('[data-project-filter]').forEach(button => button.classList.toggle('active', button.dataset.projectFilter === state.projectFilter));
  }
  async function loadProjects() {
    const result = await api('/api/projects');
    if (!result.success || !Array.isArray(result.projects)) throw new Error('Não foi possível carregar os projetos deste contexto.');
    renderProjects(result.projects);
  }
  function showProject(project, editing = false) {
    state.openProjectId = project.id;
    $('#project-detail').hidden = false;
    $('#project-detail-name').textContent = project.name;
    $('#project-detail-meta').textContent = projectKindLabel(project.kind) + ' · ' + (project.status === 'active' ? 'Ativo' : 'Arquivado') + ' · revisão ' + project.revision;
    $('#project-detail-description').textContent = project.description || 'Projeto sem descrição.';
    $('#project-edit-area').hidden = !editing;
    const form = $('#project-edit-form');
    form.elements.name.value = project.name; form.elements.description.value = project.description; form.elements.kind.value = project.kind;
    $('#project-history').innerHTML = project.history.slice().reverse().map(item => record(item.action, item.summary, item.at, 'REV. ' + item.revision)).join('');
    $('#project-detail').scrollIntoView({ behavior: state.preferences?.reducedMotion ? 'auto' : 'smooth', block: 'start' });
  }
  async function fetchProject(id) {
    const result = await api('/api/projects/' + encodeURIComponent(id));
    if (!result.success || !result.project) throw new Error('Projeto não encontrado neste contexto.');
    return result.project;
  }
  function renderGoals(goals) {
    const items = goals.active || [];
    $('#goal-list').innerHTML = items.length ? items.map(goal => `<article class="goal-entry glass-panel"><div class="record-head"><div><div class="panel-kicker">OBJETIVO ATIVO</div><h2>${escapeHtml(goal.title)}</h2></div><span class="progress-value">${Number(goal.progress) || 0}%</span></div><p>${escapeHtml(goal.description)}</p><div class="progress-track"><span style="width:${Math.max(0, Math.min(100, Number(goal.progress) || 0))}%"></span></div><div class="goal-actions"><button type="button" data-goal-progress="${escapeHtml(goal.id)}">Atualizar progresso</button><button type="button" data-plan-goal="${escapeHtml(goal.id)}">Planejar tarefas</button></div></article>`).join('') : '<p class="empty-state">Nenhum objetivo ativo neste contexto.</p>';
    const select = $('#task-form select[name="goalId"]');
    select.innerHTML = items.map(goal => `<option value="${escapeHtml(goal.id)}">${escapeHtml(goal.title)}</option>`).join('');
    $('#task-add-toggle').disabled = !items.length;
  }
  function renderWorkspace(goals, tasks, preferences) {
    const nodes = preferences.workspace.nodes || {};
    const goalItems = (goals.active || []).map(goal => ({ id: `goal-${goal.id}`, title: goal.title, detail: `${Number(goal.progress) || 0}% · objetivo ativo`, kind: 'Objetivo', progress: Number(goal.progress) || 0 }));
    const taskItems = (tasks.pending || []).map(task => ({ id: `task-${task.id}`, title: task.title, detail: `${task.status === 'in_progress' ? 'Em andamento' : 'Pendente'}${Number.isFinite(task.progress) ? ` · ${task.progress}%` : ''}`, kind: 'Tarefa', progress: Number(task.progress) || 0, task }));
    const items = [...goalItems, ...taskItems];
    $('#workspace-canvas').style.transform = `translate(${preferences.workspace.panX}px, ${preferences.workspace.panY}px) scale(${preferences.workspace.zoom})`;
    $('#zoom-label').textContent = `${Math.round(preferences.workspace.zoom * 100)}%`;
    $('#workspace-canvas').innerHTML = items.length ? items.map((item, index) => {
      const pos = nodes[item.id] || { x: (index % 9) * 260, y: Math.floor(index / 9) * 210, width: 230 };
      return `<article class="workspace-node" data-node-id="${escapeHtml(item.id)}" style="--node-x:${pos.x}px;--node-y:${pos.y}px;--node-width:${pos.width || 230}px"><span class="panel-kicker">${escapeHtml(item.kind)}</span><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.detail)}</p>${item.kind === 'Tarefa' ? `<div class="node-actions"><button data-task-action="${escapeHtml(item.task.id)}" data-action="${item.task.status === 'in_progress' ? 'progress' : 'start'}">${item.task.status === 'in_progress' ? 'Registrar progresso' : 'Iniciar'}</button><button data-task-action="${escapeHtml(item.task.id)}" data-action="complete">Concluir</button></div>` : `<div class="progress-track"><span style="width:${Math.max(0, Math.min(100, item.progress))}%"></span></div>`}<div class="workspace-card-controls"><button type="button" data-width="-22" aria-label="Diminuir largura">−</button><button type="button" data-width="22" aria-label="Aumentar largura">+</button></div></article>`;
    }).join('') : '<p class="empty-state">Crie objetivos e tarefas para organizar este espaço.</p>';
  }
  function renderAudit(events) {
    $('#audit-list').innerHTML = events.length ? events.slice().reverse().map(item => record(item.type.replaceAll('_', ' '), item.status || 'Operação registrada', item.recordedAt)).join('') : '<p class="empty-state">Nenhum evento recente.</p>';
  }
  function renderPreferenceControls(preferences) {
    const labels = { memory: 'Memória', goals: 'Objetivos', reasoning: 'Raciocínio', security: 'Segurança', workspace: 'Espaço de trabalho' };
    $('#panel-toggles').innerHTML = Object.entries(labels).map(([key, label]) => `<div class="panel-config-row"><label class="check-row"><input type="checkbox" data-panel-toggle="${key}" ${preferences.panels[key] ? 'checked' : ''}> Mostrar ${label}</label><span><button type="button" data-move-panel="${key}" data-direction="-1" aria-label="Mover ${label} para cima">↑</button><button type="button" data-move-panel="${key}" data-direction="1" aria-label="Mover ${label} para baixo">↓</button></span></div>`).join('');
    $('#reduced-motion').checked = preferences.reducedMotion;
  }
  function applyPanels(preferences) {
    const orientation = matchMedia('(orientation: landscape)').matches ? 'landscape' : 'portrait';
    const order = preferences.layout[orientation] || preferences.layout.portrait;
    $$('.nav-item').forEach(button => {
      const panel = button.dataset.view === 'home' ? 'core' : button.dataset.view === 'conversation' ? 'chat' : button.dataset.view;
      const extraOrder = { projects: 7, tools: 8, modules: 9, settings: 10 };
      button.style.order = String(order.indexOf(panel) < 0 ? (extraOrder[panel] ?? 100) : order.indexOf(panel));
    });
    for (const [panel, visible] of Object.entries(preferences.panels)) {
      const section = document.querySelector(`[data-panel="${panel}"]`);
      if (section) section.classList.toggle('panel-hidden', !visible);
      const nav = document.querySelector(`[data-view="${panel === 'core' ? 'home' : panel === 'chat' ? 'conversation' : panel}"]`);
      if (nav) nav.classList.toggle('panel-hidden', !visible);
    }
    document.body.classList.toggle('reduce-motion', preferences.reducedMotion);
  }
  function activateView(name) {
    $$('.nav-item').forEach(button => button.classList.toggle('active', button.dataset.view === name));
    $$('.view-section').forEach(view => view.classList.toggle('active', view.id === `view-${name}`));
    if (name === 'settings') $('#layout-editor').hidden = !$('#layout-edit-toggle').getAttribute('aria-pressed').includes('true');
    history.replaceState(null, '', `#${name}`);
  }

  const voiceModeKey = 'nexus-presentation-voice-mode-v1';
  const speechStatus = $('#speech-status'), speechStopButton = $('#speech-stop-button'), welcomeSpeakButton = $('#welcome-speak-button');
  let activeUtterance = null, speechStarted = false;
  function setSpeechStatus(message) { speechStatus.textContent = message; $('#speech-global-status').textContent = message; $('#voice-inline-status').textContent = message; }
  function voiceMode() { try { return localStorage.getItem(voiceModeKey) === 'text' ? 'text' : 'voice'; } catch (_error) { return 'voice'; } }
  function finishSpeech(message = 'Apresentação em texto disponível.') {
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    activeUtterance = null; speechStarted = false;
    $('#welcome-core').classList.remove('speaking-core');
    speechStopButton.hidden = true;
    if (message) setSpeechStatus(message);
  }
  function speakText(text, source = 'message') {
    if (voiceMode() === 'text') { setSpeechStatus('Modo somente texto está ativo nas preferências.'); return false; }
    if (!('speechSynthesis' in window) || !('SpeechSynthesisUtterance' in window)) {
      setSpeechStatus('Síntese de fala indisponível neste navegador. O texto permanece disponível.'); return false;
    }
    finishSpeech('Preparando síntese de fala do navegador…');
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'pt-BR'; utterance.rate = .94; utterance.pitch = .92;
    activeUtterance = utterance;
    const fallbackTimer = window.setTimeout(() => {
      if (activeUtterance === utterance && !speechStarted) {
        setSpeechStatus(source === 'welcome' ? 'A reprodução automática pode ter sido bloqueada. Toque em “Ouvir apresentação” para iniciar.' : 'O navegador bloqueou a fala. O texto continua disponível.');
        if (source === 'welcome') welcomeSpeakButton.hidden = false;
      }
    }, 1600);
    utterance.onstart = () => {
      window.clearTimeout(fallbackTimer); speechStarted = true;
      setSpeechStatus('N.E.X.U.S. está falando com síntese de voz do navegador.');
      speechStopButton.hidden = false; welcomeSpeakButton.hidden = true;
      $('#welcome-core').classList.add('speaking-core');
    };
    utterance.onend = () => {
      window.clearTimeout(fallbackTimer);
      if (activeUtterance !== utterance) return;
      activeUtterance = null; speechStarted = false; $('#welcome-core').classList.remove('speaking-core');
      speechStopButton.hidden = true; welcomeSpeakButton.hidden = source !== 'welcome';
      setSpeechStatus(source === 'welcome' ? 'Apresentação concluída. Você pode ouvi-la novamente.' : 'Leitura da mensagem concluída.');
    };
    utterance.onerror = event => {
      window.clearTimeout(fallbackTimer);
      if (activeUtterance !== utterance) return;
      activeUtterance = null; speechStarted = false; $('#welcome-core').classList.remove('speaking-core');
      speechStopButton.hidden = true; welcomeSpeakButton.hidden = source !== 'welcome';
      setSpeechStatus(event.error === 'not-allowed' ? 'O navegador bloqueou a fala automática. Use “Ouvir apresentação”.' : 'Não foi possível reproduzir a fala. O texto continua disponível.');
    };
    try { window.speechSynthesis.speak(utterance); }
    catch (_error) {
      window.clearTimeout(fallbackTimer); activeUtterance = null; speechStarted = false;
      welcomeSpeakButton.hidden = source !== 'welcome';
      setSpeechStatus('A síntese de fala falhou neste navegador. O texto continua disponível.');
      return false;
    }
    return true;
  }
  welcomeSpeakButton.addEventListener('click', () => speakText($('#welcome-narration').textContent, 'welcome'));
  speechStopButton.addEventListener('click', () => finishSpeech('Fala interrompida. A apresentação continua disponível em texto.'));
  $('#voice-mode').value = voiceMode();
  $('#voice-mode').addEventListener('change', event => {
    try { localStorage.setItem(voiceModeKey, event.target.value); } catch (_error) {}
    if (event.target.value === 'text') finishSpeech('Modo somente texto ativo.');
    else setSpeechStatus('Texto e voz selecionados. A apresentação pode ser reproduzida pelo controle de áudio.');
  });
  document.addEventListener('click', event => {
    const button = event.target.closest('[data-speak-text]');
    if (button) speakText(button.dataset.speakText, 'message');
  });

  $('#control-center-open').addEventListener('click', () => {
    finishSpeech('Apresentação pausada ao continuar.');
    $('.welcome-screen').classList.add('welcome-dismissed');
    $('#control-center').hidden = false;
    $('#control-center').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  });
  $('#control-center-close').addEventListener('click', () => {
    $('#control-center').hidden = true;
    $('.welcome-screen').classList.remove('welcome-dismissed');
  });

  const themeKey = 'nexus-theme-v1';
  const applyTheme = value => {
    const mode = ['auto', 'light', 'dark'].includes(value) ? value : 'auto';
    document.documentElement.dataset.theme = mode === 'auto' ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : mode;
    document.documentElement.dataset.themeMode = mode;
    $('#theme-cycle').textContent = `Tema: ${{ auto: 'automático', light: 'claro', dark: 'escuro' }[mode]}`;
    try { localStorage.setItem(themeKey, mode); } catch (_error) {}
  };
  applyTheme(localStorage.getItem(themeKey) || 'auto');
  $('#theme-cycle').addEventListener('click', () => {
    const choices = ['auto', 'light', 'dark'];
    applyTheme(choices[(choices.indexOf(document.documentElement.dataset.themeMode) + 1) % choices.length]);
  });
  matchMedia('(prefers-color-scheme: light)').addEventListener?.('change', () => {
    if (document.documentElement.dataset.themeMode === 'auto') applyTheme('auto');
  });
  $('#account-open').addEventListener('click', () => {
    $('#application-view').hidden = true;
    $('#setup-view').hidden = false;
    $('.welcome-screen').classList.add('welcome-dismissed');
    $('#control-center').hidden = false;
    $('.setup-copy').hidden = true;
    $('#control-center').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  let minecraftConnections = [];
  async function loadMinecraft() {
    const data = await api('/api/minecraft/connections', {}, 'public');
    minecraftConnections = data.connections || [];
    $('#minecraft-access-form').elements.players.value = (data.authorizedPlayers || []).join('\n');
    $('#minecraft-access-form').elements.reconnect.checked = Boolean(data.reconnect);
    renderMinecraftConnections();
  }
  function renderMinecraftConnections() {
    $('#minecraft-connections').innerHTML = minecraftConnections.length ? minecraftConnections.map(item => `<article class="record"><div class="record-head"><b>${escapeHtml(item.name)}</b><span class="record-badge">${item.edition === 'java' ? 'JAVA' : 'BEDROCK'}</span></div><p>${escapeHtml(item.host)}:${item.port}</p><small>${escapeHtml(item.auth)}</small><div class="inline-actions"><button type="button" data-mc-test="${escapeHtml(item.id)}">Testar</button></div></article>`).join('') : '<p class="empty-state">Nenhum servidor cadastrado. Adicione um endereço acima.</p>';
  }
  async function testMinecraftConnection(input) {
    $('#minecraft-result').textContent = 'Consultando status real da rede…';
    try {
      const result = await post('/api/minecraft/test', input, 'POST', 'public');
      const status = result.result;
      $('#minecraft-result').textContent = `${status.online ? 'Online' : 'Offline'} · ${status.edition} · ${status.latency} ms · ${status.version || status.motd || status.description}`;
      return true;
    } catch (error) { $('#minecraft-result').textContent = error.message; return false; }
  }
  $('#minecraft-test').addEventListener('click', () => testMinecraftConnection(Object.fromEntries(new FormData($('#minecraft-connection-form')))));
  $('#minecraft-connection-form').addEventListener('submit', async event => {
    event.preventDefault(); const input = Object.fromEntries(new FormData(event.currentTarget));
    try { const result = await post('/api/minecraft/connections', input, 'POST', 'public'); minecraftConnections = result.connections; renderMinecraftConnections(); announce('Conexão Minecraft salva localmente.', 'app-notice', 'success'); }
    catch (error) { $('#minecraft-result').textContent = error.message; }
  });
  $('#minecraft-connections').addEventListener('click', async event => {
    const button = event.target.closest('[data-mc-test]'); if (!button) return;
    const connection = minecraftConnections.find(item => item.id === button.dataset.mcTest); if (connection) await testMinecraftConnection(connection);
  });
  $('#minecraft-access-form').addEventListener('submit', async event => {
    event.preventDefault(); const form = event.currentTarget;
    try { const result = await post('/api/minecraft/access', { players: form.elements.players.value.split(/\r?\n/), reconnect: form.elements.reconnect.checked }, 'PUT', 'public'); $('#minecraft-access-status').textContent = `Lista local salva com ${result.authorizedPlayers.length} jogador(es). Aplique a mesma lista no servidor.`; }
    catch (error) { $('#minecraft-access-status').textContent = error.message; }
  });
  $('#minecraft-setup-checklist').addEventListener('click', () => { $('#minecraft-checklist').hidden = !$('#minecraft-checklist').hidden; });

  let audioStream = null, audioContext = null, audioFrame = 0;
  const micButton = $('#core-mic-button'), micStatus = $('#mic-status'), welcomeCore = $('#welcome-core');
  function stopMic(message = 'Reação ao microfone desativada.') {
    if (audioFrame) cancelAnimationFrame(audioFrame);
    audioFrame = 0;
    if (audioStream) audioStream.getTracks().forEach(track => track.stop());
    audioStream = null;
    if (audioContext && audioContext.state !== 'closed') audioContext.close().catch(() => {});
    audioContext = null;
    welcomeCore.style.setProperty('--audio-level', '0');
    welcomeCore.classList.remove('audio-reactive');
    micButton.setAttribute('aria-pressed', 'false');
    micButton.innerHTML = 'Ativar reação ao microfone <span>◉</span>';
    micStatus.textContent = message;
  }
  micButton.addEventListener('click', async () => {
    if (audioStream) { stopMic(); return; }
    if (!navigator.mediaDevices?.getUserMedia || !(window.AudioContext || window.webkitAudioContext)) {
      stopMic('Microfone indisponível neste navegador. A animação normal continua ativa.'); return;
    }
    micButton.disabled = true;
    try {
      audioStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      audioContext = new AudioContextClass();
      const analyser = audioContext.createAnalyser(); analyser.fftSize = 256; analyser.smoothingTimeConstant = 0.82;
      audioContext.createMediaStreamSource(audioStream).connect(analyser);
      const samples = new Uint8Array(analyser.frequencyBinCount);
      micButton.setAttribute('aria-pressed', 'true'); micButton.innerHTML = 'Desativar reação ao microfone <span>◉</span>';
      welcomeCore.classList.add('audio-reactive'); micStatus.textContent = 'Reação visual ativa. O áudio é analisado localmente e não é gravado nem enviado.';
      const drawLevel = () => {
        if (!audioStream || document.hidden) return;
        analyser.getByteTimeDomainData(samples);
        let energy = 0; for (const sample of samples) { const value = (sample - 128) / 128; energy += value * value; }
        const level = Math.min(1, Math.sqrt(energy / samples.length) * 3.8);
        welcomeCore.style.setProperty('--audio-level', level.toFixed(3));
        audioFrame = requestAnimationFrame(drawLevel);
      };
      drawLevel();
    } catch (_error) {
      stopMic('Permissão negada ou microfone indisponível. A animação normal continua ativa.');
    } finally { micButton.disabled = false; }
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden && audioStream) stopMic('Reação pausada ao sair da página. Ative novamente quando quiser.'); });
  window.addEventListener('pagehide', () => { if (audioStream) stopMic('Reação encerrada.'); });
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const bootDuration = reducedMotion ? 300 : 4500;
  const bootScreen = $('#boot-screen');
  const bootSkipBtn = $('#boot-skip-button');
  const bootProgressBar = $('#boot-progress-bar');
  const bootTimer = $('#boot-timer');
  const bootPhaseTitle = $('#boot-phase-title');
  const bootPhaseDesc = $('#boot-phase-desc');

  let bootDone = false;
  let bootTimerInterval = null;
  const bootStartTime = Date.now();

  const bootPhases = [
    { at: 0, title: 'INICIALIZANDO O NÚCLEO', desc: 'Preparando a interface local N.E.X.U.S.…' },
    { at: 800, title: 'ESTRUTURAÇÃO DO SISTEMA', desc: 'Organizando os módulos e a experiência visual…' },
    { at: 1800, title: 'SINCRONIZANDO IDENTIDADE', desc: 'Carregando o perfil central e os recursos locais…' },
    { at: 3000, title: 'PREPARANDO O CONTEXTO', desc: 'A memória só será aberta após você entrar…' },
    { at: 4200, title: 'NÚCLEO N.E.X.U.S. ATIVO', desc: 'Pronto para continuar.' }
  ];

  function finishBoot() {
    if (bootDone) return;
    bootDone = true;
    if (bootTimerInterval) clearInterval(bootTimerInterval);
    bootScreen.classList.add('boot-screen-done');
    enterLocalMode();
    welcomeSpeakButton.hidden = voiceMode() === 'text';
    if (voiceMode() === 'voice') {
      window.setTimeout(() => speakText($('#welcome-narration').textContent, 'welcome'), 600);
    }
  }

  if (bootSkipBtn) {
    bootSkipBtn.addEventListener('click', () => finishBoot());
  }

  if (reducedMotion) {
    window.setTimeout(finishBoot, 300);
  } else {
    bootTimerInterval = setInterval(() => {
      const elapsed = Date.now() - bootStartTime;
      const progress = Math.min(1, elapsed / bootDuration);
      if (bootProgressBar) bootProgressBar.style.width = `${(progress * 100).toFixed(1)}%`;

      const remainingSec = Math.max(0, Math.ceil((bootDuration - elapsed) / 1000));
      if (bootTimer) bootTimer.textContent = `00:${remainingSec.toString().padStart(2, '0')}`;

      for (let i = bootPhases.length - 1; i >= 0; i--) {
        if (elapsed >= bootPhases[i].at) {
          if (bootPhaseTitle && bootPhaseTitle.textContent !== bootPhases[i].title) {
            bootPhaseTitle.textContent = bootPhases[i].title;
            bootPhaseTitle.classList.remove('phase-flash');
            void bootPhaseTitle.offsetWidth;
            bootPhaseTitle.classList.add('phase-flash');
          }
          if (bootPhaseDesc) bootPhaseDesc.textContent = bootPhases[i].desc;
          break;
        }
      }

      if (elapsed >= bootDuration) {
        finishBoot();
      }
    }, 100);
  }

  $('#create-context-form').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form));
    const button = $('button[type="submit"]', form); button.disabled = true;
    try {
      await post('/api/universes', { id: values.universeId.trim(), name: values.universeName.trim() }, 'POST', `Bearer ${values.adminToken}`);
      const created = await post('/api/users', { id: values.userId.trim(), displayName: values.displayName.trim(), universeId: values.universeId.trim() }, 'POST', `Bearer ${values.adminToken}`);
      const token = created.accessToken;
      if (!token) throw new Error('O núcleo não retornou a credencial inicial. Verifique o registro antes de tentar novamente.');
      window.alert(`Credencial de acesso (exibida uma única vez):\n\n${token}\n\nGuarde-a em local privado. Ela não será salva pelo aplicativo.`);
      form.reset();
      $('#login-form [name="userId"]').value = values.userId.trim();
      announce('Contexto criado. Use a credencial exibida para entrar.', 'setup-notice', 'success');
    } catch (error) { announce(error.message, 'setup-notice', 'error'); }
    finally { button.disabled = false; }
  });
  $('#login-form').addEventListener('submit', async event => {
    event.preventDefault(); const form = event.currentTarget; const values = Object.fromEntries(new FormData(form)); const token = values.accessToken;
    const button = $('button[type="submit"]', form); button.disabled = true;
    try {
      const result = await post("/api/context/activate", { userId: values.userId.trim(), universeId: values.universeId.trim() }, "POST", `Bearer ${token}`);
      session = { userId: values.userId.trim(), universeId: values.universeId.trim() }; sessionStorage.setItem(sessionKey, JSON.stringify(session));
      showAuthenticatedView(result.context); announce("Sessão local autenticada e protegida por cookie HttpOnly.", "app-notice", "success");
    } catch (error) { announce(error.message, "setup-notice", "error"); }
    finally { form.elements.accessToken.value = ""; button.disabled = false; }
  });
  $('#logout-button').addEventListener('click', () => logout('Sessão encerrada neste navegador.'));
  $('#context-universe-select').addEventListener('change', () => {
    $('#context-switch-button').disabled = !session || $('#context-universe-select').value === session.universeId;
  });
  $('#context-switch-button').addEventListener('click', async () => {
    if (!session || !$('#context-universe-select').value || $('#context-switch-button').disabled) return;
    const button = $('#context-switch-button'); button.disabled = true; setCoreState('PROCESSANDO');
    try {
      const result = await post('/api/context/switch', { universeId: $('#context-universe-select').value });
      session = { userId: result.context.userId, universeId: result.context.universeId };
      sessionStorage.setItem(sessionKey, JSON.stringify(session));
      showAuthenticatedView(result.context);
      announce('Universo trocado. Memória, conversas, objetivos e tarefas agora vêm do contexto selecionado.', 'app-notice', 'success');
    } catch (error) {
      setCoreState('ERRO'); announce(error.message, 'app-notice', 'error');
      await loadUniverseChoices().catch(() => {});
    } finally { button.disabled = false; }
  });
  $('#install-button').addEventListener('click', async () => { if (!state.deferredInstall) return; await state.deferredInstall.prompt(); state.deferredInstall = null; $('#install-button').hidden = true; });
  window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); state.deferredInstall = event; $('#install-button').hidden = false; $('#pwa-install').hidden = false; });
  $('#pwa-install').addEventListener('click', () => $('#install-button').click());
  if ('serviceWorker' in navigator && (location.protocol === 'http:' || location.protocol === 'https:' || location.hostname === 'localhost')) {
    let controlledBeforeUpdate = Boolean(navigator.serviceWorker.controller);
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (controlledBeforeUpdate) $('#update-button').hidden = false;
      controlledBeforeUpdate = true;
    });
    navigator.serviceWorker.register('/sw.js').then(reg => {
      if (navigator.onLine && typeof reg.update === 'function') {
        reg.update().catch(() => {});
      }
    }).catch(() => announce('Prévia disponível; cache offline não foi ativado.', 'app-notice', 'error'));
  }
  $('#update-button').addEventListener('click', () => location.reload());
  window.addEventListener('resize', () => { const activeLayout = document.body.classList.contains('layout-editing') ? state.layoutDraft : state.preferences; if (activeLayout) applyPanels(activeLayout); });
   $$('.nav-item').forEach(button => button.addEventListener('click', () => activateView(button.dataset.view)));
  $$('[data-open-view]').forEach(button => button.addEventListener('click', () => activateView(button.dataset.openView)));
  $('#app-grid').addEventListener('click', async event => {
    const goalButton = event.target.closest('[data-goal-progress]');
    const planButton = event.target.closest('[data-plan-goal]');
    const taskButton = event.target.closest('[data-task-action]');
    try {
      if (goalButton) {
        const goal = state.profile.goals.active.find(item => item.id === goalButton.dataset.goalProgress);
        const progress = window.prompt('Novo progresso (0 a 99). A conclusão exige evidências no fluxo correspondente:', String(goal?.progress ?? 0));
        if (progress === null) return;
        const value = Number(progress);
        if (!Number.isFinite(value) || value < 0 || value >= 100) throw new Error('Informe um progresso entre 0 e 99.');
        const observation = window.prompt('Registre uma observação para o histórico:', 'Atualização pelo aplicativo.');
        if (observation === null) return;
        await post(`/api/goals/${encodeURIComponent(goalButton.dataset.goalProgress)}`, { progress: value, observation }, 'PATCH');
        await loadProfile(); announce('Progresso do objetivo registrado.', 'app-notice', 'success');
      } else if (planButton) {
        const result = await post(`/api/goals/${encodeURIComponent(planButton.dataset.planGoal)}/plan`, {});
        announce(result.success === false ? 'O planejamento não foi concluído.' : 'Solicitação de planejamento enviada ao núcleo.', 'app-notice', 'success');
        await loadProfile();
      } else if (taskButton) {
        const id = taskButton.dataset.taskAction; const action = taskButton.dataset.action;
        let body = {};
        if (action === 'progress') { const progress = Number(window.prompt('Progresso da tarefa (0 a 99):', '10')); if (!Number.isFinite(progress) || progress < 0 || progress > 99) return; const observation = window.prompt('Observação do progresso:'); if (!observation) return; body = { progress, observation }; }
        if (action === 'complete') { const evidence = window.prompt('Evidência da conclusão (mínimo de 5 caracteres):'); if (!evidence) return; body = { evidence }; }
        const result = await post(`/api/tasks/${encodeURIComponent(id)}/${action}`, body);
        if (result.success === false) throw new Error(result.message || 'A tarefa não foi atualizada.');
        await loadProfile(); announce('Estado da tarefa atualizado.', 'app-notice', 'success');
      }
    } catch (error) { announce(error.message, 'app-notice', 'error'); }
  });
  $('#chat-form').addEventListener('submit', async event => {
    event.preventDefault(); const input = $('#chat-message'); const message = input.value.trim(); if (!message) return;
    const button = $('button[type="submit"]', event.currentTarget); button.disabled = true; setCoreState('ANALISANDO');
    const list = $('#conversation-list'); list.insertAdjacentHTML('beforeend', record('Usuário', message, new Date().toISOString(), 'PROCESSANDO')); const pendingMessage = list.lastElementChild;
    try {
      const useGenerative = $('#chat-generative-toggle').checked;
      const result = await post('/api/chat', { message, generative: useGenerative });
      const analysis = result.result?.analysis || {}; const decision = result.result?.decision || {};
      const generated = result.result?.reasoning?.generative?.status === 'available' ? result.result.reasoning.generative : null;
      const answer = generated?.answer || [decision.decision, decision.justification].filter(Boolean).join('\n\n') || 'O núcleo concluiu a análise local.';
      const assistantName = state.profile?.system?.identity?.name || 'N.E.X.U.S.';
      list.insertAdjacentHTML('beforeend', record(assistantName + (generated ? ` · ${generated.provider === 'openai' ? 'OpenAI' : 'Gemini'} (sugestão)` : ' · análise local'), answer, new Date().toISOString(), result.persistence?.memorySaved ? (generated ? 'IA · NÃO VERIFICADA' : 'REGISTRADO') : 'PERSISTÊNCIA PARCIAL'));
      const facts = (analysis.recordedKnowledge || []).map(item => item.topic + ': ' + item.statement);
      const inferences = [decision.reason, decision.uncertainty ? 'Incerteza: ' + (typeof decision.uncertainty === 'string' ? decision.uncertainty : JSON.stringify(decision.uncertainty)) : ''];
      const suggestions = (result.result?.reasoning?.suggestions || []).map(item => item.content || item.action || 'Sugestão sem conteúdo');
      $('#last-reasoning').innerHTML = '<div class="panel-kicker">' + (generated ? 'IA EXTERNA + AVALIAÇÃO LOCAL' : 'ANÁLISE LOCAL · GERAÇÃO EXTERNA DESATIVADA') + '</div><p>' + escapeHtml(analysis.analysis || 'Processamento local concluído.') + '</p><h3>Conhecimento armazenado (não verificado nesta análise)</h3><p>' + escapeHtml(facts.length ? facts.join('\n') : 'Nenhum fato persistente relacionado foi recuperado.') + '</p><h3>Inferências do núcleo</h3><p>' + escapeHtml(inferences.filter(Boolean).join('\n')) + '</p><h3>Sugestões do raciocínio</h3><p>' + escapeHtml(suggestions.length ? suggestions.join('\n') : 'Nenhuma sugestão foi produzida nesta análise.') + '</p><p class="muted">A geração externa não verifica fatos nem executa ações. Revise as sugestões antes de agir.</p>';
      if (result.persistence?.historySaved) { input.value = ''; await loadProfile(); } else { const badge = pendingMessage?.querySelector('.record-badge'); if (badge) badge.textContent = 'NÃO REGISTRADO'; list.insertAdjacentHTML('beforeend', record(state.profile?.system?.identity?.name || 'N.E.X.U.S.', answer, new Date().toISOString(), 'NÃO REGISTRADO')); announce('Análise concluída, mas o histórico não confirmou a gravação. A mensagem foi mantida no campo para você decidir como prosseguir.', 'app-notice', 'error'); }
      if (result.persistence?.historySaved) {
        const unavailable = result.result?.reasoning?.generative;
        const message = generated
          ? `Sugestão recebida de ${generated.provider === 'openai' ? 'OpenAI' : 'Gemini'} e marcada como não verificada.`
          : useGenerative && unavailable?.status === 'unavailable'
            ? unavailable.message
            : 'Análise local concluída; nenhuma API externa foi chamada.';
        announce(message, 'app-notice', result.persistence.memorySaved ? (useGenerative && !generated ? 'error' : 'success') : 'error');
      }
      if (decision.requiresHumanApproval) setCoreState('AGUARDANDO AUTORIZAÇÃO'); else setCoreState('DISPONÍVEL');
    } catch (error) { if (pendingMessage) { const badge = pendingMessage.querySelector('.record-badge'); if (badge) badge.textContent = 'FALHA'; } announce(error.message, 'app-notice', 'error'); setCoreState('ERRO'); }
    finally { button.disabled = false; $('#chat-generative-toggle').checked = false; }
  });
  $('#memory-form').addEventListener('submit', async event => {
    event.preventDefault(); const input = $('#memory-text');
    try { await post('/api/memory', { description: input.value.trim() }); input.value = ''; await loadProfile(); announce('Experiência registrada neste contexto.', 'app-notice', 'success'); }
    catch (error) { announce(error.message, 'app-notice', 'error'); }
  });
  $('#memory-review-button').addEventListener('click', refreshKnowledgeReview);
  $('#ai-configuration-form').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form));
    const submit = $('button[type="submit"]', form);
    submit.disabled = true;
    try {
      await api('/api/ai/session', { method: 'PUT', body: JSON.stringify(values) });
      form.elements.apiKey.value = '';
      await loadProfile();
      announce('Chave adicionada somente à memória deste processo e deste contexto. A conexão será confirmada no primeiro envio.', 'app-notice', 'success');
    } catch (error) { $('#ai-configuration-status').textContent = error.message; }
    finally { submit.disabled = false; }
  });
  $('#ai-clear-button').addEventListener('click', async () => {
    try {
      await api('/api/ai/session', { method: 'DELETE' });
      $('#ai-api-key').value = '';
      $('#chat-generative-toggle').checked = false;
      await loadProfile();
      announce('Chave de sessão removida da memória do processo.', 'app-notice', 'success');
    } catch (error) { $('#ai-configuration-status').textContent = error.message; }
  });
  $('#project-create-form').addEventListener('submit', async event => {
    event.preventDefault(); const form = event.currentTarget; const values = Object.fromEntries(new FormData(form)); const button = $('button[type="submit"]', form); button.disabled = true;
    try {
      const result = await post('/api/projects', values);
      if (!result.success) throw new Error('O projeto não foi salvo: ' + (result.status || 'erro de persistência'));
      form.reset(); await loadProfile(); showProject(result.project); announce('Projeto salvo e auditado neste contexto.', 'app-notice', 'success');
    } catch (error) { announce(error.message, 'app-notice', 'error'); }
    finally { button.disabled = false; }
  });
  $('#project-list').addEventListener('click', async event => {
    const button = event.target.closest('button[data-project-open],button[data-project-edit],button[data-project-archive],button[data-project-restore],button[data-project-delete]');
    if (!button) return;
    const id = button.dataset.projectOpen || button.dataset.projectEdit || button.dataset.projectArchive || button.dataset.projectRestore || button.dataset.projectDelete;
    button.disabled = true;
    try {
      if (button.dataset.projectOpen || button.dataset.projectEdit) showProject(await fetchProject(id), Boolean(button.dataset.projectEdit));
      else if (button.dataset.projectArchive) { const result = await post('/api/projects/' + encodeURIComponent(id) + '/archive', {}); if (!result.success) throw new Error('O projeto não foi arquivado.'); await loadProfile(); announce('Projeto arquivado; seus dados permanecem preservados.', 'app-notice', 'success'); }
      else if (button.dataset.projectRestore) { const result = await post('/api/projects/' + encodeURIComponent(id) + '/restore', {}); if (!result.success) throw new Error('O projeto não foi restaurado.'); await loadProfile(); announce('Projeto restaurado.', 'app-notice', 'success'); }
      else if (button.dataset.projectDelete) {
        const project = await fetchProject(id);
        if (!window.confirm('Excluir permanentemente o projeto arquivado “' + project.name + '”?')) return;
        const confirmation = window.prompt('Digite o nome exato do projeto arquivado para confirmar a exclusão:');
        if (confirmation !== project.name) { announce('Confirmação não corresponde ao nome; projeto preservado.', 'app-notice', 'error'); return; }
        const result = await api('/api/projects/' + encodeURIComponent(id), { method: 'DELETE', body: JSON.stringify({ confirmation }) });
        if (!result.success) throw new Error('A exclusão foi bloqueada: ' + (result.status || 'erro'));
        $('#project-detail').hidden = true; state.openProjectId = null; await loadProfile(); announce('Projeto excluído após confirmação explícita.', 'app-notice', 'success');
      }
    } catch (error) { announce(error.message, 'app-notice', 'error'); }
    finally { button.disabled = false; }
  });
  $('[data-project-filter]').forEach(button => button.addEventListener('click', () => { state.projectFilter = button.dataset.projectFilter; renderProjects(); }));
  $('#project-close').addEventListener('click', () => { $('#project-detail').hidden = true; $('#project-edit-area').hidden = true; state.openProjectId = null; });
  $('#project-edit-form').addEventListener('submit', async event => {
    event.preventDefault(); if (!state.openProjectId) return;
    const form = event.currentTarget; const values = Object.fromEntries(new FormData(form)); const button = $('button[type="submit"]', form); button.disabled = true;
    try {
      const result = await api('/api/projects/' + encodeURIComponent(state.openProjectId), { method: 'PATCH', body: JSON.stringify(values) });
      if (!result.success) throw new Error('As alterações não foram salvas: ' + (result.status || 'erro'));
      await loadProfile(); showProject(result.project, true); announce('Alterações salvas com nova revisão.', 'app-notice', 'success');
    } catch (error) { announce(error.message, 'app-notice', 'error'); }
    finally { button.disabled = false; }
  });
  $('#project-form').addEventListener('submit', async event => {
    event.preventDefault(); const form = event.currentTarget; const values = Object.fromEntries(new FormData(form)); const button = $('button[type="submit"]', form); button.disabled = true; setCoreState('PROCESSANDO');
    try {
      const response = await post('/api/projects/propose', values);
      const proposal = response.proposal;
      $('#project-proposal-result').innerHTML = '<article class="record"><div class="record-head"><b>Proposta preparada · ' + escapeHtml(proposal.name) + '</b><span class="record-badge">NÃO EXECUTADA</span></div><p>' + escapeHtml(proposal.description) + '</p><p>ID da proposta: ' + escapeHtml(proposal.id) + '</p><p>Arquivos iniciais: ' + escapeHtml(Object.keys(proposal.files).join(', ')) + '</p><small>O código não foi gravado nem executado. Qualquer criação no workspace exige autorização válida.</small></article>';
      form.reset(); announce('Proposta auditada; nenhum arquivo foi criado nem executado.', 'app-notice', 'success'); setCoreState('DISPONÍVEL');
    } catch (error) { announce(error.message, 'app-notice', 'error'); setCoreState('ERRO'); }
    finally { button.disabled = false; }
  });
  $('#goal-form').addEventListener('submit', async event => {
    event.preventDefault(); const values = Object.fromEntries(new FormData(event.currentTarget));
    try { const result = await post('/api/goals', values); if (result.success === false) throw new Error(result.message || 'Objetivo bloqueado pelo núcleo.'); event.currentTarget.reset(); await loadProfile(); announce('Objetivo registrado neste contexto.', 'app-notice', 'success'); }
    catch (error) { announce(error.message, 'app-notice', 'error'); }
  });
  $('#task-add-toggle').addEventListener('click', () => { const form = $('#task-form'); form.hidden = !form.hidden; });
  $('#task-form').addEventListener('submit', async event => {
    event.preventDefault(); const values = Object.fromEntries(new FormData(event.currentTarget));
    try { const result = await post('/api/tasks', values); if (result.success === false) throw new Error(result.task?.message || 'Tarefa não criada.'); event.currentTarget.reset(); event.currentTarget.hidden = true; await loadProfile(); announce('Tarefa registrada neste contexto.', 'app-notice', 'success'); }
    catch (error) { announce(error.message, 'app-notice', 'error'); }
  });
  $('#export-button').addEventListener('click', async () => {
    if (!window.NexusBackupCrypto) return announce('Este navegador não oferece WebCrypto; exportação criptografada indisponível.', 'app-notice', 'error');
    const passphrase = window.prompt('Crie uma senha forte com pelo menos 12 caracteres. A senha não será enviada nem salva:');
    if (!passphrase) return;
    try {
      const source = await api('/api/export');
      const backup = await window.NexusBackupCrypto.encryptBackup(source.backup, passphrase, source.digest);
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }); const link = document.createElement('a');
      const objectUrl = URL.createObjectURL(blob); link.href = objectUrl; link.download = `nexus-export-${state.context.userId}-${state.context.universeId}.nexus`; link.click(); window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
      announce('Exportação criptografada gerada. Ela não substitui backups do núcleo e não há restauração automática nesta versão.', 'app-notice', 'success');
    } catch (error) { announce(error.message || 'Não foi possível criar a exportação.', 'app-notice', 'error'); }
  });
  $('#layout-edit-toggle').addEventListener('click', event => {
    const active = event.currentTarget.getAttribute('aria-pressed') !== 'true';
    if (!active && !window.confirm('Descartar alterações de layout não salvas?')) return;
    event.currentTarget.setAttribute('aria-pressed', String(active));
    $('#layout-editor').hidden = !active;
    document.body.classList.toggle('layout-editing', active);
    if (active) { state.originalLayout = structuredClone(state.preferences); state.layoutDraft = structuredClone(state.preferences); captureWorkspacePositions(); }
    else { state.layoutDraft = null; state.originalLayout = null; }
    $$('[data-layout-control]').forEach(control => { control.disabled = !active; });
    if (state.profile) renderWorkspace(state.profile.goals, state.profile.tasks, active ? state.layoutDraft : state.preferences);
  });
  $('#panel-toggles').addEventListener('change', event => { const panel = event.target.dataset.panelToggle; if (!panel) return; state.layoutDraft.panels[panel] = event.target.checked; applyPanels(state.layoutDraft); });
  $('#panel-toggles').addEventListener('click', event => {
    const control = event.target.closest('[data-move-panel]'); if (!control || !state.layoutDraft) return;
    const panel = control.dataset.movePanel; const delta = Number(control.dataset.direction);
    for (const orientation of ['portrait', 'landscape']) { const layout = state.layoutDraft.layout[orientation]; const index = layout.indexOf(panel); const target = index + delta; if (index < 2 || target < 2 || target >= layout.length) continue; [layout[index], layout[target]] = [layout[target], layout[index]]; }
    renderPreferenceControls(state.layoutDraft); applyPanels(state.layoutDraft);
  });
  $('#reduced-motion').addEventListener('change', event => { state.layoutDraft.reducedMotion = event.target.checked; applyPanels(state.layoutDraft); });
  $('#layout-undo').addEventListener('click', () => { if (!state.originalLayout) return; state.layoutDraft = structuredClone(state.originalLayout); renderPreferenceControls(state.layoutDraft); applyPanels(state.layoutDraft); renderWorkspace(state.profile.goals, state.profile.tasks, state.layoutDraft); });
  $('#layout-reset').addEventListener('click', async () => { if (!window.confirm('Restaurar o layout padrão deste usuário e universo?')) return; try { const result = await api('/api/preferences/reset', { method: 'POST' }); state.preferences = result.preferences; state.layoutDraft = structuredClone(result.preferences); state.originalLayout = structuredClone(result.preferences); renderPreferenceControls(result.preferences); applyPanels(result.preferences); await loadProfile(); announce('Layout padrão restaurado.', 'app-notice', 'success'); } catch (error) { announce(error.message, 'app-notice', 'error'); } });
  $('#layout-save').addEventListener('click', async () => { if (!state.layoutDraft || !document.body.classList.contains('layout-editing')) return; try { const result = await post('/api/preferences', state.layoutDraft, 'PUT'); state.preferences = result.preferences; state.originalLayout = structuredClone(result.preferences); state.layoutDraft = structuredClone(result.preferences); renderWorkspace(state.profile.goals, state.profile.tasks, result.preferences); applyPanels(result.preferences); announce('Preferências salvas neste contexto.', 'app-notice', 'success'); } catch (error) { announce(error.message, 'app-notice', 'error'); } });
  $('#zoom-in').addEventListener('click', () => changeZoom(0.1)); $('#zoom-out').addEventListener('click', () => changeZoom(-0.1));
  $('#workspace-reset').addEventListener('click', () => { if (!state.layoutDraft || !document.body.classList.contains('layout-editing')) return; state.layoutDraft.workspace.panX = 0; state.layoutDraft.workspace.panY = 0; renderWorkspace(state.profile.goals, state.profile.tasks, state.layoutDraft); });
  function changeZoom(delta) { if (!state.preferences || !state.layoutDraft || !document.body.classList.contains('layout-editing')) return; state.layoutDraft.workspace.zoom = Math.max(0.7, Math.min(1.6, Math.round((state.layoutDraft.workspace.zoom + delta) * 10) / 10)); renderWorkspace(state.profile.goals, state.profile.tasks, state.layoutDraft); }
  const workspaceViewport = $('#workspace-viewport');
  workspaceViewport.addEventListener('click', event => {
    const control = event.target.closest('[data-width]');
    if (!control || !state.layoutDraft || !document.body.classList.contains('layout-editing')) return;
    const node = control.closest('.workspace-node'), id = node.dataset.nodeId;
    const current = state.layoutDraft.workspace.nodes[id] || { x: parseFloat(node.style.getPropertyValue('--node-x')) || 0, y: parseFloat(node.style.getPropertyValue('--node-y')) || 0, width: parseFloat(node.style.getPropertyValue('--node-width')) || 230 };
    const next = window.NexusLayoutGeometry.resizeNode(current, Number(control.dataset.width), state.layoutDraft.workspace.nodes, id);
    if (!next) { announce('O cartão não pode ser redimensionado porque atingiria outro painel.', 'app-notice', 'error'); return; }
    state.layoutDraft.workspace.nodes[id] = next; node.style.setProperty('--node-width', next.width + 'px');
  });
  workspaceViewport.addEventListener('pointerdown', event => {
    if (!document.body.classList.contains('layout-editing') || !state.layoutDraft) return;
    if (event.target.closest('button,a,input,textarea,select')) return;
    const node = event.target.closest('.workspace-node');
    if (node) { state.drag = { mode: 'node', id: node.dataset.nodeId, startX: event.clientX, startY: event.clientY, element: node, pointerId: event.pointerId }; node.setPointerCapture(event.pointerId); }
    else { state.drag = { mode: 'pan', startX: event.clientX, startY: event.clientY, pointerId: event.pointerId }; workspaceViewport.setPointerCapture(event.pointerId); }
  });
  workspaceViewport.addEventListener('pointermove', event => {
    if (!state.drag || state.drag.pointerId !== event.pointerId || !state.layoutDraft) return;
    const dx = event.clientX - state.drag.startX, dy = event.clientY - state.drag.startY;
    if (state.drag.mode === 'pan') {
      const next = window.NexusLayoutGeometry.clampPan(state.layoutDraft.workspace.panX + dx, state.layoutDraft.workspace.panY + dy, workspaceViewport.clientWidth, workspaceViewport.clientHeight, state.layoutDraft.workspace.zoom);
      Object.assign(state.layoutDraft.workspace, next);
      $('#workspace-canvas').style.transform = 'translate(' + next.panX + 'px,' + next.panY + 'px) scale(' + state.layoutDraft.workspace.zoom + ')';
    } else {
      const id = state.drag.id, node = state.drag.element;
      const current = state.layoutDraft.workspace.nodes[id] || { x: parseFloat(node.style.getPropertyValue('--node-x')) || 0, y: parseFloat(node.style.getPropertyValue('--node-y')) || 0, width: parseFloat(node.style.getPropertyValue('--node-width')) || 230 };
      const z = state.layoutDraft.workspace.zoom;
      const next = window.NexusLayoutGeometry.moveNode({ x: current.x + dx / z, y: current.y + dy / z, width: current.width }, state.layoutDraft.workspace.nodes, id);
      if (next) { state.layoutDraft.workspace.nodes[id] = next; node.style.setProperty('--node-x', next.x + 'px'); node.style.setProperty('--node-y', next.y + 'px'); node.removeAttribute('data-collision'); }
      else node.dataset.collision = 'true';
    }
    state.drag.startX = event.clientX; state.drag.startY = event.clientY;
  });
  const endWorkspacePointer = event => { if (state.drag && state.drag.pointerId === event.pointerId) { if (state.drag.element) state.drag.element.removeAttribute('data-collision'); state.drag = null; } };
  workspaceViewport.addEventListener('pointerup', endWorkspacePointer); workspaceViewport.addEventListener('pointercancel', endWorkspacePointer);
  $('[data-pan="up"]').addEventListener('click', () => panWorkspace(0, 88)); $('[data-pan="down"]').addEventListener('click', () => panWorkspace(0, -88));
  $('[data-pan="left"]').addEventListener('click', () => panWorkspace(88, 0)); $('[data-pan="right"]').addEventListener('click', () => panWorkspace(-88, 0));
  function panWorkspace(dx, dy) {
    if (!state.layoutDraft || !document.body.classList.contains('layout-editing')) return;
    const next = window.NexusLayoutGeometry.clampPan(state.layoutDraft.workspace.panX + dx, state.layoutDraft.workspace.panY + dy, workspaceViewport.clientWidth, workspaceViewport.clientHeight, state.layoutDraft.workspace.zoom);
    Object.assign(state.layoutDraft.workspace, next);
    $('#workspace-canvas').style.transform = 'translate(' + next.panX + 'px,' + next.panY + 'px) scale(' + state.layoutDraft.workspace.zoom + ')';
  }

  (async function boot() {
    try { const health = await api('/api/health', {}, 'public'); if (health.status !== 'online') throw new Error('Núcleo local indisponível.'); $('#health-dot').classList.add('online'); }
    catch (_error) { $('#health-dot').classList.remove('online'); setCoreState('INDISPONÍVEL'); $('#core-subtitle').textContent = 'Inicie a prévia local do projeto para conectar ao núcleo.'; }
    if (session) {
      try { const resumed = await api("/api/session"); showAuthenticatedView(resumed.context); }
      catch (_error) { logout("A sessão local expirou ou foi encerrada. Entre novamente com a credencial do contexto.", false); }
    }
    const hash = location.hash.slice(1); if (hash && document.getElementById(`view-${hash}`)) activateView(hash);
  })();
})();
