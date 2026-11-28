'use strict';

(function exposePresentation(root, factory) {
  const presentation = factory();
  if (typeof module === 'object' && module.exports) module.exports = presentation;
  if (root) root.NexusPresentation = presentation;
})(typeof window === 'undefined' ? null : window, function createPresentation() {
  function conversationEntries(history, identityName = 'N.E.X.U.S.', limit = 40) {
    if (!Array.isArray(history)) return [];
    return history.slice(-Math.max(1, Math.min(100, Number(limit) || 40))).map(item => {
      const user = item && item.role === 'user';
      const content = typeof item?.content === 'string' ? item.content :
        typeof item?.parts?.[0]?.text === 'string' ? item.parts[0].text : '';
      return {
        role: user ? 'user' : 'assistant',
        title: user ? 'Usuário' : String(identityName || 'N.E.X.U.S.'),
        content,
        timestamp: typeof item?.timestamp === 'string' ? item.timestamp : '',
        badge: 'HISTÓRICO',
        provenance: user ? 'entrada_do_usuario' : 'resposta_registrada_sem_origem_verificada'
      };
    }).filter(item => item.content.trim());
  }
  return Object.freeze({ conversationEntries });
});
