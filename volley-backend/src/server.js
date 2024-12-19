const express = require('express');
const cors = require('cors');
const app = express();

const authMiddleware = require('./middlewares/authMiddleware');
const roleMiddleware = require('./middlewares/roleMiddleware');

// Jogo Rápido
const jogoRapidoRoutes = require('./routes/jogador/jogoRapido');

// Importando rotas para jogadores
const jogadorRoutes = require('./routes/jogador/jogadorRoutes');
const reservationRoutes = require('./routes/jogador/reservationRoutes');
const gameRoutes = require('./routes/jogador/gameRoutes');
const jogosRoutes = require('./routes/jogador/jogosRoutes');

// Importando rotas para donos de quadras
const courtManagementRoutes = require('./routes/owner/courtManagementRoutes');
const ownerReservationsRoutes = require('./routes/owner/ownerReservationsRoutes');

// Importando autenticação e usuário
const authRoutes = require('./routes/authRoutes');
const userRoutes = require('./routes/userRoutes');

// Importando rotas para empresas
const companyRoutes = require('./routes/companyRoutes');

// Importando rotas para convites
const convitesRoutes = require('./routes/invites/inviteRoutes');
const convitesUserRoutes = require('./routes/invites/inviteUserRoutes');

// Import de CEP
const cepRoutes = require('./routes/cepRoutes/cepRoutes');

// Import Grupo amigos
const groupRoutes = require('./routes/groupRoutes');

// Import de amigos e avaliações
const amigosRoutes = require('./routes/amigosRoutes');
const avaliacoesRoutes = require('./routes/jogador/AvaliacoesRoutes');

// Lobby
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

// Rotas para lobby (AQUI FOI ADICIONADO authMiddleware)
app.use('/api/lobby', authMiddleware, lobbyRoutes);

// Rotas de amigos
app.use('/api/amigos', authMiddleware, amigosRoutes);

// Rotas de equilíbrio de times e jogos
app.use('/api/jogos', authMiddleware, jogosRoutes);
app.use('/api/jogador/times', authMiddleware, gameRoutes);

// Rotas grupo de amigos
app.use('/api/groups', groupRoutes);

// Rotas de avaliações
app.use('/api/avaliacoes', authMiddleware, avaliacoesRoutes);

// Rotas para donos de quadras
app.use('/api/owner/quadras', authMiddleware, roleMiddleware(['owner']), courtManagementRoutes);
app.use('/api/owner/reservas', authMiddleware, ownerReservationsRoutes);

// Rotas para empresas
app.use('/api/empresas', authMiddleware, companyRoutes);

// Rotas para convites
app.use('/api/convites', authMiddleware, convitesRoutes);
app.use('/api/convites/usuario', authMiddleware, convitesUserRoutes);

// Rotas de autenticação e usuários
app.use('/api/auth', authRoutes);
app.use('/api/usuario', userRoutes);

// Rota para consulta de CEP
app.use('/api/cep', authMiddleware, cepRoutes);

// Rota de teste
app.get('/api/test', (req, res) => {
  res.json({ message: 'Rota de teste funcionando!' });
});

app._router.stack.forEach(function (r) {
  if (r.route && r.route.path) {
    console.log(`Rota registrada: ${r.route.path} [${Object.keys(r.route.methods)}]`);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
