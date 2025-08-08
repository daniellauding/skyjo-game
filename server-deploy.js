const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const { v4: uuidv4 } = require('uuid');

// Game logic inline for deployment
class SkyjoGame {
    constructor() {
        this.players = new Map();
        this.deck = [];
        this.discardPile = [];
        this.currentPlayerId = null;
        this.phase = 'waiting';
        this.round = 1;
        this.roomCode = null;
        this.maxPlayers = 8;
        this.turnAction = null;
        this.selectedCard = null;
    }

    addPlayer(id, name, color) {
        const player = {
            id,
            name,
            color,
            cards: [],
            score: 0,
            totalScore: 0,
            isHost: this.players.size === 0,
            hasFlippedInitialCards: false,
            initialCardSum: 0
        };
        this.players.set(id, player);
        return player;
    }

    removePlayer(id) {
        this.players.delete(id);
        if (this.currentPlayerId === id && this.players.size > 0) {
            this.nextTurn();
        }
    }

    getPlayer(id) {
        return this.players.get(id);
    }

    canStartGame() {
        return this.players.size >= 1 && this.players.size <= this.maxPlayers;
    }

    startNewRound() {
        this.createDeck();
        this.dealCards();
        this.phase = 'initial_flip';
        this.currentPlayerId = Array.from(this.players.keys())[0];
    }

    createDeck() {
        this.deck = [];
        // Add cards -2 to 12 with appropriate quantities
        const cardCounts = {
            '-2': 5, '-1': 10, '0': 15, '1': 10, '2': 10, '3': 10, '4': 10,
            '5': 10, '6': 10, '7': 10, '8': 10, '9': 10, '10': 10, '11': 10, '12': 10
        };

        for (const [value, count] of Object.entries(cardCounts)) {
            for (let i = 0; i < count; i++) {
                this.deck.push({ value: parseInt(value), id: uuidv4() });
            }
        }

        // Shuffle deck
        for (let i = this.deck.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [this.deck[i], this.deck[j]] = [this.deck[j], this.deck[i]];
        }

        // Start discard pile
        this.discardPile = [this.deck.pop()];
    }

    dealCards() {
        this.players.forEach(player => {
            player.cards = [];
            for (let i = 0; i < 12; i++) {
                const card = this.deck.pop();
                card.revealed = false;
                card.row = Math.floor(i / 4);
                card.col = i % 4;
                player.cards.push(card);
            }
        });
    }

    canPlayerAct(playerId) {
        return this.currentPlayerId === playerId && 
               (this.phase === 'playing' || this.phase === 'initial_flip');
    }

    getGameState() {
        const players = Array.from(this.players.values()).map(player => ({
            id: player.id,
            name: player.name,
            color: player.color,
            score: player.score,
            totalScore: player.totalScore,
            isHost: player.isHost,
            cards: player.cards || []
        }));

        return {
            players,
            currentPlayerId: this.currentPlayerId,
            phase: this.phase,
            round: this.round,
            discardCard: this.discardPile[this.discardPile.length - 1],
            deckSize: this.deck.length
        };
    }

    nextTurn() {
        const playerIds = Array.from(this.players.keys());
        const currentIndex = playerIds.indexOf(this.currentPlayerId);
        const nextIndex = (currentIndex + 1) % playerIds.length;
        this.currentPlayerId = playerIds[nextIndex];
    }
}

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Basic health check endpoint
app.get('/', (req, res) => {
    res.json({ status: 'Skyjo server is running', players: gameRooms.size });
});

app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Game rooms storage
const gameRooms = new Map();

// Generate 6-digit room code
function generateRoomCode() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

// Create new room
function createRoom(hostId, hostName, hostColor, maxPlayers) {
    const roomCode = generateRoomCode();
    const game = new SkyjoGame();
    
    game.roomCode = roomCode;
    game.maxPlayers = maxPlayers;
    game.isHost = true;
    game.addPlayer(hostId, hostName, hostColor);
    
    gameRooms.set(roomCode, {
        game: game,
        sockets: new Map([[hostId, null]])
    });
    
    return roomCode;
}

