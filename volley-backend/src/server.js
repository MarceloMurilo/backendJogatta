// src/server.js
const path = require('path');
require('dotenv').config({
  path: path.join(__dirname, '..', '.env'),
});

const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const db = require('./db.js');
const fs = require('fs');
const passport = require('./config/passport.js');

const app = express();

app.get('/', (req, res) => {
  res.status(200).send('Backend do Jogatta está online! 🚀');
});

app.get('/politica-privacidade', (req, res) => {
  res.send(`
    <h1>Política de Privacidade</h1>
    <p>Conteúdo da política de privacidade do Jogatta...</p>
  `);
});

app.get('/termos-servico', (req, res) => {
  res.send(`
    <h1>Termos de Serviço</h1>
    <p>Conteúdo dos termos de serviço do Jogatta...</p>
  `);
});

// Servir arquivos estáticos (ex.: google-site-verification.html)
app.use(express.static(path.join(__dirname, 'public')));

// Middlewares globais
app.use(express.json());
app.use(cors());
app.use(passport.initialize());

// Logging básico
app.use((req, res, next) => {
  console.log(`\n=== Nova requisição recebida ===`);
  console.log(`Método: ${req.method}`);
  console.log(`URL: ${req.url}`);
  console.log(`Body:`, req.body);
  console.log('==============================\n');
  next();
});

// ------------------------------------------------
// Importação de rotas
// ------------------------------------------------
const jogadorRoutes = require('./routes/jogador/jogadorRoutes');
const reservationRoutes = require('./routes/jogador/reservationRoutes');
const jogosRoutes = require('./routes/jogador/jogosRoutes');
const courtManagementRoutes = require('./routes/owner/courtManagementRoutes');
const ownerReservationsRoutes = require('./routes/owner/ownerReservationsRoutes');
const authRoutes = require('./routes/authRoutes');
const userRoutes = require('./routes/userRoutes');
const empresasRoutes = require('./routes/empresasRoutes'); // Renomeado
const convitesRoutes = require('./routes/invites/inviteRoutes');
const convitesUserRoutes = require('./routes/invites/inviteUserRoutes');
const cepRoutes = require('./routes/cepRoutes/cepRoutes');
const groupRoutes = require('./routes/groupRoutes');
const amigosRoutes = require('./routes/amigosRoutes');
const avaliacoesRoutes = require('./routes/jogador/AvaliacoesRoutes');
const lobbyRoutes = require('./routes/invites/lobbyRoutes');
const chatRoutes = require('./routes/chatRoutes');
const balanceamentoRoutes = require('./routes/jogador/balanceamentoRoutes');
const temporariosRoutes = require('./routes/jogador/temporariosRoutes');
const pdfRoutes = require('./routes/pdfRoutes');

// (1) Import do arquivo de rotas para quadras de superadmin
const quadrasAdminRoutes = require('./routes/quadras/quadrasAdminRoutes');

// (2) Import do arquivo de rotas públicas de quadras
const quadrasPublicRoutes = require('./routes/quadras/quadrasPublicRoutes');

// Se não existir diretório pdf, cria
if (!fs.existsSync(path.join(__dirname, 'pdf'))) {
  fs.mkdirSync(path.join(__dirname, 'pdf'), { recursive: true });
  console.log('Diretório "pdf" criado automaticamente.');
}

// ------------------------------------------------
// Registro de rotas
// ------------------------------------------------

// Exemplo de rota para jogador e organizador
app.use(
  '/api/jogador',
  require('./middlewares/authMiddleware'),
  require('./middlewares/roleMiddleware')(['jogador', 'organizador']),
  jogadorRoutes
);
app.use('/api/jogador/reservas', require('./middlewares/authMiddleware'), reservationRoutes);
app.use('/api/jogos', require('./middlewares/authMiddleware'), jogosRoutes);

// Exemplo de rota para owner
app.use(
  '/api/owner/quadras',
  require('./middlewares/authMiddleware'),
  require('./middlewares/roleMiddleware')(['owner']),
  courtManagementRoutes
);
app.use('/api/owner/reservas', require('./middlewares/authMiddleware'), ownerReservationsRoutes);

// Rotas de autenticação
app.use('/api/auth', authRoutes);

// Rotas gerais
app.use('/api/usuario', userRoutes);

// (3) Rotas de empresas (estilo iFood), sem exigir login (pode exigir se quiser)
app.use('/api/empresas', empresasRoutes);

