// middlewares/roleMiddleware.js
const db = require('../db');

/**
 * @param {Array} allowedRoles - lista de papéis permitidos
 * @param {Object} options - opções adicionais (ex.: { skipIdJogo: true })
 */
const roleMiddleware = (allowedRoles, options = {}) => {
  
  return async (req, res, next) => {
    console.log('Verificando permissões para usuário:', req.user); // Log do usuário autenticado
  console.log('Parâmetros da rota no middleware:', req.params); // Verificar os parâmetros antes de qualquer modificação
    const skipIdJogo = options.skipIdJogo || false;
    
    // Se a rota não exigir id_jogo, apenas valida se o usuário tem papel válido
    if (skipIdJogo) {
      const userRole = req.user?.papel_usuario;
      if (!allowedRoles.includes(userRole)) {
        console.log(`[roleMiddleware] Função ${userRole} não autorizada para este endpoint.`);
        return res.status(403).json({ message: 'Acesso negado - Papel do usuário não autorizado.' });
      }
      return next();
    }

    // Caso contrário, exige id_jogo no body ou params
    const { id_jogo } = req.body || req.params;

    if (!id_jogo) {
      return res.status(400).json({ message: 'ID do jogo é obrigatório.' });
    }

    const { id } = req.user; // ID do usuário autenticado
    console.log(`[roleMiddleware] Verificando papel do usuário (ID: ${id}) no jogo (ID: ${id_jogo})`);

    try {
      const query = `
        SELECT uf.id_funcao, f.nome_funcao 
FROM usuario_funcao uf
JOIN funcao f ON uf.id_funcao = f.id_funcao
WHERE uf.id_usuario = $1 AND uf.id_jogo = $2 AND (uf.expira_em IS NULL OR uf.expira_em > NOW())

      `;
      const result = await db.query(query, [id, id_jogo]);

      if (result.rowCount === 0) {
        console.log(`[roleMiddleware] Usuário não possui função válida no jogo ${id_jogo}`);
        return res.status(403).json({ message: 'Acesso negado - Você não tem permissão para este jogo.' });
      }

      const userRole = result.rows[0].nome_funcao;
      if (!allowedRoles.includes(userRole)) {
        console.log(`[roleMiddleware] Função ${userRole} não autorizada para este endpoint.`);
        return res.status(403).json({ message: 'Acesso negado - Papel do usuário não autorizado neste jogo.' });
      }

      console.log(`[roleMiddleware] Permissão concedida para o papel ${userRole}`);
      next();
    } catch (error) {
      console.error(`[roleMiddleware] Erro ao verificar função do usuário:`, error);
      return res.status(500).json({ message: 'Erro interno no servidor ao validar permissões.' });
    }
  };
};

module.exports = roleMiddleware;
