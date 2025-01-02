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
  return async (req, res, next) => {
    console.log('=== [roleMiddleware] Início da Verificação ===');
    console.log('Usuário autenticado:', req.user);
    console.log('Parâmetros da rota:', req.params);
    console.log('Corpo da requisição:', req.body);

    // Lê as opções
    const skipIdJogo = options.skipIdJogo || false;
    const optionalIdJogo = options.optionalIdJogo || false;

    // Captura o ID do jogo nos parâmetros ou no body
    const id_jogo = req.body?.id_jogo || req.params?.jogoId || null;

    console.log('[roleMiddleware] Status:', {
      skipIdJogo,
      optionalIdJogo,
      id_jogo,
    });

    // 1) Se "skipIdJogo" for true, NÃO validamos nenhum id_jogo, só papel do usuário
    if (skipIdJogo) {
      const userRole = req.user?.papel_usuario;
      if (!allowedRoles.includes(userRole)) {
        console.log(
          `[roleMiddleware] Função ${userRole} não autorizada para este endpoint.`
        );
        return res.status(403).json({
          message: 'Acesso negado - Papel do usuário não autorizado.',
        });
      }
      console.log('[roleMiddleware] Permissão concedida (skipIdJogo ativado).');
      return next();
    }

    // 2) Se não for "skipIdJogo", mas "optionalIdJogo" = false E id_jogo não existe -> erro
    if (!id_jogo && !optionalIdJogo) {
      console.log('[roleMiddleware] Falha: ID do jogo é obrigatório.');
      return res.status(400).json({ message: 'ID do jogo é obrigatório.' });
    }

    // 3) Se "optionalIdJogo" = true E não vier id_jogo, apenas verifica o papel do usuário
    if (optionalIdJogo && !id_jogo) {
      const userRole = req.user?.papel_usuario;
      if (!allowedRoles.includes(userRole)) {
        console.log(
          `[roleMiddleware] Função ${userRole} não autorizada para este endpoint.`
        );
        return res.status(403).json({
          message: 'Acesso negado - Papel do usuário não autorizado.',
        });
      }
      console.log(
        '[roleMiddleware] Permissão concedida (id_jogo opcional não fornecido).'
      );
      return next();
    }

    // 4) Se chegou até aqui, quer dizer que (optionalIdJogo = true e veio id_jogo)
    //    ou (optionalIdJogo = false e veio id_jogo). Então verificamos se o user tem papel no jogo

    const { id } = req.user;
    console.log(
      `[roleMiddleware] Verificando papel do usuário (ID: ${id}) no jogo (ID: ${id_jogo})`
    );

    try {
      // Monta query para verificar se o usuário tem alguma função associada àquele jogo
      const query = `
        SELECT uf.id_funcao, f.nome_funcao
          FROM usuario_funcao uf
          JOIN funcao f ON uf.id_funcao = f.id_funcao
         WHERE uf.id_usuario = $1
           AND uf.id_jogo = $2
      `;
      const queryParams = [id, id_jogo];

      console.log(
        '[roleMiddleware] Executando query para verificar função do usuário:',
        { query, queryParams }
      );

      const result = await db.query(query, queryParams);

      // Se não tiver NENHUMA função nesse jogo, barra
      if (result.rowCount === 0) {
        console.log(
          `[roleMiddleware] Usuário não possui função válida no jogo ${id_jogo}`
        );
        return res.status(403).json({
          message: 'Acesso negado - Você não tem permissão para este jogo.',
        });
      }

      // Tenta pegar a primeira função associada
      const userRole = result.rows[0]?.nome_funcao || 'sem função';

      // Verifica se a função do banco consta em allowedRoles
      if (!allowedRoles.includes(userRole)) {
        console.log(
          `[roleMiddleware] Função ${userRole} não autorizada para este endpoint.`
        );
        return res.status(403).json({
          message: 'Acesso negado - Papel do usuário não autorizado neste jogo.',
        });
      }

      console.log(
        `[roleMiddleware] Permissão concedida para o papel ${userRole} no jogo ${id_jogo}.`
      );
      next();
    } catch (error) {
      console.error('[roleMiddleware] Erro ao verificar função do usuário:', error);
      return res.status(500).json({
        message: 'Erro interno no servidor ao validar permissões.',
      });
    }
  };
};

module.exports = roleMiddleware;
