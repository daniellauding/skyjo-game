class SkyjoGame {
    constructor() {
        this.deck = [];
        this.players = new Map();
        this.currentPlayerIndex = 0;
        this.roundNumber = 1;
        this.gameState = 'waiting'; // waiting, playing, ended
        this.drawPile = [];
        this.discardPile = [];
        this.maxPlayers = 4;
        this.roomCode = '';
        this.isHost = false;
        this.playerId = '';
        this.gamePhase = 'setup'; // setup, playing, roundEnd, gameEnd
        this.selectedCard = null;
        this.turnAction = null; // drew, discarding, placing
    }

    createDeck() {
        this.deck = [];
        // Skyjo deck: -2(×5), -1(×10), 0(×15), 1-12(×10 each) = 150 cards + 2 special
        
        // Add -2 cards (5 total)
        for (let i = 0; i < 5; i++) {
            this.deck.push(-2);
        }
        
        // Add -1 cards (10 total)
        for (let i = 0; i < 10; i++) {
            this.deck.push(-1);
        }
        
        // Add 0 cards (15 total)
        for (let i = 0; i < 15; i++) {
            this.deck.push(0);
        }
        
        // Add 1-12 cards (10 each = 120 total)
        for (let value = 1; value <= 12; value++) {
            for (let i = 0; i < 10; i++) {
                this.deck.push(value);
            }
        }
        
        this.shuffleDeck();
    }

    shuffleDeck() {
        for (let i = this.deck.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [this.deck[i], this.deck[j]] = [this.deck[j], this.deck[i]];
        }
    }

    dealCards() {
        this.players.forEach(player => {
            player.grid = [];
            player.revealedCards = new Set();
            
            // Deal 12 cards in 4x3 grid
            for (let i = 0; i < 12; i++) {
                player.grid.push({
                    value: this.deck.pop(),
                    revealed: false,
                    position: i
                });
            }
            
            // Each player reveals 2 cards initially
            const positions = this.getRandomPositions(2);
            positions.forEach(pos => {
                player.grid[pos].revealed = true;
                player.revealedCards.add(pos);
            });
        });
        
        // Setup discard pile with top card
        if (this.deck.length > 0) {
            this.discardPile = [this.deck.pop()];
        }
        this.drawPile = [...this.deck];
    }

    getRandomPositions(count) {
        const positions = [];
        while (positions.length < count) {
            const pos = Math.floor(Math.random() * 12);
            if (!positions.includes(pos)) {
                positions.push(pos);
            }
        }
        return positions;
    }

    addPlayer(playerId, name, color) {
        if (this.players.size >= this.maxPlayers) {
            return false;
        }

        const player = {
            id: playerId,
            name: name,
            color: color,
            grid: [],
            score: 0,
            totalScore: 0,
            revealedCards: new Set(),
            isReady: false,
            isHost: this.players.size === 0
        };

        this.players.set(playerId, player);
        return true;
    }

    removePlayer(playerId) {
        return this.players.delete(playerId);
    }

    getPlayer(playerId) {
        return this.players.get(playerId);
    }

    getAllPlayers() {
        return Array.from(this.players.values());
    }

    getCurrentPlayer() {
        const playersList = this.getAllPlayers();
        return playersList[this.currentPlayerIndex];
    }

    nextTurn() {
        this.currentPlayerIndex = (this.currentPlayerIndex + 1) % this.players.size;
        this.turnAction = null;
        this.selectedCard = null;
    }

    canStartGame() {
        return this.players.size >= 2 && this.players.size <= this.maxPlayers;
    }

    startNewRound() {
        this.createDeck();
        this.dealCards();
        this.gamePhase = 'setup';
        this.determineTurnOrder();
        this.gameState = 'playing';
    }

    determineTurnOrder() {
        const playersList = this.getAllPlayers();
        let maxSum = -1;
        let startingPlayerIndex = 0;

        playersList.forEach((player, index) => {
            const revealedSum = Array.from(player.revealedCards)
                .reduce((sum, pos) => sum + player.grid[pos].value, 0);
            
            if (revealedSum > maxSum) {
                maxSum = revealedSum;
                startingPlayerIndex = index;
            }
        });

        this.currentPlayerIndex = startingPlayerIndex;
        this.gamePhase = 'playing';
    }

    drawCard(fromDiscard = false) {
        if (fromDiscard && this.discardPile.length > 0) {
            return this.discardPile[this.discardPile.length - 1];
        } else if (this.drawPile.length > 0) {
            return this.drawPile.pop();
        }
        return null;
    }

    discardCard(card) {
        this.discardPile.push(card);
    }

    takeDiscardCard() {
        if (this.discardPile.length > 0) {
            return this.discardPile.pop();
        }
        return null;
    }

    placeCard(playerId, card, position) {
        const player = this.getPlayer(playerId);
        if (!player || position < 0 || position >= 12) {
            return false;
        }

        const oldCard = player.grid[position];
        player.grid[position] = {
            value: card,
            revealed: true,
            position: position
        };
        
        player.revealedCards.add(position);
        this.discardCard(oldCard.value);
        
        // Check for column completion
        this.checkColumnCompletion(playerId);
        
        return true;
    }

    revealCard(playerId, position) {
        const player = this.getPlayer(playerId);
        if (!player || position < 0 || position >= 12) {
            return false;
        }

        if (!player.grid[position].revealed) {
            player.grid[position].revealed = true;
            player.revealedCards.add(position);
            return true;
        }
        return false;
    }

    checkColumnCompletion(playerId) {
        const player = this.getPlayer(playerId);
        if (!player) return;

        // Check each column (4 columns, 3 rows each)
        for (let col = 0; col < 4; col++) {
            const positions = [col, col + 4, col + 8];
            const cards = positions.map(pos => player.grid[pos]);
            
            // Check if all cards in column are revealed and have same value
            if (cards.every(card => card.revealed) && 
                cards.every(card => card.value === cards[0].value)) {
                
                // Remove the column
                positions.forEach(pos => {
                    player.grid[pos] = null;
                    player.revealedCards.delete(pos);
                });
            }
        }
    }

    calculatePlayerScore(playerId) {
        const player = this.getPlayer(playerId);
        if (!player) return 0;

        let score = 0;
        player.grid.forEach(card => {
            if (card !== null) {
                score += card.value;
            }
        });
        
        player.score = score;
        return score;
    }

    isRoundComplete() {
        return this.getAllPlayers().some(player => 
            player.revealedCards.size === 12 || 
            player.grid.every(card => card === null || card.revealed)
        );
    }

    endRound() {
        this.gamePhase = 'roundEnd';
        
        // Calculate scores for all players
        this.getAllPlayers().forEach(player => {
            this.calculatePlayerScore(player.id);
            player.totalScore += player.score;
        });

        // Check if game should end
        const maxScore = Math.max(...this.getAllPlayers().map(p => p.totalScore));
        if (maxScore >= 100) {
            this.endGame();
        } else {
            this.roundNumber++;
        }
    }

    endGame() {
        this.gameState = 'ended';
        this.gamePhase = 'gameEnd';
        
        // Determine winner (lowest score)
        const winner = this.getAllPlayers().reduce((min, player) => 
            player.totalScore < min.totalScore ? player : min
        );

        return winner;
    }

    getGameState() {
        return {
            roomCode: this.roomCode,
            players: this.getAllPlayers(),
            currentPlayerIndex: this.currentPlayerIndex,
            currentPlayer: this.getCurrentPlayer(),
            roundNumber: this.roundNumber,
            gameState: this.gameState,
            gamePhase: this.gamePhase,
            drawPileCount: this.drawPile.length,
            discardPile: this.discardPile,
            topDiscard: this.discardPile.length > 0 ? this.discardPile[this.discardPile.length - 1] : null
        };
    }

    canPlayerAct(playerId) {
        return this.gameState === 'playing' && 
               this.getCurrentPlayer()?.id === playerId;
    }

    getValidMoves(playerId) {
        if (!this.canPlayerAct(playerId)) {
            return { canDraw: false, canTakeDiscard: false, canPlace: [], canReveal: [] };
        }

        const player = this.getPlayer(playerId);
        const moves = {
            canDraw: this.drawPile.length > 0 && !this.turnAction,
            canTakeDiscard: this.discardPile.length > 0 && !this.turnAction,
            canPlace: [],
            canReveal: []
        };

        if (this.selectedCard !== null) {
            // Can place selected card in any position
            moves.canPlace = Array.from({length: 12}, (_, i) => i);
        }

        if (this.turnAction === 'discarding') {
            // Can reveal any face-down card
            moves.canReveal = Array.from({length: 12}, (_, i) => i)
                .filter(pos => !player.revealedCards.has(pos));
        }

        return moves;
    }
}

// Export for Node.js if available
if (typeof module !== 'undefined' && module.exports) {
    module.exports = SkyjoGame;
}