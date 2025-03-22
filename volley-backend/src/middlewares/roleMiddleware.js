// src/middlewares/roleMiddleware.js

const db = require('../config/db');

/**
 * Middleware para verificar as permissões do usuário com lógica avançada de:
 *  - Fluxo 'online' (se houver id_jogo) ou 'offline' (sem id_jogo),
 *  - AllowedRoles (['jogador', 'organizador', 'owner', 'superadmin', etc.]),
 *  - skipIdJogo ou optionalIdJogo, se necessário.
 *
 * @param {Array} allowedRoles - Ex.: ['jogador', 'organizador', 'owner', 'superadmin'].
 * @param {Object} options - (opcional) { skipIdJogo: bool, optionalIdJogo: bool }.
 */
const roleMiddleware = (allowedRoles, options = {}) => {
  // Função auxiliar para determinar fluxo com base em id_jogo
  const determinarFluxo = (req) => {
    if (req.body?.id_jogo || req.params?.jogoId) {
      return 'online';
    }
    return req.body?.fluxo || req.params?.fluxo || 'offline';
  };

  return async (req, res, next) => {
    // Se for requisição OPTIONS, ignora
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
      // Exceção para superadmin
      if (req.user?.papel_usuario === 'superadmin') {
        console.log('[roleMiddleware] Usuário é superadmin. Acesso permitido automaticamente.');
        return next();
      }
      
      // Caso especial para rotas de reserva
      if (req.path.includes('/reservas/') && req.path.includes('/status')) {
        console.log('[roleMiddleware] Rota de gerenciamento de reserva detectada');
        if (['empresa', 'dono_quadra', 'admin'].includes(req.user?.papel_usuario)) {
          console.log(`[roleMiddleware] Usuário é ${req.user.papel_usuario}. Permitindo acesso à rota de reserva.`);
          return next();
        }
      }

      // Determina o fluxo ('online' ou 'offline')
      const fluxo = determinarFluxo(req);
      console.log('[roleMiddleware] Fluxo determinado:', fluxo);

      // Validação do fluxo
      if (!['online', 'offline'].includes(fluxo)) {
        console.log(`[roleMiddleware] Fluxo inválido: ${fluxo}`);
        return res.status(400).json({ message: 'Fluxo inválido.' });
      }

      // Lê as options
      const skipIdJogo = options.skipIdJogo || fluxo === 'offline';
      const optionalIdJogo = options.optionalIdJogo || false;
      const id_jogo = req.body?.id_jogo || req.params?.jogoId || null;

      console.log('[roleMiddleware] Status (config):', { skipIdJogo, optionalIdJogo, id_jogo });

      // Se o body indicar que o usuário é o organizador, libera
      if (req.body?.id_usuario_organizador && req.body.id_usuario_organizador === req.user.id) {
        console.log('[roleMiddleware] Usuário é o organizador no corpo da requisição. OK.');
        return next();
      }

      // Se skipIdJogo = true, checa apenas se o papel está permitido
      if (skipIdJogo) {
        const userRole = req.user?.papel_usuario;
        if (fluxo === 'offline' && allowedRoles.includes(userRole)) {
          console.log(`[roleMiddleware] Permissão concedida (offline) para papel '${userRole}'.`);
          return next();
        }
        if (!allowedRoles.includes(userRole)) {
          console.log(`[roleMiddleware] Papel '${userRole}' não autorizado no fluxo '${fluxo}' (skipIdJogo).`);
          return res.status(403).json({ message: 'Acesso negado - Papel do usuário não autorizado (skipIdJogo).' });
        }
        console.log('[roleMiddleware] Permissão concedida (skipIdJogo ativo).');
        return next();
      }

      // Se optionalIdJogo = true e não veio id_jogo, checa apenas o papel
      if (!id_jogo && optionalIdJogo) {
        const userRole = req.user?.papel_usuario;
        if (!allowedRoles.includes(userRole)) {
          console.log(`[roleMiddleware] Papel '${userRole}' não autorizado sem id_jogo.`);
          return res.status(403).json({ message: 'Acesso negado - Papel do usuário não autorizado (id_jogo ausente).' });
        }
        console.log('[roleMiddleware] Permissão concedida (id_jogo é opcional e não veio).');
        return next();
      }

      // Se id_jogo for obrigatório e não for fornecido
      if (!id_jogo) {
        console.log('[roleMiddleware] Falha: ID do jogo é obrigatório e não veio.');
        return res.status(400).json({ message: 'ID do jogo é obrigatório.' });
      }

      // Checa se o usuário possui função no jogo
      const { id } = req.user;
      console.log(`[roleMiddleware] Checando função do user (ID: ${id}) no jogo (ID: ${id_jogo}).`);

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
      `;
      const queryParams = [id, id_jogo];

      console.log('[roleMiddleware] Query p/ função do usuário:', { query, queryParams });
      console.log('[roleMiddleware] Type of db.query:', typeof db.query);

      const result = await db.query(query, queryParams);
      console.log('[roleMiddleware] Resultado da query:', result);

      if (result.rowCount === 0) {
        console.log(`[roleMiddleware] Usuário não tem função no jogo ${id_jogo}. Acesso negado.`);
        return res.status(403).json({ message: 'Acesso negado - Você não tem permissão para este jogo.' });
      }

      const userRoles = result.rows.map(row => row.nome_funcao);
      console.log(`[roleMiddleware] Funções do user nesse jogo: ${userRoles.join(', ')}`);

      const hasPermission = userRoles.some(role => allowedRoles.includes(role));
      if (!hasPermission) {
        console.log(`[roleMiddleware] Nenhuma das funções do usuário [${userRoles.join(', ')}] é permitida para este endpoint (exige: ${allowedRoles.join(', ')}).`);
        return res.status(403).json({ message: 'Acesso negado - Papel do usuário não autorizado neste jogo.' });
      }

      console.log(`[roleMiddleware] Permissão concedida. Roles do user: ${userRoles.join(', ')}`);
      next();
    } catch (error) {
      console.error(`[roleMiddleware] Erro ao processar middleware: ${error.message}`);
      return res.status(500).json({ message: 'Erro interno no middleware.', details: error.message });
    }
  };
};

module.exports = roleMiddleware;
