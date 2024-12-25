const db = require('../db');

// Middleware para verificar o papel do usuário no jogo específico
const roleMiddleware = (allowedRoles) => {
  return async (req, res, next) => {
    const { id } = req.user; // ID do usuário autenticado
    const { id_jogo } = req.body; // ID do jogo fornecido na requisição

    console.log('Papel do usuário:', req.user.papel_usuario);
    console.log('Papéis permitidos:', allowedRoles);

    // Verificar no escopo de um jogo
    try {
      const query = `
        SELECT uf.id_funcao, f.nome_funcao 
        FROM usuario_funcao uf
        JOIN funcao f ON uf.id_funcao = f.id_funcao
        WHERE uf.id_usuario = $1 AND uf.id_jogo = $2 AND uf.expira_em > NOW()
      `;
      const result = await db.query(query, [id, id_jogo]);

      if (result.rowCount === 0) {
        return res.status(403).json({ message: 'Acesso negado - Você não tem permissão para este jogo.' });
      }

      const userRole = result.rows[0].nome_funcao;

      if (!allowedRoles.includes(userRole)) {
        return res.status(403).json({ message: 'Acesso negado - Papel do usuário não autorizado neste jogo.' });
      }

      next(); // Permissão validada, prossegue
    } catch (error) {
      console.error('Erro ao verificar função do usuário:', error);
      return res.status(500).json({ message: 'Erro interno no servidor ao validar permissões.' });
    }
  };
};

module.exports = roleMiddleware;
