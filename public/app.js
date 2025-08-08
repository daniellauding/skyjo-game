class SkyjoApp {
    constructor() {
        this.socket = null;
        this.currentScreen = 'mainMenu';
        this.gameState = null;
        this.playerId = null;
        this.selectedCardPosition = null;
        this.playerColors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7', '#DDA0DD'];
        this.selectedColor = '#FF6B6B';
        this.chatCollapsed = false;
        this.scoreHistory = this.loadScoreHistory();
        this.currentRoomCode = null;
        this.currentRoomPassword = null;
        
        this.init();
    }

    init() {
        try {
            console.log('Initializing Skyjo app...');
            this.connectSocket();
            this.setupEventListeners();
            this.checkURLParams();
            this.showScreen('mainMenu');
            console.log('Skyjo app initialized successfully');
        } catch (error) {
            console.error('Error initializing app:', error);
        }
    }

    connectSocket() {
        try {
            console.log('Connecting to Socket.IO...');
            // Auto-detect if running locally or on Netlify
            const socketUrl = window.location.hostname === 'localhost' 
                ? 'http://localhost:3000' 
                : window.location.origin;
            
            console.log(`Connecting to: ${socketUrl}`);
            this.socket = io(socketUrl, {
                transports: ['polling', 'websocket'],
                forceNew: true,
                timeout: 20000,
                autoConnect: true
            });
        } catch (error) {
            console.error('Error connecting to socket:', error);
            // Fallback: still setup UI without socket for local testing
            this.socket = { 
                on: () => {}, 
                emit: () => console.warn('Socket not connected'),
                id: 'offline'
            };
        }
        
        this.socket.on('connect', () => {
            console.log('Connected to server');
            this.playerId = this.socket.id;
        });

        this.socket.on('disconnect', () => {
            console.log('Disconnected from server');
            this.showToast('Disconnected from server', 'error');
        });

        this.socket.on('error', (data) => {
            this.showToast(data.message, 'error');
        });

        this.socket.on('roomCreated', (data) => {
            this.gameState = data.gameState;
            this.playerId = data.playerId;
            this.showLobby(data.roomCode);
        });

        this.socket.on('joinedRoom', (data) => {
            this.gameState = data.gameState;
            this.playerId = data.playerId;
            this.showLobby(data.roomCode);
        });

        this.socket.on('playerJoined', (data) => {
            this.gameState = data.gameState;
            this.updateLobby();
            this.showToast(`${data.player.name} joined the game`, 'success');
        });

        this.socket.on('playerLeft', (data) => {
            this.gameState = data.gameState;
            if (this.currentScreen === 'lobbyScreen') {
                this.updateLobby();
            } else if (this.currentScreen === 'gameScreen') {
                this.updateGameScreen();
            }
            this.showToast(`${data.player.name} left the game`, 'info');
        });

        this.socket.on('gameStarted', (data) => {
            this.gameState = data.gameState;
            this.showGame();
        });

        this.socket.on('cardDrawn', (data) => {
            this.handleCardDrawn(data.card);
        });

        this.socket.on('playerDrewCard', (data) => {
            this.gameState = data.gameState;
            this.updateGameScreen();
        });

        this.socket.on('discardTaken', (data) => {
            this.gameState = data.gameState;
            this.updateGameScreen();
            if (data.playerId === this.playerId) {
                this.handleCardDrawn(data.card);
            }
        });

        this.socket.on('cardPlaced', (data) => {
            this.gameState = data.gameState;
            this.updateGameScreen();
            this.selectedCardPosition = null;
        });

        this.socket.on('cardDiscardedAndRevealed', (data) => {
            this.gameState = data.gameState;
            this.updateGameScreen();
            this.selectedCardPosition = null;
        });

        this.socket.on('roundEnded', (data) => {
            this.gameState = data.gameState;
            this.updateGameScreen();
            this.showToast('Round ended! Calculating scores...', 'info');
        });

        this.socket.on('gameEnded', (data) => {
            this.gameState = data.gameState;
            this.updateGameScreen();
            this.saveScoreHistory(data);
            this.showToast(`Game Over! ${data.winner.name} wins!`, 'success');
        });

        this.socket.on('gameState', (data) => {
            this.gameState = data;
            this.updateCurrentScreen();
        });

        this.socket.on('chatMessage', (data) => {
            this.displayChatMessage(data);
        });
    }

    setupEventListeners() {
        console.log('Setting up event listeners...');
        
        // Main menu buttons
        const hostBtn = document.getElementById('hostGameBtn');
        const joinBtn = document.getElementById('joinGameBtn');

        if (hostBtn) {
            hostBtn.addEventListener('click', () => {
                console.log('Host Game button clicked!');
                this.showScreen('hostScreen');
            });
        } else {
            console.error('Host Game button not found!');
        }

        if (joinBtn) {
            joinBtn.addEventListener('click', () => {
                console.log('Join Game button clicked!');
                this.showScreen('joinScreen');
            });
        } else {
            console.error('Join Game button not found!');
        }


        // Host game screen
        document.getElementById('createRoomBtn').addEventListener('click', () => {
            this.hostGame();
        });

        document.getElementById('backFromHostBtn').addEventListener('click', () => {
            this.showScreen('mainMenu');
        });

        // Join game screen
        document.getElementById('joinRoomBtn').addEventListener('click', () => {
            this.joinGame();
        });

        document.getElementById('backFromJoinBtn').addEventListener('click', () => {
            this.showScreen('mainMenu');
        });

        // Lobby screen
        document.getElementById('startGameBtn').addEventListener('click', () => {
            this.socket.emit('startGame');
        });

        document.getElementById('leaveLobbyBtn').addEventListener('click', () => {
            this.leaveRoom();
        });

        document.getElementById('copyRoomCodeBtn').addEventListener('click', () => {
            this.copyRoomCode();
        });


        // Game screen actions
        document.getElementById('drawFromDeckBtn').addEventListener('click', () => {
            this.socket.emit('drawCard');
        });

        document.getElementById('takeDiscardBtn').addEventListener('click', () => {
            this.socket.emit('takeDiscard');
        });

        // Color picker handlers
        this.setupColorPickers();

        // Chat handlers
        this.setupChatEventListeners();

        // Help modal handlers
        this.setupModalHandlers();

        // Share and URL handlers
        this.setupShareHandlers();
    }

    setupColorPickers() {
        document.querySelectorAll('.color-picker').forEach(picker => {
            picker.addEventListener('click', (e) => {
                if (e.target.classList.contains('color-option')) {
                    // Remove selection from siblings
                    picker.querySelectorAll('.color-option').forEach(option => {
                        option.classList.remove('selected');
                    });
                    
                    // Select clicked color
                    e.target.classList.add('selected');
                    this.selectedColor = e.target.dataset.color;
                }
            });
        });
    }

    showScreen(screenId) {
        document.querySelectorAll('.screen').forEach(screen => {
            screen.classList.remove('active');
        });
        
        document.getElementById(screenId).classList.add('active');
        this.currentScreen = screenId;
    }

    hostGame() {
        const name = document.getElementById('hostName').value.trim();
        const maxPlayers = parseInt(document.getElementById('maxPlayers').value);
        const password = document.getElementById('roomPassword').value.trim();

        if (!name) {
            this.showToast('Please enter your name', 'error');
            return;
        }

        if (maxPlayers < 2 || maxPlayers > 8) {
            this.showToast('Max players must be between 2 and 8', 'error');
            return;
        }

        this.currentRoomPassword = password || null;

        this.socket.emit('hostGame', {
            name: name,
            color: this.selectedColor,
            maxPlayers: maxPlayers,
            password: password || null
        });
    }

    joinGame() {
        const name = document.getElementById('playerName').value.trim();
        const roomCode = document.getElementById('roomCode').value.trim();
        const password = document.getElementById('joinPassword').value.trim();

        if (!name) {
            this.showToast('Please enter your name', 'error');
            return;
        }

        if (!roomCode || roomCode.length !== 6) {
            this.showToast('Please enter a valid 6-digit room code', 'error');
            return;
        }

        this.socket.emit('joinGame', {
            roomCode: roomCode,
            name: name,
            color: this.selectedColor,
            password: password || null
        });
    }

    showLobby(roomCode) {
        this.currentRoomCode = roomCode;
        document.getElementById('roomCodeDisplay').textContent = roomCode;
        this.updateLobby();
        this.showScreen('lobbyScreen');
    }

    updateLobby() {
        if (!this.gameState) return;

        const playersList = document.getElementById('playersList');
        const startGameBtn = document.getElementById('startGameBtn');
        
        playersList.innerHTML = '';
        
        this.gameState.players.forEach(player => {
            const playerItem = document.createElement('div');
            playerItem.className = 'player-item';
            
            playerItem.innerHTML = `
                <div class="player-avatar" style="background-color: ${player.color}">
                    ${player.name.charAt(0).toUpperCase()}
                </div>
                <span class="player-name">${player.name}</span>
                ${player.isHost ? '<span class="host-badge">HOST</span>' : ''}
            `;
            
            playersList.appendChild(playerItem);
        });

        // Enable/disable start button
        const currentPlayer = this.gameState.players.find(p => p.id === this.playerId);
        const canStart = currentPlayer?.isHost && this.gameState.players.length >= 2;
        startGameBtn.disabled = !canStart;
    }

    showGame() {
        this.showScreen('gameScreen');
        this.updateGameScreen();
    }

    updateGameScreen() {
        if (!this.gameState) return;

        this.updateGameHeader();
        this.updatePlayerGrid();
        this.updateScoreboard();
        this.updateOtherPlayers();
        this.updateGameActions();
    }

    updateGameHeader() {
        document.getElementById('roundNumber').textContent = this.gameState.roundNumber;
        document.getElementById('currentTurn').textContent = this.gameState.currentPlayer?.name || 'Unknown';
        document.getElementById('drawPileCount').textContent = this.gameState.drawPileCount;
        
        const discardCard = document.getElementById('discardCard');
        if (this.gameState.topDiscard !== null) {
            discardCard.textContent = this.gameState.topDiscard;
            discardCard.className = `card ${this.getCardClass(this.gameState.topDiscard)}`;
        } else {
            discardCard.textContent = '';
            discardCard.className = 'card back';
        }
    }

    updatePlayerGrid() {
        const currentPlayer = this.gameState.players.find(p => p.id === this.playerId);
        if (!currentPlayer) return;

        const cardGrid = document.getElementById('cardGrid');
        cardGrid.innerHTML = '';

        currentPlayer.grid.forEach((card, index) => {
            const cardElement = document.createElement('div');
            cardElement.className = `card ${card.revealed ? this.getCardClass(card.value) : 'back'}`;
            cardElement.dataset.position = index;
            
            if (card.revealed) {
                cardElement.textContent = card.value;
            }

            // Add click handler for card placement/reveal
            cardElement.addEventListener('click', () => {
                this.handleCardClick(index);
            });

            cardGrid.appendChild(cardElement);
        });
    }

    updateScoreboard() {
        const scoreboardList = document.getElementById('scoreboardList');
        scoreboardList.innerHTML = '';

        const sortedPlayers = [...this.gameState.players].sort((a, b) => a.totalScore - b.totalScore);

        sortedPlayers.forEach(player => {
            const scoreItem = document.createElement('div');
            scoreItem.className = 'score-item';
            
            scoreItem.innerHTML = `
                <span class="score-name" style="color: ${player.color}">${player.name}</span>
                <span class="score-value">${player.totalScore}</span>
            `;
            
            scoreboardList.appendChild(scoreItem);
        });
    }

    updateOtherPlayers() {
        const otherPlayersContainer = document.getElementById('otherPlayers');
        otherPlayersContainer.innerHTML = '<h3 style="color: #fff; margin-bottom: 15px;">Other Players</h3>';

        const otherPlayers = this.gameState.players.filter(p => p.id !== this.playerId);

        otherPlayers.forEach(player => {
            const playerDiv = document.createElement('div');
            playerDiv.className = 'other-player';
            
            const playerName = document.createElement('div');
            playerName.className = 'other-player-name';
            playerName.textContent = player.name;
            playerName.style.color = player.color;
            
            const gridDiv = document.createElement('div');
            gridDiv.className = 'other-player-grid';
            
            player.grid.forEach(card => {
                const cardEl = document.createElement('div');
                cardEl.className = `card ${card.revealed ? this.getCardClass(card.value) : 'back'}`;
                
                if (card.revealed) {
                    cardEl.textContent = card.value;
                }
                
                gridDiv.appendChild(cardEl);
            });
            
            playerDiv.appendChild(playerName);
            playerDiv.appendChild(gridDiv);
            otherPlayersContainer.appendChild(playerDiv);
        });
    }

    updateGameActions() {
        const drawBtn = document.getElementById('drawFromDeckBtn');
        const takeBtn = document.getElementById('takeDiscardBtn');
        
        const isMyTurn = this.gameState.currentPlayer?.id === this.playerId;
        const gameActive = this.gameState.gameState === 'playing';
        
        drawBtn.disabled = !isMyTurn || !gameActive;
        takeBtn.disabled = !isMyTurn || !gameActive || this.gameState.topDiscard === null;
    }

    handleCardDrawn(card) {
        // Show drawn card and allow player to choose what to do
        const message = `You drew: ${card}. Click a card position to place it, or click discard to discard and reveal.`;
        this.showToast(message, 'info');
        
        // Enable card placement
        this.enableCardPlacement();
    }

    enableCardPlacement() {
        const cards = document.querySelectorAll('#cardGrid .card');
        cards.forEach(card => {
            card.classList.add('selectable');
        });
    }

    disableCardPlacement() {
        const cards = document.querySelectorAll('#cardGrid .card');
        cards.forEach(card => {
            card.classList.remove('selectable', 'selected');
        });
    }

    handleCardClick(position) {
        const isMyTurn = this.gameState.currentPlayer?.id === this.playerId;
        if (!isMyTurn) return;

        // If we have a selected card, place it
        if (this.selectedCardPosition !== null || this.hasDrawnCard()) {
            this.socket.emit('placeCard', { position });
            this.disableCardPlacement();
        }
    }

    hasDrawnCard() {
        // This would be determined by game state - simplified for now
        return document.querySelector('#cardGrid .card.selectable') !== null;
    }

    getCardClass(value) {
        if (value < 0) return 'negative';
        if (value === 0) return 'zero';
        return 'positive';
    }

    copyRoomCode() {
        const roomCode = document.getElementById('roomCodeDisplay').textContent;
        navigator.clipboard.writeText(roomCode).then(() => {
            this.showToast('Room code copied to clipboard!', 'success');
        }).catch(() => {
            this.showToast('Failed to copy room code', 'error');
        });
    }

    leaveRoom() {
        this.socket.emit('leaveRoom');
        this.gameState = null;
        this.playerId = null;
        this.showScreen('mainMenu');
    }

    updateCurrentScreen() {
        if (this.currentScreen === 'lobbyScreen') {
            this.updateLobby();
        } else if (this.currentScreen === 'gameScreen') {
            this.updateGameScreen();
        }
    }

    showToast(message, type = 'info') {
        const toast = document.getElementById('toast');
        toast.textContent = message;
        toast.className = `toast ${type} show`;
        
        setTimeout(() => {
            toast.classList.remove('show');
        }, 4000);
    }

    setupChatEventListeners() {
        // Game screen chat
        const chatInput = document.getElementById('chatInput');
        const sendBtn = document.getElementById('sendChatBtn');
        const toggleBtn = document.getElementById('toggleChatBtn');

        if (chatInput) {
            chatInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter' && chatInput.value.trim()) {
                    this.sendChatMessage(chatInput.value.trim(), 'game');
                    chatInput.value = '';
                }
            });
        }

        if (sendBtn) {
            sendBtn.addEventListener('click', () => {
                const message = chatInput.value.trim();
                if (message) {
                    this.sendChatMessage(message, 'game');
                    chatInput.value = '';
                }
            });
        }

        if (toggleBtn) {
            toggleBtn.addEventListener('click', () => {
                this.toggleChat();
            });
        }

        // Lobby chat
        const lobbyChatInput = document.getElementById('lobbyChatInput');
        const sendLobbyChatBtn = document.getElementById('sendLobbyChatBtn');

        if (lobbyChatInput) {
            lobbyChatInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter' && lobbyChatInput.value.trim()) {
                    this.sendChatMessage(lobbyChatInput.value.trim(), 'lobby');
                    lobbyChatInput.value = '';
                }
            });
        }

        if (sendLobbyChatBtn) {
            sendLobbyChatBtn.addEventListener('click', () => {
                const message = lobbyChatInput.value.trim();
                if (message) {
                    this.sendChatMessage(message, 'lobby');
                    lobbyChatInput.value = '';
                }
            });
        }
    }

    sendChatMessage(message, context) {
        if (!this.gameState || !message.trim()) return;
        
        const player = this.gameState.players.find(p => p.id === this.playerId);
        if (!player) return;

        this.socket.emit('chatMessage', {
            message: message.trim(),
            context: context
        });
    }

    displayChatMessage(data) {
        const isLobby = this.currentScreen === 'lobbyScreen';
        const messagesContainer = isLobby ? 
            document.getElementById('lobbyChatMessages') : 
            document.getElementById('chatMessages');
        
        if (!messagesContainer) return;

        const messageDiv = document.createElement('div');
        messageDiv.className = 'chat-message';
        
        const timeStr = new Date(data.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        
        if (data.type === 'system') {
            messageDiv.innerHTML = `
                <div class="chat-system">
                    <span class="chat-time">${timeStr}</span>
                    <span class="chat-text">${data.message}</span>
                </div>
            `;
        } else {
            messageDiv.innerHTML = `
                <div class="chat-user-message">
                    <div class="chat-header-line">
                        <span class="chat-username" style="color: ${data.playerColor}">${data.playerName}</span>
                        <span class="chat-time">${timeStr}</span>
                    </div>
                    <div class="chat-text">${data.message}</div>
                </div>
            `;
        }

        messagesContainer.appendChild(messageDiv);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    toggleChat() {
        const chatContent = document.getElementById('chatContent');
        const toggleBtn = document.getElementById('toggleChatBtn');
        
        if (!chatContent || !toggleBtn) return;

        this.chatCollapsed = !this.chatCollapsed;
        
        if (this.chatCollapsed) {
            chatContent.style.display = 'none';
            toggleBtn.textContent = '+';
        } else {
            chatContent.style.display = 'block';
            toggleBtn.textContent = '−';
        }
    }

    loadScoreHistory() {
        try {
            return JSON.parse(localStorage.getItem('skyjo-scores') || '[]');
        } catch {
            return [];
        }
    }

    saveScoreHistory(gameResults) {
        try {
            const history = this.loadScoreHistory();
            const gameRecord = {
                timestamp: Date.now(),
                players: gameResults.players.map(p => ({
                    name: p.name,
                    score: p.totalScore,
                    winner: p.totalScore === Math.min(...gameResults.players.map(pl => pl.totalScore))
                })),
                winner: gameResults.winner
            };
            
            history.unshift(gameRecord);
            
            // Keep only last 50 games
            if (history.length > 50) {
                history.splice(50);
            }
            
            localStorage.setItem('skyjo-scores', JSON.stringify(history));
            this.scoreHistory = history;
        } catch (error) {
            console.error('Failed to save score history:', error);
        }
    }

    checkURLParams() {
        const urlParams = new URLSearchParams(window.location.search);
        const roomCode = urlParams.get('room');
        const password = urlParams.get('p');
        
        if (roomCode && roomCode.length === 6) {
            document.getElementById('roomCode').value = roomCode;
            if (password) {
                document.getElementById('passwordGroup').style.display = 'block';
                document.getElementById('joinPassword').value = password;
            }
            this.showScreen('joinScreen');
        }
    }

    setupModalHandlers() {
        const helpBtn = document.getElementById('helpBtn');
        const helpModal = document.getElementById('helpModal');
        const closeModal = document.getElementById('closeHelpModal');

        if (helpBtn) {
            helpBtn.addEventListener('click', () => {
                console.log('Help button clicked!');
                if (helpModal) {
                    helpModal.style.display = 'block';
                } else {
                    console.error('Help modal not found!');
                }
            });
        } else {
            console.error('Help button not found!');
        }

        if (closeModal) {
            closeModal.addEventListener('click', () => {
                helpModal.style.display = 'none';
            });
        }

        // Close modal when clicking outside
        if (helpModal) {
            helpModal.addEventListener('click', (e) => {
                if (e.target === helpModal) {
                    helpModal.style.display = 'none';
                }
            });
        }

        // Close modal with Escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && helpModal.style.display === 'block') {
                helpModal.style.display = 'none';
            }
        });
    }

    setupShareHandlers() {
        const copyRoomBtn = document.getElementById('copyRoomCodeBtn');
        const shareRoomBtn = document.getElementById('shareRoomBtn');
        const roomCodeInput = document.getElementById('roomCode');

        if (copyRoomBtn) {
            copyRoomBtn.addEventListener('click', () => {
                this.copyRoomCode();
            });
        }

        if (shareRoomBtn) {
            shareRoomBtn.addEventListener('click', () => {
                this.shareRoomLink();
            });
        }

        // Show password field when room code is entered (check if password protected)
        if (roomCodeInput) {
            roomCodeInput.addEventListener('input', (e) => {
                const code = e.target.value.trim();
                if (code.length === 6) {
                    // For now, always show password field when a code is entered
                    // In a real implementation, you'd check with the server if the room requires a password
                    document.getElementById('passwordGroup').style.display = 'block';
                } else {
                    document.getElementById('passwordGroup').style.display = 'none';
                }
            });
        }
    }

    copyRoomCode() {
        if (!this.currentRoomCode) return;
        
        navigator.clipboard.writeText(this.currentRoomCode).then(() => {
            this.showToast('Room code copied!', 'success');
        }).catch(() => {
            // Fallback for older browsers
            const textArea = document.createElement('textarea');
            textArea.value = this.currentRoomCode;
            document.body.appendChild(textArea);
            textArea.select();
            document.execCommand('copy');
            document.body.removeChild(textArea);
            this.showToast('Room code copied!', 'success');
        });
    }

    shareRoomLink() {
        if (!this.currentRoomCode) return;
        
        let shareUrl = `${window.location.origin}${window.location.pathname}?room=${this.currentRoomCode}`;
        
        if (this.currentRoomPassword) {
            shareUrl += `&p=${encodeURIComponent(this.currentRoomPassword)}`;
        }
        
        if (navigator.share && navigator.canShare && navigator.canShare({ url: shareUrl })) {
            navigator.share({
                title: 'Join my Skyjo game!',
                text: `Join my Skyjo game with room code: ${this.currentRoomCode}`,
                url: shareUrl
            }).catch(() => {
                this.copyShareLink(shareUrl);
            });
        } else {
            this.copyShareLink(shareUrl);
        }
    }

    copyShareLink(url) {
        navigator.clipboard.writeText(url).then(() => {
            this.showToast('Share link copied!', 'success');
        }).catch(() => {
            // Fallback for older browsers
            const textArea = document.createElement('textarea');
            textArea.value = url;
            document.body.appendChild(textArea);
            textArea.select();
            document.execCommand('copy');
            document.body.removeChild(textArea);
            this.showToast('Share link copied!', 'success');
        });
    }
}

// Initialize app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new SkyjoApp();
});