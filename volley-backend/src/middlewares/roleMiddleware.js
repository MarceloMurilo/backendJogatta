const roleMiddleware = (allowedRoles, options = {}) => {
  return async (req, res, next) => {
    console.log('Verificando permissões para usuário:', req.user);
    console.log('Parâmetros da rota no middleware:', req.params);

    const skipIdJogo = options.skipIdJogo || false;

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
      return next();
    }

    // Adicionado: Rotas sem id_jogo especificado no body ou params
    const { id_jogo } = req.body || req.params || {};
    if (!id_jogo && !options.optionalIdJogo) {
      console.log('[roleMiddleware] Falha: ID do jogo é obrigatório.');
      return res.status(400).json({ message: 'ID do jogo é obrigatório.' });
    }

    const { id } = req.user;
    console.log(
      `[roleMiddleware] Verificando papel do usuário (ID: ${id}) no jogo (ID: ${id_jogo})`
    );

    try {
      const query = `
        SELECT uf.id_funcao, f.nome_funcao 
          FROM usuario_funcao uf
          JOIN funcao f ON uf.id_funcao = f.id_funcao
         WHERE uf.id_usuario = $1
           AND uf.id_jogo = $2
           AND (uf.expira_em IS NULL OR uf.expira_em > NOW())
      `;
      const result = id_jogo
        ? await db.query(query, [id, id_jogo])
        : { rowCount: 1, rows: [{ nome_funcao: req.user.papel_usuario }] }; // Skip if id_jogo not required

      if (result.rowCount === 0) {
        console.log(
          `[roleMiddleware] Usuário não possui função válida no jogo ${id_jogo}`
        );
        return res.status(403).json({
          message: 'Acesso negado - Você não tem permissão para este jogo.',
        });
      }

      const userRole = result.rows[0].nome_funcao;
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