// Convites, avaliações, etc.
app.use('/api/convites', require('./middlewares/authMiddleware'), convitesRoutes);
app.use('/api/convites/usuario', require('./middlewares/authMiddleware'), convitesUserRoutes);
app.use('/api/avaliacoes', require('./middlewares/authMiddleware'), avaliacoesRoutes);
app.use('/api/amigos', require('./middlewares/authMiddleware'), amigosRoutes);
app.use('/api/groups', groupRoutes);
app.use('/api/lobby', require('./middlewares/authMiddleware'), lobbyRoutes);
app.use('/api/cep', require('./middlewares/authMiddleware'), cepRoutes);
app.use('/api/balanceamento', balanceamentoRoutes);
app.use('/api/chat', require('./middlewares/authMiddleware'), chatRoutes);
app.use('/api/temporarios', temporariosRoutes);
app.use('/api/pdf', pdfRoutes);

// (4) Rota de quadras para superadmin
app.use(
  '/api/superadmin/quadras',
  require('./middlewares/authMiddleware'),
  require('./middlewares/roleMiddleware')(['superadmin']),
  quadrasAdminRoutes
);

// (5) Rota de quadras públicas (qualquer usuário pode ver)
app.use('/api/quadras', quadrasPublicRoutes);

// ------------------------------------------------
// CRON 1: Encerrar jogos cujo horário_fim < NOW()
// ------------------------------------------------
cron.schedule('*/5 * * * *', async () => {
  console.log('Verificando jogos que precisam ser encerrados...');
  try {
    await db.query(`
      UPDATE jogos
         SET status = 'encerrada'
       WHERE horario_fim < NOW()
         AND status = 'ativa'
    `);
    console.log('Jogos encerrados automaticamente.');
  } catch (error) {
    console.error('Erro ao encerrar jogos:', error);
  }
});

// ------------------------------------------------
// CRON 2: Notificar automaticamente se habilitar_notificacao = true
// Roda a cada 1 minuto
// ------------------------------------------------
cron.schedule('* * * * *', async () => {
  console.log('Verificando jogos para notificações automáticas...');
  try {
    const agora = new Date();

    // Buscar jogos com habilitar_notificacao = true, status 'aberto', e notificado_automatico = false
    const jogos = await db.query(`
      SELECT id_jogo, nome_jogo, data_jogo, horario_inicio,
             tempo_notificacao, notificado_automatico
        FROM jogos
       WHERE habilitar_notificacao = true
         AND status = 'aberto'
         AND (notificado_automatico = false OR notificado_automatico IS NULL)
    `);

    for (const row of jogos.rows) {
      const { id_jogo, nome_jogo, data_jogo, horario_inicio, tempo_notificacao } = row;
      const jogoDate = new Date(`${data_jogo}T${horario_inicio}`);
      const diffMs = jogoDate - agora;
      const diffMin = diffMs / 1000 / 60; // diferença em minutos

      // Se faltar <= tempo_notificacao minutos (mas ainda > 0) -> dispara notificação
      if (diffMin <= tempo_notificacao && diffMin > 0) {
        // Buscar jogadores não confirmados
        const naoConfirmados = await db.query(
          `
          SELECT pj.id_usuario, u.device_token
            FROM participacao_jogos pj
            JOIN usuario u ON pj.id_usuario = u.id_usuario
           WHERE pj.id_jogo = $1
             AND pj.status = 'ativo'
             AND pj.confirmado = false
        `,
          [id_jogo]
        );

        for (const row2 of naoConfirmados.rows) {
          const { device_token } = row2;
          if (device_token) {
            // Exemplo de envio push:
            // await enviarPush(device_token, 'Jogatta', `Faltam ~${Math.round(diffMin)}min para o jogo ${nome_jogo}!`);
            console.log(`[NOTIF] Enviando push para token ${device_token} - Jogo: ${nome_jogo}`);
          }
        }

        // Marcar como notificado_automatico = true
        await db.query(
          `
          UPDATE jogos
             SET notificado_automatico = true
           WHERE id_jogo = $1
        `,
          [id_jogo]
        );

        console.log(`Notificação automática enviada para jogo ID: ${id_jogo}`);
      }
    }
  } catch (error) {
    console.error('Erro ao enviar notificações automáticas:', error);
  }
});

// Exibir rotas (debug)
app._router.stack.forEach((layer) => {
  if (layer.route) {
    const methods = Object.keys(layer.route.methods).join(', ').toUpperCase();
    console.log(`[ROTA] ${layer.route.path} (${methods})`);
  }
});

// Iniciar servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Servidor rodando na porta ${PORT}`);
  console.log(`🔗 Acesse: http://localhost:${PORT}`);
});
