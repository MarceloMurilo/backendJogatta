// /middlewares/roleMiddleware.js
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

    // Captura o ID do jogo nos parâmetros ou no corpo da requisição
    const id_jogo = req.body?.id_jogo || req.params?.jogoId || null;

    console.log('[roleMiddleware] Status:', { skipIdJogo, optionalIdJogo, id_jogo });

    // Caso `skipIdJogo` esteja ativado, apenas verifica o papel do usuário
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

    // Se `optionalIdJogo` for falso e não houver `id_jogo`, retorna erro
    if (!id_jogo && !optionalIdJogo) {
      console.log('[roleMiddleware] Falha: ID do jogo é obrigatório.');
      return res.status(400).json({ message: 'ID do jogo é obrigatório.' });
    }

    // Se `optionalIdJogo` for true e `id_jogo` não for fornecido, apenas verifica o papel do usuário
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
      console.log('[roleMiddleware] Permissão concedida (id_jogo opcional não fornecido).');
      return next();
    }

    const { id } = req.user;
    console.log(
      `[roleMiddleware] Verificando papel do usuário (ID: ${id}) no jogo (ID: ${id_jogo || 'N/A'})`
    );

    try {
      // Define a query SQL com ou sem o `id_jogo`
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

      // Caso `id_jogo` seja fornecido, verifica se o usuário tem função válida no jogo
      if (id_jogo && result.rowCount === 0) {
        console.log(
          `[roleMiddleware] Usuário não possui função válida no jogo ${id_jogo}`
        );
        return res.status(403).json({
          message: 'Acesso negado - Você não tem permissão para este jogo.',
        });
      }

      const userRole = result.rows[0]?.nome_funcao || 'sem função';

      // Verifica se o papel do usuário está na lista de permitidos
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