// Socket.IO connection handling
io.on('connection', (socket) => {
    console.log('Player connected:', socket.id);
    let currentRoom = null;
    let playerId = socket.id;

    // Host new game
    socket.on('hostGame', (data) => {
        try {
            const { name, color, maxPlayers } = data;
            
            if (!name || !color || !maxPlayers) {
                socket.emit('error', { message: 'Missing required fields' });
                return;
            }

            const roomCode = createRoom(playerId, name, color, maxPlayers);
            const room = gameRooms.get(roomCode);
            
            if (room) {
                room.sockets.set(playerId, socket);
                currentRoom = roomCode;
                
                socket.join(roomCode);
                socket.emit('roomCreated', { 
                    roomCode, 
                    gameState: room.game.getGameState(),
                    playerId 
                });
                
                console.log(`Room ${roomCode} created by ${name}`);
            }
        } catch (error) {
            console.error('Error hosting game:', error);
            socket.emit('error', { message: 'Failed to create room' });
        }
    });

    // Join existing game
    socket.on('joinGame', (data) => {
        try {
            const { roomCode, name, color } = data;
            
            if (!roomCode || !name || !color) {
                socket.emit('error', { message: 'Missing required fields' });
                return;
            }

            const room = gameRooms.get(roomCode);
            
            if (!room) {
                socket.emit('error', { message: 'Room not found' });
                return;
            }

            if (room.game.players.size >= room.game.maxPlayers) {
                socket.emit('error', { message: 'Room is full' });
                return;
            }

            const player = room.game.addPlayer(playerId, name, color);
            room.sockets.set(playerId, socket);
            currentRoom = roomCode;
            
            socket.join(roomCode);
            socket.emit('joinedRoom', {
                roomCode,
                gameState: room.game.getGameState(),
                playerId
            });

            socket.to(roomCode).emit('playerJoined', {
                gameState: room.game.getGameState(),
                player
            });

            console.log(`${name} joined room ${roomCode}`);
        } catch (error) {
            console.error('Error joining game:', error);
            socket.emit('error', { message: 'Failed to join room' });
        }
    });

    // Start game
    socket.on('startGame', () => {
        try {
            if (!currentRoom) {
                socket.emit('error', { message: 'Not in a room' });
                return;
            }

            const room = gameRooms.get(currentRoom);
            if (!room) {
                socket.emit('error', { message: 'Room not found' });
                return;
            }

            const player = room.game.getPlayer(playerId);
            if (!player || !player.isHost) {
                socket.emit('error', { message: 'Only host can start game' });
                return;
            }

            if (!room.game.canStartGame()) {
                socket.emit('error', { message: 'Cannot start game with current player count' });
                return;
            }

            room.game.startNewRound();
            
            io.to(currentRoom).emit('gameStarted', {
                gameState: room.game.getGameState()
            });
            
            console.log(`Game started in room ${currentRoom}`);
        } catch (error) {
            console.error('Error starting game:', error);
            socket.emit('error', { message: 'Failed to start game' });
        }
    });

    // Chat message
    socket.on('chatMessage', (data) => {
        try {
            if (!currentRoom) return;

            const room = gameRooms.get(currentRoom);
            if (!room) return;

            const player = room.game.getPlayer(playerId);
            if (!player) return;

            const chatData = {
                type: 'user',
                playerName: player.name,
                playerColor: player.color,
                message: data.message,
                timestamp: Date.now(),
                context: data.context
            };

            io.to(currentRoom).emit('chatMessage', chatData);
        } catch (error) {
            console.error('Error handling chat message:', error);
        }
    });

    // Handle disconnect
    socket.on('disconnect', () => {
        try {
            console.log('Player disconnected:', socket.id);
            
            if (currentRoom) {
                const room = gameRooms.get(currentRoom);
                if (room) {
                    const player = room.game.getPlayer(playerId);
                    if (player) {
                        room.game.removePlayer(playerId);
                        room.sockets.delete(playerId);

                        socket.to(currentRoom).emit('playerLeft', {
                            gameState: room.game.getGameState(),
                            player
                        });

                        // Clean up empty rooms
                        if (room.game.players.size === 0) {
                            gameRooms.delete(currentRoom);
                            console.log(`Room ${currentRoom} deleted (empty)`);
                        }
                    }
                }
            }
        } catch (error) {
            console.error('Error handling disconnect:', error);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🎯 Skyjo server running on port ${PORT}`);
    console.log(`Health check: http://localhost:${PORT}/health`);
});