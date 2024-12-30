// middlewares/roleMiddleware.js
const db = require('../db');

/**
 * Middleware para verificar as permissões do usuário.
 * @param {Array} allowedRoles - Lista de papéis permitidos.
 * @param {Object} options - Opções adicionais (ex.: { skipIdJogo: true, optionalIdJogo: true }).
 */
const roleMiddleware = (allowedRoles, options = {}) => {
  return async (req, res, next) => {
    console.log('=== [roleMiddleware] Início da Verificação ===');
    console.log('Usuário autenticado:', req.user);
    console.log('Parâmetros da rota:', req.params);
    console.log('Corpo da requisição:', req.body);

    const skipIdJogo = options.skipIdJogo || false;
    const optionalIdJogo = options.optionalIdJogo || false;

    const id_jogo = req.body?.id_jogo || req.params?.id_jogo || null;

    console.log('[roleMiddleware] Status:', { skipIdJogo, optionalIdJogo, id_jogo });

    // Se for para ignorar verificação de id_jogo, basta checar se o papel do usuário está na lista
    if (skipIdJogo) {
      const userRole = req.user?.papel_usuario;
      if (!allowedRoles.includes(userRole)) {
        console.log(
          `[roleMiddleware] Função ${userRole} não autorizada para este endpoint.`
        );
        return res
          .status(403)
          .json({ message: 'Acesso negado - Papel do usuário não autorizado.' });
      }
      console.log('[roleMiddleware] Permissão concedida (skipIdJogo ativado).');
      return next();
    }

    // Se não for opcional, precisa ter o id_jogo
    if (!id_jogo && !optionalIdJogo) {
      console.log('[roleMiddleware] Falha: ID do jogo é obrigatório.');
      return res.status(400).json({ message: 'ID do jogo é obrigatório.' });
    }

    const { id } = req.user;
    console.log(
      `[roleMiddleware] Verificando papel do usuário (ID: ${id}) no jogo (ID: ${id_jogo || 'N/A'})`
    );

    try {
      // Removido "AND (uf.expira_em IS NULL OR uf.expira_em > NOW())", pois não queremos mais expiração
      const query = `
        SELECT uf.id_funcao, f.nome_funcao
          FROM usuario_funcao uf
          JOIN funcao f ON uf.id_funcao = f.id_funcao
         WHERE uf.id_usuario = $1
           ${id_jogo ? 'AND uf.id_jogo = $2' : ''}
      `;
      const queryParams = id_jogo ? [id, id_jogo] : [id];

      console.log('[roleMiddleware] Executando query para verificar função do usuário:', {
        query,
        queryParams,
      });

      const result = await db.query(query, queryParams);

      if (id_jogo && result.rowCount === 0) {
        console.log(
          `[roleMiddleware] Usuário não possui função válida no jogo ${id_jogo}`
        );
        return res.status(403).json({
          message: 'Acesso negado - Você não tem permissão para este jogo.',
        });
      }

      const userRole = result.rows[0]?.nome_funcao || 'sem função';
      if (!allowedRoles.includes(userRole)) {
        console.log(
          `[roleMiddleware] Função ${userRole} não autorizada para este endpoint.`
        );
        return res.status(403).json({
          message: 'Acesso negado - Papel do usuário não autorizado neste jogo.',
        });
      }

      console.log(`[roleMiddleware] Permissão concedida para o papel ${userRole}`);
      next();
    } catch (error) {
      console.error(`[roleMiddleware] Erro ao verificar função do usuário:`, error);
      return res
        .status(500)
        .json({ message: 'Erro interno no servidor ao validar permissões.' });
    }
  };
};

module.exports = roleMiddleware;
