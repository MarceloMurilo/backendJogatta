// TimesBalanceados.js

import React, { useEffect, useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Modal,
  FlatList,
  Alert, // <-- Adicionei para poder usar Alert caso precise (se não usar, pode remover)
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from 'react-native-reanimated';
import * as Sharing from 'expo-sharing';
import * as Print from 'expo-print';
import ViewShot from 'react-native-view-shot';
import api from '../services/api'; // Ajuste o caminho conforme sua estrutura

// Componente para jogador com botão "Mover"
const PlayerItem = ({ jogador, timeIndex, onMovePress, viewMode }) => {
  // Determina se o jogador deve ser destacado
  const isLevantador = jogador.levantamento >= 4;

  return (
    <View style={styles.playerContainer}>
      <View
        style={[
          styles.jogadorItem,
          isLevantador && styles.levantadorDestaque, // Aplica destaque se for levantador
        ]}
      >
        <Text style={styles.jogadorNome}>{jogador.nome}</Text>
        {viewMode === 'habilidades' && (
          <Text style={styles.score}>
            Passe: {jogador.passe} | Ataque: {jogador.ataque} | Levantamento: {jogador.levantamento}
          </Text>
        )}
      </View>
      <TouchableOpacity
        style={styles.moveButton}
        onPress={() => onMovePress(jogador, timeIndex)}
      >
        <Text style={styles.moveButtonText}>Mover</Text>
      </TouchableOpacity>
    </View>
  );
};

// Componente de Toast personalizado
const Toast = ({ message, visible }) => {
  const opacity = useSharedValue(0);

  useEffect(() => {
    if (visible) {
      opacity.value = withSpring(1);
      const timer = setTimeout(() => {
        opacity.value = withSpring(0);
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [visible, opacity]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));

  if (!visible) return null;

  return (
    <Animated.View style={[styles.toastContainer, animatedStyle]}>
      <Text style={styles.toastText}>{message}</Text>
    </Animated.View>
  );
};

const TimesBalanceados = ({ route, navigation }) => {
  // Recebemos tudo via route.params
  const {
    id_jogo,
    id_usuario_organizador,
    tamanho_time,
    times: initialTimes,
    reservas: initialReservas,
    rotacoes,
    data_jogo, // Supondo que você tenha a data do jogo
  } = route.params;

  // LOG para verificar se recebemos de fato 'id_jogo' e 'id_usuario_organizador'
  useEffect(() => {
    console.log('======== TimesBalanceados - Checando Parâmetros ========');
    console.log('id_jogo:', id_jogo);
    console.log('id_usuario_organizador:', id_usuario_organizador);
    console.log('========================================================');
  }, []);

  // Estados locais
  const [times, setTimes] = useState(initialTimes || []);
  const [reservas, setReservas] = useState(initialReservas || []);
  const [viewMode, setViewMode] = useState('habilidades'); // Estado para modo de visualização
  const [toastMessage, setToastMessage] = useState('');
  const [showToast, setShowToast] = useState(false);
  const [moveHistory, setMoveHistory] = useState([]); // Histórico de movimentos para desfazer

  const [modalVisible, setModalVisible] = useState(false);
  const [playerToMove, setPlayerToMove] = useState(null);
  const [currentTeamIndex, setCurrentTeamIndex] = useState(null);

  const viewShotRef = useRef();

  // ---------- Funções de movimentação e histórico ----------
  const openMoveModal = (jogador, teamIndex) => {
    setPlayerToMove(jogador);
    setCurrentTeamIndex(teamIndex);
    setModalVisible(true);
  };

  const closeMoveModal = () => {
    setModalVisible(false);
    setPlayerToMove(null);
    setCurrentTeamIndex(null);
  };

  const handleMovePlayer = (targetTeamIndex) => {
    if (!playerToMove) return;

    let updatedTimes = [...times];
    let updatedReservas = [...reservas];
    let previousState = {
      jogador: playerToMove,
      from: currentTeamIndex,
      to: targetTeamIndex,
    };

    if (targetTeamIndex === -1) {
      // Mover para reservas
      updatedReservas.push(playerToMove);
      // Remover do time original, se aplicável
      if (currentTeamIndex !== -1) {
        updatedTimes[currentTeamIndex].jogadores = updatedTimes[
          currentTeamIndex
        ].jogadores.filter((j) => j.id !== playerToMove.id);
        updatedTimes[currentTeamIndex].totalScore -= playerToMove.total;
        updatedTimes[currentTeamIndex].totalAltura -= playerToMove.altura;
      }
    } else {
      // Mover para um time específico
      if (currentTeamIndex !== -1) {
        // Remover do time original
        updatedTimes[currentTeamIndex].jogadores = updatedTimes[
          currentTeamIndex
        ].jogadores.filter((j) => j.id !== playerToMove.id);
        updatedTimes[currentTeamIndex].totalScore -= playerToMove.total;
        updatedTimes[currentTeamIndex].totalAltura -= playerToMove.altura;
      } else {
        // Remover das reservas
        updatedReservas = updatedReservas.filter((j) => j.id !== playerToMove.id);
      }

      // Adicionar ao time de destino
      updatedTimes[targetTeamIndex].jogadores.push(playerToMove);
      updatedTimes[targetTeamIndex].totalScore += playerToMove.total;
      updatedTimes[targetTeamIndex].totalAltura += playerToMove.altura;
    }

    setTimes(updatedTimes);
    setReservas(updatedReservas);
    setMoveHistory((prevHistory) => [...prevHistory, previousState]);

    // Feedback visual
    setToastMessage(
      `${playerToMove.nome} foi movido para o ${
        targetTeamIndex === -1 ? 'Reserva' : `Time ${targetTeamIndex + 1}`
      }.`
    );
    setShowToast(true);

    // Fechar o modal
    closeMoveModal();
  };

  const undoMove = () => {
    if (moveHistory.length === 0) return;

    const lastMove = moveHistory[moveHistory.length - 1];
    const { jogador, from, to } = lastMove;
    let updatedTimes = [...times];
    let updatedReservas = [...reservas];

    if (to === -1) {
      // Moveu para reservas, reverter
      updatedReservas = updatedReservas.filter((j) => j.id !== jogador.id);
      if (from !== -1) {
        updatedTimes[from].jogadores.push(jogador);
        updatedTimes[from].totalScore += jogador.total;
        updatedTimes[from].totalAltura += jogador.altura;
      }
    } else {
      // Moveu para um time específico, reverter
      updatedTimes[to].jogadores = updatedTimes[to].jogadores.filter(
        (j) => j.id !== jogador.id
      );
      updatedTimes[to].totalScore -= jogador.total;
      updatedTimes[to].totalAltura -= jogador.altura;

      if (from === -1) {
        // De reservas
        updatedReservas.push(jogador);
      } else {
        // De outro time
        updatedTimes[from].jogadores.push(jogador);
        updatedTimes[from].totalScore += jogador.total;
        updatedTimes[from].totalAltura += jogador.altura;
      }
    }

    setTimes(updatedTimes);
    setReservas(updatedReservas);
    setMoveHistory((prevHistory) => prevHistory.slice(0, -1));
    setToastMessage(`Movimento de ${jogador.nome} desfeito.`);
    setShowToast(true);
  };

  // ---------- Funções de exportar (PDF ou Imagem) ----------
  const exportToPDF = async () => {
    const generatePlayersHTML = (jogadores) => {
      let levantadorMarcado = false;
      return jogadores
        .map((jogador) => {
          let setter = '';
          if (jogador.levantamento >= 4 && !levantadorMarcado) {
            setter = '<span class="setter">(Levantador)</span>';
            levantadorMarcado = true;
          }
          return `
            <div class="player">
              ${jogador.nome} ${setter}
            </div>
          `;
        })
        .join('');
    };

    try {
      // Crie o conteúdo HTML do PDF com layout aprimorado
      let htmlContent = `
        <html>
          <head>
            <style>
              body { 
                font-family: 'Arial, sans-serif'; 
                padding: 40px; 
                background-color: #ffffff; 
                color: #333333; 
              }
              h1 { 
                text-align: center; 
                font-size: 32px; 
                margin-bottom: 10px; 
              }
              h3 { 
                text-align: center; 
                font-size: 18px; 
                margin-bottom: 30px; 
                color: #555555;
              }
              .team, .reservas {
                  border: 1px solid #cccccc;
                  padding: 20px;
                  border-radius: 8px;
                  margin-bottom: 20px;
                  box-shadow: 2px 2px 8px rgba(0, 0, 0, 0.1);
                  background-color: #f9f9f9;
                }
              h2 { 
                font-size: 24px; 
                margin-bottom: 15px; 
                border-bottom: 1px solid #eeeeee; 
                padding-bottom: 5px; 
                text-align: center;
              }
              .player { 
                font-size: 18px; 
                margin-bottom: 8px; 
                display: flex; 
                align-items: center;
                justify-content: center;
              }
              .setter { 
                color: #4682B4; 
                font-weight: bold; 
                margin-left: 10px;
              }
              footer {
                position: fixed;
                bottom: 20px;
                left: 0;
                right: 0;
                text-align: center;
                font-size: 12px;
                color: #888888;
              }
            </style>
          </head>
          <body>
            <h1 style="font-size: 36px;">Jogatta - Times Balanceados</h1>
            
            ${times
              .map(
                (time, index) => `
              <div class="team" style="text-align: center;">
                <h2>Time ${index + 1}</h2>
                ${generatePlayersHTML(time.jogadores)}
              </div>
            `
              )
              .join('')}

            
            <div class="reservas">
              <h2>Reservas</h2>
              ${reservas
                .map(
                  (jogador) => `
                <div class="player">
                  ${jogador.nome} ${
                    jogador.levantamento >= 4
                      ? '<span class="setter">(Levantador)</span>'
                      : ''
                  }
                </div>
              `
                )
                .join('')}
            </div>
            <footer>
              <p>Jogatta - Organizado por Você</p>
            </footer>
          </body>
        </html>
      `;

      // Gere o PDF usando expo-print
      const { uri } = await Print.printToFileAsync({
        html: htmlContent,
        base64: false,
      });
      console.log('PDF Gerado em:', uri);

      // Compartilhe o PDF via expo-sharing
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, {
          mimeType: 'application/pdf',
          dialogTitle: 'Compartilhar Times Balanceados',
          UTI: 'com.adobe.pdf',
        });
      } else {
        setToastMessage('Compartilhamento não está disponível nesta plataforma.');
        setShowToast(true);
      }
    } catch (error) {
      console.error(error);
      setToastMessage('Erro ao gerar o PDF.');
      setShowToast(true);
    }
  };

  const exportToImage = async () => {
    try {
      // Ajuste no ViewShot para capturar a altura completa
      const uri = await viewShotRef.current.capture({
        // Define o modo para 'mount' para garantir que todo o conteúdo seja renderizado
        format: 'png',
        quality: 0.9,
        result: 'tmpfile',
      });
      console.log('Imagem Capturada em:', uri);

      // Compartilhe a imagem via expo-sharing
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, {
          mimeType: 'image/png',
          dialogTitle: 'Compartilhar Times Balanceados',
        });
      } else {
        setToastMessage('Compartilhamento não está disponível nesta plataforma.');
        setShowToast(true);
      }
    } catch (error) {
      console.error(error);
      setToastMessage('Erro ao capturar a imagem.');
      setShowToast(true);
    }
  };

  // Renderização das sugestões de substituições
  const renderSugestoes = () => {
    if (!rotacoes || rotacoes.length === 0) {
      return <Text style={styles.reservaVazia}>Nenhuma sugestão de substituição disponível.</Text>;
    }

    return rotacoes.map((rotacao, index) => (
      <View key={index} style={styles.sugestaoContainer}>
        <Text style={styles.reservaTitle}>Reserva: {rotacao.reserva.nome}</Text>
        {rotacao.sugeridos.map((sugestao, i) => (
          <View key={i} style={styles.sugestaoItem}>
            <Text>Time: {sugestao.time}</Text>
            <Text>Jogador: {sugestao.jogador.nome}</Text>
            <Text>Distância: {sugestao.distancia}</Text>
          </View>
        ))}
      </View>
    ));
  };

  // ---------- Render principal ----------
  return (
    <View style={styles.container}>
      {/* Botões de alternância de visualização */}
      <View style={styles.buttonContainer}>
        <TouchableOpacity
          style={[
            styles.toggleButton,
            viewMode === 'habilidades' && styles.toggleButtonActive,
          ]}
          onPress={() => setViewMode('habilidades')}
        >
          <Text
            style={[
              styles.toggleButtonText,
              viewMode === 'habilidades' && styles.toggleButtonTextActive,
            ]}
          >
            Habilidades
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.toggleButton,
            viewMode === 'nomes' && styles.toggleButtonActive,
          ]}
          onPress={() => setViewMode('nomes')}
        >
          <Text
            style={[
              styles.toggleButtonText,
              viewMode === 'nomes' && styles.toggleButtonTextActive,
            ]}
          >
            Nomes
          </Text>
        </TouchableOpacity>
      </View>

      {/* Botão de Desfazer */}
      {moveHistory.length > 0 && (
        <TouchableOpacity style={styles.undoButton} onPress={undoMove}>
          <Text style={styles.undoButtonText}>Desfazer</Text>
        </TouchableOpacity>
      )}

      {/* Botões de Exportação */}
      <View style={styles.exportButtonsContainer}>
        <TouchableOpacity
          style={styles.exportBotao}
          onPress={exportToPDF}
        >
          <Text style={styles.exportTexto}>PDF</Text>
        </TouchableOpacity>
        {/* Se desejar, reabilite este para exportar a imagem */}
        {false && (
          <TouchableOpacity
            style={styles.exportBotao}
            onPress={exportToImage}
          >
            <Text style={styles.exportTexto}>Imagem</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Envolvendo a ScrollView com ViewShot para captura de tela */}
      <ViewShot
        ref={viewShotRef}
        options={{ format: 'png', quality: 0.9, result: 'tmpfile' }}
        style={{ flex: 1 }}
      >
        <ScrollView contentContainerStyle={styles.scrollContent}>
          {/* Lista de Times */}
          {times.map((time, index) => (
            <View key={index} style={styles.team}>
              <Text style={styles.teamTitle}>Time {index + 1}</Text>
              <View style={styles.jogadoresContainer}>
                {time.jogadores.length > 0 ? (
                  time.jogadores.map((jogador) => (
                    <PlayerItem
                      key={jogador.id}
                      jogador={jogador}
                      timeIndex={index}
                      onMovePress={openMoveModal}
                      viewMode={viewMode}
                    />
                  ))
                ) : (
                  <Text style={styles.reservaVazia}>Nenhum jogador neste time.</Text>
                )}
              </View>
              <Text style={styles.totalScore}>
                Pontuação Total: {time.totalScore} | Altura Total: {time.totalAltura}
              </Text>
            </View>
          ))}

          {/* Reservas */}
          <View style={styles.reservasContainer}>
            <Text style={styles.reservasTitle}>Reservas</Text>
            {reservas.length > 0 ? (
              reservas.map((jogador) => (
                <PlayerItem
                  key={jogador.id}
                  jogador={jogador}
                  timeIndex={-1}
                  onMovePress={openMoveModal}
                  viewMode={viewMode}
                />
              ))
            ) : (
              <Text style={styles.reservaVazia}>Nenhum jogador em reserva.</Text>
            )}
          </View>

          {/* Sugestões de Substituições */}
          <View style={styles.sugestoesContainer}>
            <Text style={styles.sugestoesTitle}>Sugestões de Substituições</Text>
            {renderSugestoes()}
          </View>
        </ScrollView>
      </ViewShot>

      {/* Modal para selecionar destino do jogador */}
      <Modal
        transparent={true}
        visible={modalVisible}
        animationType="slide"
        onRequestClose={closeMoveModal}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Selecionar Destino</Text>
            <FlatList
              data={[
                ...times.map((time, index) => ({ label: `Time ${index + 1}`, value: index })),
                { label: 'Reserva', value: -1 },
              ]}
              keyExtractor={(item) => item.value.toString()}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.modalOption}
                  onPress={() => handleMovePlayer(item.value)}
                >
                  <Text style={styles.modalOptionText}>{item.label}</Text>
                </TouchableOpacity>
              )}
            />
            <TouchableOpacity style={styles.modalCancelButton} onPress={closeMoveModal}>
              <Text style={styles.modalCancelButtonText}>Cancelar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Toast de Feedback */}
      <Toast message={toastMessage} visible={showToast} />

      {/* Botão Finalizar Ajustes */}
      <TouchableOpacity
        style={styles.finalizarBotao}
        onPress={async () => {
          console.log('Dados enviados para finalizar balanceamento:', {
            id_jogo,
            id_usuario_organizador,
            times,
          });
          try {
            console.log('Enviando requisição para finalizar ajustes.');
            // Faz a requisição para atualizar o status do jogo
            const response = await api.post('/api/jogador/finalizar-balanceamento', {
              id_jogo, // ID do jogo a ser atualizado
              id_usuario_organizador, // ID do organizador
              times, // Times balanceados
            });

            console.log('Resposta da API /finalizar-balanceamento:', response.data);

            // Redireciona de volta para a LiveRoomScreen com os dados atualizados
            navigation.navigate('LiveRoomScreen', {
              jogoId: id_jogo, // Use id_jogo em vez de jogo_id
              times: response.data.times, // Passa os times atualizados
              reservas, // se quiser passar também as reservas
            });
          } catch (error) {
            console.error('Erro ao finalizar ajustes:', error.response || error.message);
            Alert.alert('Erro', 'Não foi possível finalizar os ajustes. Tente novamente.');
          }
        }}
      >
        <Text style={styles.finalizarTexto}>Finalizar Ajustes</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    backgroundColor: '#f0f2f5',
  },
  buttonContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginBottom: 10,
  },
  toggleButton: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#007bff',
    borderRadius: 5,
    marginHorizontal: 5,
    backgroundColor: '#fff',
  },
  toggleButtonActive: {
    backgroundColor: '#007bff',
  },
  toggleButtonText: {
    color: '#007bff',
    fontSize: 14,
  },
  toggleButtonTextActive: {
    color: '#fff',
    fontWeight: 'bold',
  },
  undoButton: {
    alignSelf: 'center',
    paddingVertical: 6,
    paddingHorizontal: 10,
    backgroundColor: '#dc3545',
    borderRadius: 5,
    marginBottom: 10,
  },
  undoButtonText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
  },
  exportButtonsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 10,
  },
  exportBotao: {
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: '#17a2b8',
    borderRadius: 8,
    marginHorizontal: 5,
  },
  exportTexto: {
    fontSize: 14,
    color: '#fff',
    fontWeight: 'bold',
  },
  team: {
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#dddddd',
    padding: 20,
    borderRadius: 8,
    backgroundColor: '#ffffff',
    // shadow (RN não suporta 'boxShadow' no Android; se quiser, use elevation)
  },
  teamTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 15,
    color: '#333333',
    textAlign: 'center',
  },
  jogadoresContainer: {
    flexDirection: 'column',
    flexWrap: 'wrap',
    minHeight: 100,
  },
  playerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginVertical: 5,
  },
  jogadorItem: {
    flex: 1,
    padding: 8,
    backgroundColor: '#fafafa',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ccc',
  },
  jogadorNome: {
    fontSize: 18,
    fontWeight: '600',
    color: '#555555',
    textAlign: 'center',
  },
  score: {
    fontSize: 14,
    color: '#888888',
    marginTop: 4,
    textAlign: 'center',
  },
  totalScore: {
    fontSize: 16,
    fontWeight: 'bold',
    marginTop: 15,
    color: '#007bff',
    textAlign: 'center',
  },
  reservasContainer: {
    marginTop: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: '#ffc107',
    borderRadius: 8,
    backgroundColor: '#fff3cd',
  },
  reservasTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 15,
    color: '#856404',
    textAlign: 'center',
  },
  reservaVazia: {
    fontSize: 14,
    color: '#856404',
    textAlign: 'center',
  },
  sugestoesContainer: {
    marginTop: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: '#6c757d',
    borderRadius: 8,
    backgroundColor: '#e9ecef',
  },
  sugestoesTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 15,
    color: '#343a40',
    textAlign: 'center',
  },
  sugestaoContainer: {
    marginBottom: 15,
    padding: 15,
    backgroundColor: '#f8f9fa',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ced4da',
  },
  sugestaoItem: {
    marginVertical: 5,
    padding: 10,
    backgroundColor: '#ffffff',
    borderRadius: 5,
    borderWidth: 1,
    borderColor: '#dee2e6',
  },
  reservaTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#495057',
    textAlign: 'center',
  },
  finalizarBotao: {
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 20,
    backgroundColor: '#28a745',
    borderRadius: 10,
    marginTop: 20,
  },
  finalizarTexto: {
    fontSize: 16,
    color: '#fff',
    fontWeight: 'bold',
  },
  levantadorDestaque: {
    borderWidth: 2,
    borderColor: '#ffd700', // Borda dourada para destaque
    backgroundColor: '#fffbea', // Fundo levemente dourado
  },
  moveButton: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    backgroundColor: '#007bff',
    borderRadius: 5,
  },
  moveButtonText: {
    color: '#fff',
    fontSize: 12,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    width: '80%',
    maxHeight: '80%',
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 20,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 20,
    color: '#333333',
    textAlign: 'center',
  },
  modalOption: {
    paddingVertical: 10,
    paddingHorizontal: 15,
    backgroundColor: '#f0f2f5',
    borderRadius: 5,
    marginBottom: 10,
  },
  modalOptionText: {
    fontSize: 14,
    color: '#007bff',
    textAlign: 'center',
  },
  modalCancelButton: {
    marginTop: 10,
    paddingVertical: 10,
    backgroundColor: '#dc3545',
    borderRadius: 5,
  },
  modalCancelButtonText: {
    color: '#fff',
    fontSize: 14,
    textAlign: 'center',
    fontWeight: 'bold',
  },
  toastContainer: {
    position: 'absolute',
    bottom: 50,
    left: '10%',
    right: '10%',
    backgroundColor: '#333333',
    padding: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  toastText: {
    color: '#ffffff',
    fontSize: 14,
  },
  scrollContent: {
    paddingBottom: 100, // Espaço extra para evitar cortes na captura
  },
});

export default TimesBalanceados;
