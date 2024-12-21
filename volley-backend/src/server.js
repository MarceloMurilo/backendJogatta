const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const db = require('./db');

const app = express();

// Importando middlewares
const authMiddleware = require('./middlewares/authMiddleware');
const roleMiddleware = require('./middlewares/roleMiddleware');

// Importando rotas
const jogadorRoutes = require('./routes/jogador/jogadorRoutes');
const reservationRoutes = require('./routes/jogador/reservationRoutes');
const gameRoutes = require('./routes/jogador/gameRoutes');
const jogosRoutes = require('./routes/jogador/jogosRoutes');
const courtManagementRoutes = require('./routes/owner/courtManagementRoutes');
const ownerReservationsRoutes = require('./routes/owner/ownerReservationsRoutes');
const authRoutes = require('./routes/authRoutes');
const userRoutes = require('./routes/userRoutes');
const companyRoutes = require('./routes/companyRoutes');
const convitesRoutes = require('./routes/invites/inviteRoutes');
const convitesUserRoutes = require('./routes/invites/inviteUserRoutes');
const cepRoutes = require('./routes/cepRoutes/cepRoutes');
const groupRoutes = require('./routes/groupRoutes');
const amigosRoutes = require('./routes/amigosRoutes');
const avaliacoesRoutes = require('./routes/jogador/AvaliacoesRoutes');
const lobbyRoutes = require('./routes/invites/lobbyRoutes');

// Configurando middlewares globais
app.use(express.json());
app.use(cors());

// Middleware de logging
app.use((req, res, next) => {
  console.log(`\n=== Nova requisição recebida ===`);
  console.log(`Método: ${req.method}`);
  console.log(`URL: ${req.url}`);
  console.log(`Body:`, req.body);
  console.log('==============================\n');
  next();
});

// Configuração de rotas para jogadores
app.use('/api/jogador', authMiddleware, roleMiddleware(['jogador', 'organizador']), jogadorRoutes);
app.use('/api/jogador/reservas', authMiddleware, reservationRoutes);
app.use('/api/jogador/times', authMiddleware, gameRoutes);
app.use('/api/jogos', authMiddleware, jogosRoutes);

// Rotas para donos de quadras
app.use('/api/owner/quadras', authMiddleware, roleMiddleware(['owner']), courtManagementRoutes);
app.use('/api/owner/reservas', authMiddleware, ownerReservationsRoutes);

// Rotas de autenticação e usuários
app.use('/api/auth', authRoutes);
app.use('/api/usuario', userRoutes);

// Rotas para empresas
app.use('/api/empresas', authMiddleware, companyRoutes);

// Rotas para convites
app.use('/api/convites', authMiddleware, convitesRoutes);
app.use('/api/convites/usuario', authMiddleware, convitesUserRoutes);

// Rotas de avaliações
app.use('/api/avaliacoes', authMiddleware, avaliacoesRoutes);

// Rotas de amigos
app.use('/api/amigos', authMiddleware, amigosRoutes);

// Rotas grupo de amigos
app.use('/api/groups', groupRoutes);

// Rotas de lobby
app.use('/api/lobby', authMiddleware, lobbyRoutes);

// Rota para consulta de CEP
app.use('/api/cep', authMiddleware, cepRoutes);

// Rota de teste
app.get('/api/test', (req, res) => {
  res.json({ message: 'Rota de teste funcionando!' });
});

// Agendamento para encerrar jogos automaticamente
cron.schedule('*/5 * * * *', async () => {
  console.log('Verificando jogos que precisam ser encerrados...');
  try {
    const agora = new Date();

    // Atualiza status de jogos cujo horário fim já passou
    const result = await db.query(
      `UPDATE jogos SET status = 'encerrada'
       WHERE horario_fim < NOW() AND status = 'ativa'`
    );

    if (result.rowCount > 0) {
      console.log(`${result.rowCount} jogos encerrados automaticamente.`);
    }
  } catch (error) {
    console.error('Erro ao encerrar jogos automaticamente:', error);
  }
});

// Exibindo rotas registradas
app._router.stack.forEach(function (r) {
  if (r.route && r.route.path) {
    console.log(`Rota registrada: ${r.route.path} [${Object.keys(r.route.methods)}]`);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
