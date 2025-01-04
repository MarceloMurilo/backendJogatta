// /middlewares/roleMiddleware.js

const db = require('../db');

/**
 * Middleware para verificar as permissões do usuário.
 * @param {Array} allowedRoles - Lista de papéis permitidos (ex.: ['jogador', 'organizador']).
 * @param {Object} options - Opções adicionais (ex.: { skipIdJogo: true, optionalIdJogo: true }).
 *   - skipIdJogo: Se true, não verifica nenhum id_jogo (e ignora qualquer checagem de jogo).
 *   - optionalIdJogo: Se true, não é obrigatório fornecer id_jogo; mas se vier, será checado.
 */
const roleMiddleware = (allowedRoles, options = {}) => {
  // Função para determinar o fluxo com base na presença de id_jogo
  const determinarFluxo = (req) => {
    if (req.body?.id_jogo || req.params?.jogoId) {
      return 'online';
    }
    // Se quiser permitir setar explicitamente o fluxo no body ou params, manter essa linha
    return req.body?.fluxo || req.params?.fluxo || 'offline';
  };

  return async (req, res, next) => {
    console.log('=== [roleMiddleware] Início da Verificação ===');
    console.log(`[roleMiddleware] Usuário: ${req.user?.nome || 'Desconhecido'} (ID: ${req.user?.id || 'N/A'}), Papel: ${req.user?.papel_usuario || 'N/A'}`);
    console.log(`[roleMiddleware] Parâmetros da rota: ${JSON.stringify(req.params)}`);
    console.log(`[roleMiddleware] Corpo da requisição: ${JSON.stringify(req.body)}`);

    try {
      // Determinar o fluxo
      const fluxo = determinarFluxo(req);
      console.log('[roleMiddleware] Fluxo:', fluxo);

      // Validar valores aceitáveis para fluxo
      if (!['online', 'offline'].includes(fluxo)) {
        console.log(`[roleMiddleware] Fluxo inválido recebido: ${fluxo}`);
        return res.status(400).json({ message: 'Fluxo inválido.' });
      }

      // Ajustar opções com base no fluxo
      const skipIdJogo = options.skipIdJogo || fluxo === 'offline';
      const optionalIdJogo = options.optionalIdJogo || false;

      // Captura o ID do jogo nos parâmetros ou no body
      const id_jogo = req.body?.id_jogo || req.params?.jogoId || null;

      console.log('[roleMiddleware] Status:', {
        skipIdJogo,
        optionalIdJogo,
        id_jogo,
      });

      // 1) Verificar se o usuário é o organizador do jogo (caso permitido)
      if (req.body.id_usuario_organizador && req.body.id_usuario_organizador === req.user.id) {
        console.log('[roleMiddleware] Usuário é o organizador do jogo. Permissão concedida.');
        return next();
      }

      // 2) Se "skipIdJogo" for true, NÃO validamos nenhum id_jogo, só papel do usuário
        if (skipIdJogo) {
          const userRole = req.user?.papel_usuario;

          // Fluxo offline: Verifica diretamente o papel do usuário
          if (fluxo === 'offline' && allowedRoles.includes(userRole)) {
            console.log(`[roleMiddleware] Permissão concedida para '${userRole}' no fluxo offline.`);
            return next();
          }

          // Caso o papel do usuário não seja permitido
          if (!allowedRoles.includes(userRole)) {
            console.log(`[roleMiddleware] Papel '${userRole}' não autorizado no fluxo '${fluxo}' (skipIdJogo).`);
            return res.status(403).json({
              message: 'Acesso negado - Papel do usuário não autorizado.',
            });
          }

          console.log('[roleMiddleware] Permissão concedida (skipIdJogo ativo).');
          return next();
        }

        // Se chegou aqui, significa que skipIdJogo=true, porém fluxo não é offline
        // (ou seja, essa rota pode ter sido configurada manualmente com skipIdJogo = true)
        if (!allowedRoles.includes(userRole)) {
          console.log(`[roleMiddleware] Papel '${userRole}' não autorizado com skipIdJogo.`);
          return res.status(403).json({
            message: 'Acesso negado - Papel do usuário não autorizado.',
          });
        }

        console.log('[roleMiddleware] Permissão concedida (skipIdJogo ativo).');
        return next();
      }

      // 3) Se "optionalIdJogo" = true E não veio id_jogo, apenas verifica o papel do usuário
      if (!id_jogo && optionalIdJogo) {
        const userRole = req.user?.papel_usuario;
        if (!allowedRoles.includes(userRole)) {
          console.log(`[roleMiddleware] Papel '${userRole}' não autorizado sem id_jogo.`);
          return res.status(403).json({ message: 'Acesso negado - Papel do usuário não autorizado.' });
        }
        console.log('[roleMiddleware] Permissão concedida (id_jogo opcional não fornecido).');
        return next();
      }

      // 4) Se id_jogo é obrigatório e não foi fornecido, retorne erro
      if (!id_jogo) {
        console.log('[roleMiddleware] Falha: ID do jogo é obrigatório.');
        return res.status(400).json({ message: 'ID do jogo é obrigatório.' });
      }

      // 5) Verifica se o usuário tem papel no jogo (fluxo online)
      const { id } = req.user;
      console.log(`[roleMiddleware] Verificando papel do usuário (ID: ${id}) no jogo (ID: ${id_jogo})`);

      // Monta query para verificar se o usuário tem função associada ao jogo ou é o organizador
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
           AND j.id_usuario_organizador = $1
      `;
      const queryParams = [id, id_jogo];

      console.log('[roleMiddleware] Executando query para verificar função do usuário:', { query, queryParams });

      const result = await db.query(query, queryParams);

      // Se não tiver nenhuma função válida nesse jogo, nega acesso
      if (result.rowCount === 0) {
        console.log(`[roleMiddleware] Usuário não possui função válida no jogo ${id_jogo}`);
        return res.status(403).json({
          message: 'Acesso negado - Você não tem permissão para este jogo.',
        });
      }

      // Pega todas as funções associadas ao usuário no jogo
      const userRoles = result.rows.map(row => row.nome_funcao);
      console.log(`[roleMiddleware] Funções do usuário no jogo: ${userRoles.join(', ')}`);

      // Verifica se pelo menos uma das funções do usuário está nas allowedRoles
      const hasPermission = userRoles.some(role => allowedRoles.includes(role));

      if (!hasPermission) {
        console.log(`[roleMiddleware] Nenhuma das funções do usuário (${userRoles.join(', ')}) está autorizada para este endpoint.`);
        return res.status(403).json({
          message: 'Acesso negado - Papel do usuário não autorizado neste jogo.',
        });
      }

      console.log(`[roleMiddleware] Permissão concedida para o(s) papel(is) ${userRoles.join(', ')} no jogo ${id_jogo}.`);
      next();
    } catch (error) {
      console.error(`[roleMiddleware] Erro ao processar middleware: ${error.message}`);

      // Verificar se o erro é relacionado ao banco de dados
      if (error.code && error.code.startsWith('DB')) { 
        // Supondo que erros de banco de dados começam com 'DB'
        return res.status(500).json({ message: 'Erro no banco de dados.' });
      }

      // Erro genérico
      return res.status(500).json({ message: 'Erro interno no middleware.' });
    }
  };
};

module.exports = roleMiddleware;
