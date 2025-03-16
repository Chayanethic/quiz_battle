const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

// Initialize Gemini API
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Serve static files
app.use(express.static(path.join(__dirname, '/')));

// Store active rooms and players
const rooms = {};

// Generate a random room code
function generateRoomCode() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// Generate quiz questions using Gemini API
async function generateQuizQuestions(topic, numQuestions) {
    try {
        const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
        
        const prompt = `Create a multiple-choice quiz about "${topic}" with ${numQuestions} questions. 
        For each question, provide 4 options with only one correct answer. 
        Format the response as a JSON array of objects, where each object has:
        - "question": the question text
        - "options": array of 4 possible answers
        - "correctAnswer": the index (0-3) of the correct answer
        
        Example format:
        [
          {
            "question": "What is the capital of France?",
            "options": ["Berlin", "Madrid", "Paris", "Rome"],
            "correctAnswer": 2
          },
          ...
        ]`;
        
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();
        
        // Extract JSON from the response
        const jsonMatch = text.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
            return JSON.parse(jsonMatch[0]);
        } else {
            throw new Error('Failed to parse quiz questions from API response');
        }
    } catch (error) {
        console.error('Error generating quiz questions:', error);
        return null;
    }
}

// Socket.io connection handling
io.on('connection', (socket) => {
    console.log('New client connected:', socket.id);
    
    // Handle time synchronization
    socket.on('sync-time', () => {
        socket.emit('time-sync', {
            serverTime: Date.now()
        });
    });
    
    // Create a new quiz room
    socket.on('create-room', async (data) => {
        try {
            const { topic, numQuestions, playerName } = data;
            const roomCode = generateRoomCode();
            
            console.log(`Creating room ${roomCode} for topic: ${topic}`);
            
            // Generate quiz questions
            const questions = await generateQuizQuestions(topic, numQuestions);
            
            if (!questions) {
                socket.emit('error', { message: 'Failed to generate quiz questions. Please try again.' });
                return;
            }
            
            // Create room
            rooms[roomCode] = {
                host: socket.id,
                topic,
                questions,
                players: [{
                    id: socket.id,
                    name: playerName || 'Host',
                    score: 0,
                    answers: [],
                    answerTimes: []
                }],
                started: false,
                currentQuestion: 0,
                questionStartTime: null,
                questionTimeLimit: 30 // seconds
            };
            
            // Join the room
            socket.join(roomCode);
            socket.roomCode = roomCode;
            
            // Send room info back to creator
            socket.emit('room-created', {
                roomCode,
                players: rooms[roomCode].players
            });
            
        } catch (error) {
            console.error('Error creating room:', error);
            socket.emit('error', { message: 'Failed to create room. Please try again.' });
        }
    });
    
    // Join an existing quiz room
    socket.on('join-room', (data) => {
        const { roomCode, playerName } = data;
        
        // Check if room exists
        if (!rooms[roomCode]) {
            socket.emit('error', { message: 'Room not found. Please check the room code.' });
            return;
        }
        
        // Check if game already started
        if (rooms[roomCode].started) {
            socket.emit('error', { message: 'Game already in progress. Please try another room.' });
            return;
        }
        
        // Add player to room
        const player = {
            id: socket.id,
            name: playerName,
            score: 0,
            answers: [],
            answerTimes: []
        };
        
        rooms[roomCode].players.push(player);
        
        // Join the room
        socket.join(roomCode);
        socket.roomCode = roomCode;
        
        // Notify all players in the room
        io.to(roomCode).emit('player-joined', {
            players: rooms[roomCode].players
        });
        
        // Send room info to the joining player
        socket.emit('room-joined', {
            roomCode,
            players: rooms[roomCode].players
        });
    });
    
    // Start the quiz
    socket.on('start-game', () => {
        const roomCode = socket.roomCode;
        
        if (!roomCode || !rooms[roomCode]) {
            socket.emit('error', { message: 'Room not found.' });
            return;
        }
        
        // Check if user is the host
        if (rooms[roomCode].host !== socket.id) {
            socket.emit('error', { message: 'Only the host can start the game.' });
            return;
        }
        
        // Start the game
        rooms[roomCode].started = true;
        rooms[roomCode].currentQuestion = 0;
        
        // Send first question to all players
        sendQuestion(roomCode);
    });
    
    // Handle player answer
    socket.on('submit-answer', (data) => {
        const { answer, responseTime } = data;
        const roomCode = socket.roomCode;
        
        if (!roomCode || !rooms[roomCode]) {
            return;
        }
        
        const room = rooms[roomCode];
        const currentQuestionIndex = room.currentQuestion;
        const question = room.questions[currentQuestionIndex];
        
        // Find player
        const playerIndex = room.players.findIndex(p => p.id === socket.id);
        if (playerIndex === -1) return;
        
        // Record answer and time
        room.players[playerIndex].answers[currentQuestionIndex] = answer;
        room.players[playerIndex].answerTimes[currentQuestionIndex] = responseTime;
        
        console.log(`Player ${room.players[playerIndex].name} answered in ${responseTime.toFixed(2)}s`);
        
        // Check if correct
        if (answer === question.correctAnswer) {
            // Award points (faster answers get more points)
            const timeBonus = Math.max(0, room.questionTimeLimit - responseTime);
            const points = 10 + Math.floor(timeBonus * 0.5); // Base 10 points + time bonus
            room.players[playerIndex].score += points;
            
            console.log(`Player ${room.players[playerIndex].name} got correct answer in ${responseTime.toFixed(2)}s, awarded ${points} points`);
        }
        
        // Broadcast updated scores to all players in real-time
        io.to(roomCode).emit('score-update', {
            players: room.players
        });
        
        // Check if all players have answered
        const allAnswered = room.players.every(p => 
            p.answers[currentQuestionIndex] !== undefined
        );
        
        if (allAnswered) {
            // Send results for this question
            io.to(roomCode).emit('question-results', {
                questionIndex: currentQuestionIndex,
                correctAnswer: question.correctAnswer,
                players: room.players
            });
            
            // Move to next question after delay
            setTimeout(() => {
                room.currentQuestion++;
                
                // Check if quiz is complete
                if (room.currentQuestion >= room.questions.length) {
                    endQuiz(roomCode);
                } else {
                    sendQuestion(roomCode);
                }
            }, 3000);
        }
    });
    
    // Cancel game
    socket.on('cancel-game', () => {
        const roomCode = socket.roomCode;
        
        if (roomCode && rooms[roomCode] && rooms[roomCode].host === socket.id) {
            // Notify all players
            io.to(roomCode).emit('game-cancelled');
            
            // Remove room
            delete rooms[roomCode];
        }
    });
    
    // Handle disconnection
    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
        
        const roomCode = socket.roomCode;
        if (roomCode && rooms[roomCode]) {
            // Remove player from room
            const playerIndex = rooms[roomCode].players.findIndex(p => p.id === socket.id);
            
            if (playerIndex !== -1) {
                rooms[roomCode].players.splice(playerIndex, 1);
                
                // If host left, end the game
                if (rooms[roomCode].host === socket.id) {
                    io.to(roomCode).emit('game-cancelled', { message: 'Host has left the game.' });
                    delete rooms[roomCode];
                } else if (rooms[roomCode].players.length > 0) {
                    // Notify remaining players
                    io.to(roomCode).emit('player-left', {
                        players: rooms[roomCode].players
                    });
                } else {
                    // No players left, remove room
                    delete rooms[roomCode];
                }
            }
        }
    });
});

