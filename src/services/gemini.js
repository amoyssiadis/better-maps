/**
 * Better Maps - Gemini AI Service
 * Integrates with Google Generative AI to provide route insights and locations helper.
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import { storage } from './storage';

let genAI = null;
let chatSession = null;

// System instruction for the agent to behave like a maps copilot
const SYSTEM_INSTRUCTION = `
Você é o Better Maps AI, um copiloto inteligente de geolocalização e navegação.
O usuário está visualizando um mapa e interagindo com check-ins (lugares onde ele já esteve) e alertas de proximidade (geofences).
Sua tarefa é ajudá-lo a analisar rotas, dar dicas de segurança, sugerir pontos de interesse (turísticos, restaurantes, etc.) e bater um papo amigável em português sobre os caminhos dele.

Diretrizes:
1. Seja conciso e direto. Mapas são visuais, então respostas curtas e úteis são melhores.
2. Sempre responda em português brasileiro.
3. Se o usuário fornecer coordenadas ou caminhos específicos, dê insights reais (por exemplo, relevo, trânsito potencial se for cidade grande, ou atrações por perto).
4. Incentive o uso de check-ins e o cadastro de alertas de proximidade.
`;

export const gemini = {
  /**
   * Initializes the Gemini Client with the provided or saved API key
   */
  init(customKey = null) {
    const key = customKey || storage.getGeminiKey();
    if (!key) {
      genAI = null;
      chatSession = null;
      return false;
    }
    try {
      genAI = new GoogleGenerativeAI(key);
      // Create a persistent chat session using gemini-1.5-flash
      const model = genAI.getGenerativeModel({
        model: 'gemini-1.5-flash',
        systemInstruction: SYSTEM_INSTRUCTION
      });

      chatSession = model.startChat({
        history: [],
        generationConfig: {
          maxOutputTokens: 800,
          temperature: 0.7
        }
      });
      return true;
    } catch (e) {
      console.error('Failed to initialize Gemini AI SDK:', e);
      genAI = null;
      chatSession = null;
      return false;
    }
  },

  /**
   * Checks if the Gemini API is initialized
   */
  isInitialized() {
    return chatSession !== null;
  },

  /**
   * Resets the chat history
   */
  resetChat() {
    if (genAI) {
      this.init();
    }
  },

  /**
   * Sends a message to the AI agent, injecting the current map context
   */
  async sendMessage(message, mapContext = {}) {
    if (!chatSession) {
      const initialized = this.init();
      if (!initialized) {
        throw new Error('Gemini API Key não configurada ou inválida. Por favor, adicione uma chave nas configurações.');
      }
    }

    // Format map context into a readable metadata block for the model
    const contextPrompt = this._formatContext(mapContext);
    
    // Combine context and user message
    const fullPrompt = `${contextPrompt}\n\nMensagem do Usuário: "${message}"`;

    try {
      const result = await chatSession.sendMessage(fullPrompt);
      const response = await result.response;
      return response.text();
    } catch (error) {
      console.error('Error communicating with Gemini:', error);
      throw error;
    }
  },

  /**
   * Formats the active map context to provide background info to Gemini
   */
  _formatContext(context) {
    let text = '[CONTEXTO ATUAL DO MAPA DO USUÁRIO]:\n';
    
    if (context.currentLocation) {
      text += `- Localização Atual do Usuário: Latitude ${context.currentLocation.lat.toFixed(6)}, Longitude ${context.currentLocation.lng.toFixed(6)}\n`;
    } else {
      text += `- Localização Atual do Usuário: Desconhecida/Não autorizada\n`;
    }

    if (context.checkIns && context.checkIns.length > 0) {
      text += `- Locais já visitados (Check-ins salvos): ${context.checkIns.length} lugares cadastrados. Alguns exemplos:\n`;
      context.checkIns.slice(0, 5).forEach(c => {
        text += `  * "${c.name}" (${c.category}) em ${c.address || 'sem endereço'} - Notas: "${c.notes || 'sem notas'}"\n`;
      });
    } else {
      text += `- Locais já visitados: Nenhum check-in registrado ainda.\n`;
    }

    if (context.geofences && context.geofences.length > 0) {
      text += `- Alertas de Proximidade (Geofences) configurados:\n`;
      context.geofences.forEach(g => {
        text += `  * Alerta "${g.name}" com raio de ${g.radius}m nas coordenadas (${g.lat.toFixed(5)}, ${g.lng.toFixed(5)})\n`;
      });
    }

    if (context.activeRoute) {
      const route = context.activeRoute;
      text += `- Rota Ativa:\n`;
      text += `  * Origem: ${route.origin}\n`;
      text += `  * Destino: ${route.destination}\n`;
      text += `  * Distância Total: ${route.distance}\n`;
      text += `  * Tempo Estimado: ${route.duration}\n`;
      if (route.steps && route.steps.length > 0) {
        text += `  * Principais vias de tráfego sugeridas: ${route.steps.slice(0, 4).join(', ')}\n`;
      }
    } else {
      text += `- Rota Ativa: Nenhuma rota traçada no momento.\n`;
    }

    return text;
  }
};
