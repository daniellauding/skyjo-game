const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');

// Import game logic - need to adjust path for serverless
const SkyjoGame = require('../../public/game.js');

// In-memory storage (in production, use Redis or similar)
let gameRooms = null;

// Initialize storage
function initStorage() {
    if (!gameRooms) {
        gameRooms = new Map();
    }
}

// Generate 6-digit room code
function generateRoomCode() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

// Create new room
function createRoom(hostId, hostName, hostColor, maxPlayers, password = null) {
    const roomCode = generateRoomCode();
    const game = new SkyjoGame();
    
    game.roomCode = roomCode;
    game.maxPlayers = maxPlayers;
    game.isHost = true;
    game.addPlayer(hostId, hostName, hostColor);
    
    gameRooms.set(roomCode, {
        game: game,
        sockets: new Map([[hostId, null]]),
        password: password
    });
    
    return roomCode;
}

let io;

exports.handler = async (event, context) => {
    // Initialize storage
    initStorage();
    
    if (!io) {
        io = new Server({
            cors: {
                origin: "*",
                methods: ["GET", "POST"]
            }
        });

        io.on('connection', (socket) => {
            console.log('Player connected:', socket.id);
            let currentRoom = null;
            let playerId = socket.id;

            // Host new game
            socket.on('hostGame', (data) => {
                try {
                    const { name, color, maxPlayers, password } = data;
                    
                    if (!name || !color || !maxPlayers) {
                        socket.emit('error', { message: 'Missing required fields' });
                        return;
                    }

                    const roomCode = createRoom(playerId, name, color, maxPlayers, password);
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
                    const { roomCode, name, color, password } = data;
                    
                    if (!roomCode || !name || !color) {
                        socket.emit('error', { message: 'Missing required fields' });
                        return;
                    }

                    const room = gameRooms.get(roomCode);
                    
                    if (!room) {
                        socket.emit('error', { message: 'Room not found' });
                        return;
                    }

                    // Check password if room is password protected
                    if (room.password && room.password !== password) {
                        socket.emit('error', { message: 'Incorrect password' });
                        return;
                    }

                    if (room.game.players.size >= room.game.maxPlayers) {
                        socket.emit('error', { message: 'Room is full' });
                        return;
                    }

                    // Check if color is already taken
                    const existingColors = Array.from(room.game.players.values()).map(p => p.color);
                    if (existingColors.includes(color)) {
                        socket.emit('error', { message: 'Color already taken' });
                        return;
                    }

                    const success = room.game.addPlayer(playerId, name, color);
                    
                    if (success) {
                        room.sockets.set(playerId, socket);
                        currentRoom = roomCode;
                        
                        socket.join(roomCode);
                        
                        // Notify all players in room
                        io.to(roomCode).emit('playerJoined', {
                            player: room.game.getPlayer(playerId),
                            gameState: room.game.getGameState()
                        });
                        
                        // Send system chat message
                        io.to(roomCode).emit('chatMessage', {
                            type: 'system',
                            message: `${name} joined the game`,
                            timestamp: Date.now(),
                            context: 'lobby'
                        });
                        
                        socket.emit('joinedRoom', { 
                            roomCode, 
                            gameState: room.game.getGameState(),
                            playerId 
                        });
                        
                        console.log(`${name} joined room ${roomCode}`);
                    } else {
                        socket.emit('error', { message: 'Failed to join room' });
                    }
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
                        socket.emit('error', { message: 'Need at least 2 players to start' });
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

            // Draw card from deck
            socket.on('drawCard', () => {
                try {
                    if (!currentRoom) return;
                    
                    const room = gameRooms.get(currentRoom);
                    if (!room || !room.game.canPlayerAct(playerId)) {
                        socket.emit('error', { message: 'Not your turn' });
                        return;
                    }

                    const card = room.game.drawCard(false);
                    if (card !== null) {
                        room.game.selectedCard = card;
                        room.game.turnAction = 'drew';
                        
                        socket.emit('cardDrawn', { card });
                        socket.to(currentRoom).emit('playerDrewCard', { 
                            playerId,
                            gameState: room.game.getGameState()
                        });
                    }
                } catch (error) {
                    console.error('Error drawing card:', error);
                    socket.emit('error', { message: 'Failed to draw card' });
                }
            });

            // Take discard card
            socket.on('takeDiscard', () => {
                try {
                    if (!currentRoom) return;
                    
                    const room = gameRooms.get(currentRoom);
                    if (!room || !room.game.canPlayerAct(playerId)) {
                        socket.emit('error', { message: 'Not your turn' });
                        return;
                    }

                    const card = room.game.takeDiscardCard();
                    if (card !== null) {
                        room.game.selectedCard = card;
                        room.game.turnAction = 'took_discard';
                        
                        io.to(currentRoom).emit('discardTaken', { 
                            playerId,
                            card,
                            gameState: room.game.getGameState()
                        });
                    }
                } catch (error) {
                    console.error('Error taking discard:', error);
                    socket.emit('error', { message: 'Failed to take discard' });
                }
            });

            // Place card in grid
            socket.on('placeCard', (data) => {
                try {
                    if (!currentRoom) return;
                    
                    const room = gameRooms.get(currentRoom);
                    if (!room || !room.game.canPlayerAct(playerId)) {
                        socket.emit('error', { message: 'Not your turn' });
                        return;
                    }

                    const { position } = data;
                    if (room.game.selectedCard === null) {
                        socket.emit('error', { message: 'No card selected' });
                        return;
                    }

                    const success = room.game.placeCard(playerId, room.game.selectedCard, position);
                    if (success) {
                        // Check if round is complete
                        if (room.game.isRoundComplete()) {
                            room.game.endRound();
                            
                            io.to(currentRoom).emit('roundEnded', {
                                gameState: room.game.getGameState()
                            });
                            
                            if (room.game.gameState === 'ended') {
                                const winner = room.game.endGame();
                                io.to(currentRoom).emit('gameEnded', {
                                    winner,
                                    gameState: room.game.getGameState()
                                });
                            }
                        } else {
                            room.game.nextTurn();
                            
                            io.to(currentRoom).emit('cardPlaced', {
                                playerId,
                                position,
                                card: room.game.selectedCard,
                                gameState: room.game.getGameState()
                            });
                        }
                        
                        room.game.selectedCard = null;
                        room.game.turnAction = null;
                    }
                } catch (error) {
                    console.error('Error placing card:', error);
                    socket.emit('error', { message: 'Failed to place card' });
                }
            });

            // Discard selected card and reveal grid card
            socket.on('discardAndReveal', (data) => {
                try {
                    if (!currentRoom) return;
                    
                    const room = gameRooms.get(currentRoom);
                    if (!room || !room.game.canPlayerAct(playerId)) {
                        socket.emit('error', { message: 'Not your turn' });
                        return;
                    }

                    const { position } = data;
                    if (room.game.selectedCard === null) {
                        socket.emit('error', { message: 'No card selected' });
                        return;
                    }

                    // Discard selected card
                    room.game.discardCard(room.game.selectedCard);
                    
                    // Reveal card at position
                    const success = room.game.revealCard(playerId, position);
                    if (success) {
                        room.game.nextTurn();
                        
                        io.to(currentRoom).emit('cardDiscardedAndRevealed', {
                            playerId,
                            discardedCard: room.game.selectedCard,
                            revealedPosition: position,
                            gameState: room.game.getGameState()
                        });
                        
                        room.game.selectedCard = null;
                        room.game.turnAction = null;
                    }
                } catch (error) {
                    console.error('Error discarding and revealing:', error);
                    socket.emit('error', { message: 'Failed to discard and reveal' });
                }
            });

            // Chat message
            socket.on('chatMessage', (data) => {
                try {
                    if (!currentRoom || !data.message) return;
                    
                    const room = gameRooms.get(currentRoom);
                    if (!room) return;
                    
                    const player = room.game.getPlayer(playerId);
                    if (!player) return;
                    
                    const chatMessage = {
                        type: 'user',
                        playerId: playerId,
                        playerName: player.name,
                        playerColor: player.color,
                        message: data.message.substring(0, 200), // Limit message length
                        timestamp: Date.now(),
                        context: data.context || 'game'
                    };
                    
                    // Broadcast to all players in the room
                    io.to(currentRoom).emit('chatMessage', chatMessage);
                    
                } catch (error) {
                    console.error('Error sending chat message:', error);
                }
            });

            // Get game state
            socket.on('getGameState', () => {
                if (currentRoom) {
                    const room = gameRooms.get(currentRoom);
                    if (room) {
                        socket.emit('gameState', room.game.getGameState());
                    }
                }
            });

            // Leave room
            socket.on('leaveRoom', () => {
                handlePlayerLeave();
            });

            // Handle disconnect
            socket.on('disconnect', () => {
                console.log('Player disconnected:', socket.id);
                handlePlayerLeave();
            });

            function handlePlayerLeave() {
                if (currentRoom) {
                    const room = gameRooms.get(currentRoom);
                    if (room) {
                        const player = room.game.getPlayer(playerId);
                        room.game.removePlayer(playerId);
                        room.sockets.delete(playerId);
                        
                        socket.to(currentRoom).emit('playerLeft', {
                            playerId,
                            player,
                            gameState: room.game.getGameState()
                        });
                        
                        // Send system chat message
                        if (player) {
                            socket.to(currentRoom).emit('chatMessage', {
                                type: 'system',
                                message: `${player.name} left the game`,
                                timestamp: Date.now(),
                                context: 'game'
                            });
                        }
                        
                        // If no players left, delete room
                        if (room.game.players.size === 0) {
                            gameRooms.delete(currentRoom);
                            console.log(`Room ${currentRoom} deleted - no players`);
                        }
                        
                        currentRoom = null;
                    }
                }
            }
        });
    }

    // For Netlify Functions, we need to handle the HTTP request
    // This is a simplified approach - in production you might want to use
    // a more robust WebSocket solution for serverless
    return {
        statusCode: 200,
        headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
        },
        body: JSON.stringify({ message: 'WebSocket server initialized' })
    };
};