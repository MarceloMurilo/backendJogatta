// src/middlewares/roleMiddleware.js
const db = require('../config/db');

/**
 * Middleware para verificar as permissões do usuário com lógica avançada de:
 *  - Fluxo 'online' (se houver id_jogo) ou 'offline' (sem id_jogo),
 *  - AllowedRoles (ex.: ['jogador', 'organizador', 'owner', 'superadmin']),
 *  - skipIdJogo ou optionalIdJogo, se necessário.
 *
 * @param {Array} allowedRoles - Ex.: ['jogador', 'organizador', 'owner', 'superadmin'].
 * @param {Object} options - (opcional) { skipIdJogo: bool, optionalIdJogo: bool }.
 */
const roleMiddleware = (allowedRoles, options = {}) => {
  // Função auxiliar para determinar o fluxo com base na presença de id_jogo
  const determinarFluxo = (req) => {
    if (req.body?.id_jogo || req.params?.jogoId) {
      return 'online';
    }
    return req.body?.fluxo || req.params?.fluxo || 'offline';
  };

  return async (req, res, next) => {
    // Permite requisições OPTIONS sem validação
    if (req.method === 'OPTIONS') {
      console.log('[roleMiddleware] OPTIONS request, skipping...');
      return next();
    }

    console.log('=== [roleMiddleware] Início da Verificação ===');
    console.log('[roleMiddleware] db object:', db);
    console.log(
      `[roleMiddleware] Usuário: ${req.user?.nome || 'Desconhecido'} (ID: ${req.user?.id || 'N/A'}), Papel: ${req.user?.papel_usuario || 'N/A'}`
    );
    console.log(`[roleMiddleware] Parâmetros da rota: ${JSON.stringify(req.params)}`);
    console.log(`[roleMiddleware] Body da requisição: ${JSON.stringify(req.body)}`);

    try {
      // Se o usuário for superadmin, permite acesso automaticamente
      if (req.user?.papel_usuario === 'superadmin') {
        console.log('[roleMiddleware] Usuário é superadmin. Acesso permitido automaticamente.');
        return next();
      }

      // Caso especial: rotas de reserva com status
      if (req.path.includes('/reservas/') && req.path.includes('/status')) {
        console.log('[roleMiddleware] Rota de gerenciamento de reserva detectada');
        if (['empresa', 'dono_quadra', 'admin', 'gestor'].includes(req.user?.papel_usuario)) {
          console.log(`[roleMiddleware] Usuário é ${req.user.papel_usuario}. Permitindo acesso.`);
          return next();
        }
      }

      // Determina o fluxo ('online' ou 'offline')
      const fluxo = determinarFluxo(req);
      console.log('[roleMiddleware] Fluxo determinado:', fluxo);

      if (!['online', 'offline'].includes(fluxo)) {
        console.log(`[roleMiddleware] Fluxo inválido: ${fluxo}`);
        return res.status(400).json({ message: 'Fluxo inválido.' });
      }

      // Configurações baseadas nas options
      const skipIdJogo = options.skipIdJogo || fluxo === 'offline';
      const optionalIdJogo = options.optionalIdJogo || false;
      const id_jogo = req.body?.id_jogo || req.params?.jogoId || null;

      console.log('[roleMiddleware] Config:', { skipIdJogo, optionalIdJogo, id_jogo });

      // Se o corpo indicar que o usuário é o organizador, libera acesso
      if (req.body?.id_usuario_organizador && req.body.id_usuario_organizador === req.user.id) {
        console.log('[roleMiddleware] Usuário é o organizador conforme body. Acesso permitido.');
        return next();
      }

      // Se skipIdJogo estiver ativo, apenas verifica se o papel está permitido
      if (skipIdJogo) {
        const userRole = req.user?.papel_usuario;
        if (allowedRoles.includes(userRole)) {
          console.log(`[roleMiddleware] Permissão concedida para papel '${userRole}' (skipIdJogo).`);
          return next();
        } else {
          console.log(`[roleMiddleware] Papel '${userRole}' não autorizado (skipIdJogo).`);
          return res.status(403).json({ message: 'Acesso negado - Papel do usuário não autorizado (skipIdJogo).' });
        }
      }

      // Se id_jogo for opcional e não fornecido, verifica somente o papel
      if (!id_jogo && optionalIdJogo) {
        const userRole = req.user?.papel_usuario;
        if (allowedRoles.includes(userRole)) {
          console.log(`[roleMiddleware] Permissão concedida para papel '${userRole}' (id_jogo opcional não fornecido).`);
          return next();
        } else {
          console.log(`[roleMiddleware] Papel '${userRole}' não autorizado sem id_jogo.`);
          return res.status(403).json({ message: 'Acesso negado - Papel do usuário não autorizado (id_jogo ausente).' });
        }
      }

      // Se id_jogo for obrigatório e não estiver presente
      if (!id_jogo) {
        console.log('[roleMiddleware] Falha: ID do jogo é obrigatório e não veio.');
        return res.status(400).json({ message: 'ID do jogo é obrigatório.' });
      }

      // Checa se o usuário possui função no jogo
      const { id } = req.user;
      console.log(`[roleMiddleware] Verificando função do usuário (ID: ${id}) no jogo (ID: ${id_jogo}).`);

      const query = `
        SELECT uf.id_funcao, f.nome_funcao
          FROM usuario_funcao uf
          JOIN funcao f ON uf.id_funcao = f.id_funcao
         WHERE uf.id_usuario = $1
           AND uf.id_jogo = $2
        UNION
        SELECT f.id_funcao, f.nome_funcao
          FROM jogos j
          JOIN funcao f ON f.nome_funcao = 'organizador'
         WHERE j.id_jogo = $2
           AND j.id_usuario = $1
        UNION
        SELECT f.id_funcao, f.nome_funcao
          FROM jogos j
          JOIN quadras q ON j.id_quadra_id = q.id_quadra
          JOIN funcao f ON f.nome_funcao = 'gestor'
         WHERE j.id_jogo = $2
           AND q.id_usuario = $1
      `;
      const queryParams = [id, id_jogo];

      console.log('[roleMiddleware] Executando query:', { query, queryParams });
      const result = await db.query(query, queryParams);
      console.log('[roleMiddleware] Resultado da query:', result);

      if (result.rowCount === 0) {
        console.log(`[roleMiddleware] Usuário sem função no jogo ${id_jogo}. Acesso negado.`);
        return res.status(403).json({ message: 'Acesso negado - Você não tem permissão para este jogo.' });
      }

      const userRoles = result.rows.map(row => row.nome_funcao);
      console.log(`[roleMiddleware] Funções do usuário: ${userRoles.join(', ')}`);

      const hasPermission = userRoles.some(role => allowedRoles.includes(role));
      if (!hasPermission) {
        console.log(`[roleMiddleware] Nenhuma das funções [${userRoles.join(', ')}] é permitida. Exigidos: ${allowedRoles.join(', ')}`);
        return res.status(403).json({ message: 'Acesso negado - Papel do usuário não autorizado neste jogo.' });
      }

      console.log(`[roleMiddleware] Acesso concedido para usuário com papel '${req.user.papel_usuario}'.`);
      next();
    } catch (error) {
      console.error('[roleMiddleware] Erro interno:', error.message);
      return res.status(500).json({ message: 'Erro interno no middleware.', details: error.message });
    }
  };
};

module.exports = roleMiddleware;