// Send current question to all players in a room
function sendQuestion(roomCode) {
    const room = rooms[roomCode];
    if (!room) return;
    
    const currentQuestionIndex = room.currentQuestion;
    const question = room.questions[currentQuestionIndex];
    
    // Record question start time for timing calculations
    room.questionStartTime = Date.now();
    
    // Send question to all players
    io.to(roomCode).emit('new-question', {
        questionIndex: currentQuestionIndex,
        totalQuestions: room.questions.length,
        question: question.question,
        options: question.options,
        serverTime: room.questionStartTime,
        timeLimit: room.questionTimeLimit // Send the time limit to clients
    });
    
    // Set a timer to auto-advance if time runs out
    setTimeout(() => {
        // Check if we're still on the same question
        if (room && room.currentQuestion === currentQuestionIndex) {
            const allAnswered = room.players.every(p => 
                p.answers[currentQuestionIndex] !== undefined
            );
            
            if (!allAnswered) {
                // Auto-submit -1 (no answer) for players who didn't answer
                room.players.forEach((player, playerIndex) => {
                    if (player.answers[currentQuestionIndex] === undefined) {
                        player.answers[currentQuestionIndex] = -1;
                        player.answerTimes[currentQuestionIndex] = room.questionTimeLimit;
                    }
                });
                
                // Send results for this question
                io.to(roomCode).emit('question-results', {
                    questionIndex: currentQuestionIndex,
                    correctAnswer: question.correctAnswer,
                    players: room.players
                });
                
                // Move to next question after delay
                setTimeout(() => {
                    room.currentQuestion++;
                    
                    // Check if quiz is complete
                    if (room.currentQuestion >= room.questions.length) {
                        endQuiz(roomCode);
                    } else {
                        sendQuestion(roomCode);
                    }
                }, 3000);
            }
        }
    }, room.questionTimeLimit * 1000 + 500); // Add 500ms buffer to account for network latency
}

// End the quiz and show final results
function endQuiz(roomCode) {
    const room = rooms[roomCode];
    if (!room) return;
    
    // Sort players by score
    const sortedPlayers = [...room.players].sort((a, b) => b.score - a.score);
    
    // Send final results to all players
    io.to(roomCode).emit('quiz-ended', {
        players: sortedPlayers
    });
    
    // Keep room for a while before deleting
    setTimeout(() => {
        if (rooms[roomCode]) {
            delete rooms[roomCode];
        }
    }, 60000); // Delete after 1 minute
}

// Start the server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
}); 