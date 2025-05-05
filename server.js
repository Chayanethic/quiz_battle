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
const MAX_PLAYERS = 10;

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
        
        const jsonMatch = text.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
            return JSON.parse(jsonMatch[0]);
        } else {
            throw new Error('Failed to parse quiz questions from API response');
        }
    } catch (error) {
        return null;
    }
}

// Send a question to all players in a room
function sendQuestion(roomCode) {
    const room = rooms[roomCode];
    if (!room || room.currentQuestion >= room.questions.length) return;
    
    const questionData = {
        questionIndex: room.currentQuestion,
        totalQuestions: room.questions.length,
        question: room.questions[room.currentQuestion].question,
        options: room.questions[room.currentQuestion].options,
        serverTime: Date.now(),
        timeLimit: room.questionTimeLimit
    };
    
    room.questionStartTime = Date.now();
    io.to(roomCode).emit('new-question', questionData);
}

// End the quiz and send final results
function endQuiz(roomCode) {
    if (!rooms[roomCode]) return;
    
    io.to(roomCode).emit('quiz-ended', {
        players: rooms[roomCode].players
    });
    
    delete rooms[roomCode];
}

// Socket.io connection handling
io.on('connection', (socket) => {
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
            
            const questions = await generateQuizQuestions(topic, numQuestions);
            if (!questions) {
                socket.emit('error', { message: 'Failed to generate quiz questions. Please try again.' });
                return;
            }
            
            rooms[roomCode] = {
                host: socket.id,
                topic,
                questions,
                players: [{
                    id: socket.id,
                    name: playerName || 'Host',
                    score: 0,
                    answers: [],
                    answerTimes: [],
                    isSpeaking: false,
                    isVideoOn: false,
                    isMuted: false
                }],
                started: false,
                currentQuestion: 0,
                questionStartTime: null,
                questionTimeLimit: 30
            };
            
            socket.join(roomCode);
            socket.roomCode = roomCode;
            
            socket.emit('room-created', {
                roomCode,
                players: rooms[roomCode].players
            });
            
        } catch (error) {
            socket.emit('error', { message: 'Failed to create room. Please try again.' });
        }
    });
    
    // Join an existing quiz room
    socket.on('join-room', (data) => {
        const { roomCode, playerName } = data;
        
        if (!rooms[roomCode]) {
            socket.emit('error', { message: 'Room not found. Please check the room code.' });
            return;
        }
        
        if (rooms[roomCode].started) {
            socket.emit('error', { message: 'Game already in progress. Please try another room.' });
            return;
        }
        
        if (rooms[roomCode].players.length >= MAX_PLAYERS) {
            socket.emit('error', { message: `Room is full. Maximum ${MAX_PLAYERS} players allowed.` });
            return;
        }
        
        const player = {
            id: socket.id,
            name: playerName,
            score: 0,
            answers: [],
            answerTimes: [],
            isSpeaking: false,
            isVideoOn: false,
            isMuted: false
        };
        
        rooms[roomCode].players.push(player);
        
        socket.join(roomCode);
        socket.roomCode = roomCode;
        
        io.to(roomCode).emit('player-joined', {
            players: rooms[roomCode].players
        });
        
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
        
        if (rooms[roomCode].host !== socket.id) {
            socket.emit('error', { message: 'Only the host can start the game.' });
            return;
        }
        
        rooms[roomCode].started = true;
        rooms[roomCode].currentQuestion = 0;
        
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
        
        const playerIndex = room.players.findIndex(p => p.id === socket.id);
        if (playerIndex === -1) return;
        
        room.players[playerIndex].answers[currentQuestionIndex] = answer;
        room.players[playerIndex].answerTimes[currentQuestionIndex] = responseTime;
        
        if (answer === question.correctAnswer) {
            const timeBonus = Math.max(0, room.questionTimeLimit - responseTime);
            const points = 10 + Math.floor(timeBonus * 0.5);
            room.players[playerIndex].score += points;
        }
        
        io.to(roomCode).emit('score-update', {
            players: room.players
        });
        
        const allAnswered = room.players.every(p => 
            p.answers[currentQuestionIndex] !== undefined
        );
        
        if (allAnswered) {
            io.to(roomCode).emit('question-results', {
                questionIndex: currentQuestionIndex,
                correctAnswer: question.correctAnswer,
                players: room.players
            });
            
            setTimeout(() => {
                room.currentQuestion++;
                
                if (room.currentQuestion >= room.questions.length) {
                    endQuiz(roomCode);
                } else {
                    sendQuestion(roomCode);
                }
            }, 3000);
        }
    });
    
    // Handle chat messages and emoji reactions
    socket.on('chat-message', (data) => {
        const { roomCode, message, sender, isEmoji } = data;
        if (!rooms[roomCode]) return;
        
        const messageData = {
            sender,
            message,
            isEmoji,
            timestamp: Date.now()
        };
        
        io.to(roomCode).emit('chat-message', messageData);
    });
    
    // Cancel the game
    socket.on('cancel-game', () => {
        const roomCode = socket.roomCode;
        if (!roomCode || !rooms[roomCode]) {
            socket.emit('error', { message: 'Room not found.' });
            return;
        }
        
        if (rooms[roomCode].host !== socket.id) {
            socket.emit('error', { message: 'Only the host can cancel the game.' });
            return;
        }
        
        io.to(roomCode).emit('game-cancelled', { message: 'The game has been cancelled by the host.' });
        delete rooms[roomCode];
    });
    
    // Handle media chat (voice and video) initiation
    socket.on('start-media-chat', (data) => {
        const { roomCode } = data;
        if (!rooms[roomCode]) return;
        
        socket.to(roomCode).emit('start-media-chat', { from: socket.id });
    });
    
    // Handle media status (mic and video on/off)
    socket.on('media-status', (data) => {
        const { roomCode, isSpeaking, isVideoOn, isMuted } = data;
        if (!rooms[roomCode]) return;
        
        const playerIndex = rooms[roomCode].players.findIndex(p => p.id === socket.id);
        if (playerIndex === -1) return;
        
        rooms[roomCode].players[playerIndex].isSpeaking = isSpeaking;
        rooms[roomCode].players[playerIndex].isVideoOn = isVideoOn;
        rooms[roomCode].players[playerIndex].isMuted = isMuted;
        
        io.to(roomCode).emit('media-status', {
            playerId: socket.id,
            isSpeaking,
            isVideoOn,
            isMuted
        });
    });
    
    // Handle WebRTC offer
    socket.on('offer', (data) => {
        const { roomCode, offer, to } = data;
        if (!rooms[roomCode]) return;
        
        socket.to(to).emit('offer', { offer, from: socket.id });
    });
    
    // Handle WebRTC answer
    socket.on('answer', (data) => {
        const { roomCode, answer, to } = data;
        if (!rooms[roomCode]) return;
        
        socket.to(to).emit('answer', { answer, from: socket.id });
    });
    
    // Handle WebRTC ICE candidate
    socket.on('ice-candidate', (data) => {
        const { roomCode, candidate, to } = data;
        if (!rooms[roomCode]) return;
        
        socket.to(to).emit('ice-candidate', { candidate, from: socket.id });
    });
    
    // Handle mute all
    socket.on('mute-all', (data) => {
        const { roomCode, muted } = data;
        if (!rooms[roomCode]) return;
        
        if (rooms[roomCode].host !== socket.id) {
            socket.emit('error', { message: 'Only the host can mute all players.' });
            return;
        }
        
        rooms[roomCode].players.forEach(player => {
            player.isMuted = muted;
            player.isSpeaking = muted ? false : player.isSpeaking;
            // isVideoOn remains unchanged
        });
        
        io.to(roomCode).emit('mute-all', { muted });
    });
    
    // Handle player disconnection
    socket.on('disconnect', () => {
        const roomCode = socket.roomCode;
        if (!roomCode || !rooms[roomCode]) {
            return;
        }
        
        const room = rooms[roomCode];
        const playerIndex = room.players.findIndex(p => p.id === socket.id);
        if (playerIndex === -1) {
            return;
        }
        
        room.players.splice(playerIndex, 1);
        
        io.to(roomCode).emit('player-left', {
            players: room.players
        });
        
        if (room.players.length === 0 || room.host === socket.id) {
            io.to(roomCode).emit('game-cancelled', { message: 'The game has been cancelled due to host disconnection.' });
            delete rooms[roomCode];
        }
    });
});

// Start the server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {});
// const express = require('express');
// const http = require('http');
// const socketIo = require('socket.io');
// const path = require('path');
// const { GoogleGenerativeAI } = require('@google/generative-ai');
// require('dotenv').config();

// // Initialize Gemini API
// const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// const app = express();
// const server = http.createServer(app);
// const io = socketIo(server);

// // Serve static files
// app.use(express.static(path.join(__dirname, '/')));

// // Store active rooms and players
// const rooms = {};

// // Generate a random room code
// function generateRoomCode() {
//     return Math.random().toString(36).substring(2, 8).toUpperCase();
// }

// // Generate quiz questions using Gemini API
// async function generateQuizQuestions(topic, numQuestions) {
//     try {
//         const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
//         const prompt = `Create a multiple-choice quiz about "${topic}" with ${numQuestions} questions. 
//         For each question, provide 4 options with only one correct answer. 
//         Format the response as a JSON array of objects, where each object has:
//         - "question": the question text
//         - "options": array of 4 possible answers
//         - "correctAnswer": the index (0-3) of the correct answer
        
//         Example format:
//         [
//           {
//             "question": "What is the capital of France?",
//             "options": ["Berlin", "Madrid", "Paris", "Rome"],
//             "correctAnswer": 2
//           },
//           ...
//         ]`;
        
//         const result = await model.generateContent(prompt);
//         const response = await result.response;
//         const text = response.text();
        
//         const jsonMatch = text.match(/\[[\s\S]*\]/);
//         if (jsonMatch) {
//             return JSON.parse(jsonMatch[0]);
//         } else {
//             throw new Error('Failed to parse quiz questions from API response');
//         }
//     } catch (error) {
//         console.error('Error generating quiz questions:', error);
//         return null;
//     }
// }

// // Socket.io connection handling
// io.on('connection', (socket) => {
//     console.log('New client connected:', socket.id);
    
//     // Handle time synchronization
//     socket.on('sync-time', () => {
//         socket.emit('time-sync', {
//             serverTime: Date.now()
//         });
//     });
    
//     // Create a new quiz room
//     socket.on('create-room', async (data) => {
//         try {
//             const { topic, numQuestions, playerName } = data;
//             const roomCode = generateRoomCode();
            
//             console.log(`Creating room ${roomCode} for topic: ${topic}`);
            
//             const questions = await generateQuizQuestions(topic, numQuestions);
//             if (!questions) {
//                 socket.emit('error', { message: 'Failed to generate quiz questions. Please try again.' });
//                 return;
//             }
            
//             rooms[roomCode] = {
//                 host: socket.id,
//                 topic,
//                 questions,
//                 players: [{
//                     id: socket.id,
//                     name: playerName || 'Host',
//                     score: 0,
//                     answers: [],
//                     answerTimes: []
//                 }],
//                 started: false,
//                 currentQuestion: 0,
//                 questionStartTime: null,
//                 questionTimeLimit: 30
//             };
            
//             socket.join(roomCode);
//             socket.roomCode = roomCode;
            
//             socket.emit('room-created', {
//                 roomCode,
//                 players: rooms[roomCode].players
//             });
            
//         } catch (error) {
//             console.error('Error creating room:', error);
//             socket.emit('error', { message: 'Failed to create room. Please try again.' });
//         }
//     });
    
//     // Join an existing quiz room
//     socket.on('join-room', (data) => {
//         const { roomCode, playerName } = data;
        
//         if (!rooms[roomCode]) {
//             socket.emit('error', { message: 'Room not found. Please check the room code.' });
//             return;
//         }
        
//         if (rooms[roomCode].started) {
//             socket.emit('error', { message: 'Game already in progress. Please try another room.' });
//             return;
//         }
        
//         const player = {
//             id: socket.id,
//             name: playerName,
//             score: 0,
//             answers: [],
//             answerTimes: []
//         };
        
//         rooms[roomCode].players.push(player);
        
//         socket.join(roomCode);
//         socket.roomCode = roomCode;
        
//         io.to(roomCode).emit('player-joined', {
//             players: rooms[roomCode].players
//         });
        
//         socket.emit('room-joined', {
//             roomCode,
//             players: rooms[roomCode].players
//         });
//     });
    
//     // Start the quiz
//     socket.on('start-game', () => {
//         const roomCode = socket.roomCode;
        
//         if (!roomCode || !rooms[roomCode]) {
//             socket.emit('error', { message: 'Room not found.' });
//             return;
//         }
        
//         if (rooms[roomCode].host !== socket.id) {
//             socket.emit('error', { message: 'Only the host can start the game.' });
//             return;
//         }
        
//         rooms[roomCode].started = true;
//         rooms[roomCode].currentQuestion = 0;
        
//         sendQuestion(roomCode);
//     });
    
//     // Handle player answer
//     socket.on('submit-answer', (data) => {
//         const { answer, responseTime } = data;
//         const roomCode = socket.roomCode;
        
//         if (!roomCode || !rooms[roomCode]) {
//             return;
//         }
        
//         const room = rooms[roomCode];
//         const currentQuestionIndex = room.currentQuestion;
//         const question = room.questions[currentQuestionIndex];
        
//         const playerIndex = room.players.findIndex(p => p.id === socket.id);
//         if (playerIndex === -1) return;
        
//         room.players[playerIndex].answers[currentQuestionIndex] = answer;
//         room.players[playerIndex].answerTimes[currentQuestionIndex] = responseTime;
        
//         console.log(`Player ${room.players[playerIndex].name} answered in ${responseTime.toFixed(2)}s`);
        
//         if (answer === question.correctAnswer) {
//             const timeBonus = Math.max(0, room.questionTimeLimit - responseTime);
//             const points = 10 + Math.floor(timeBonus * 0.5);
//             room.players[playerIndex].score += points;
//             console.log(`Player ${room.players[playerIndex].name} got correct answer in ${responseTime.toFixed(2)}s, awarded ${points} points`);
//         }
        
//         io.to(roomCode).emit('score-update', {
//             players: room.players
//         });
        
//         const allAnswered = room.players.every(p => 
//             p.answers[currentQuestionIndex] !== undefined
//         );
        
//         if (allAnswered) {
//             io.to(roomCode).emit('question-results', {
//                 questionIndex: currentQuestionIndex,
//                 correctAnswer: question.correctAnswer,
//                 players: room.players
//             });
            
//             setTimeout(() => {
//                 room.currentQuestion++;
                
//                 if (room.currentQuestion >= room.questions.length) {
//                     endQuiz(roomCode);
//                 } else {
//                     sendQuestion(roomCode);
//                 }
//             }, 3000);
//         }
//     });
    
//     // Handle chat messages
//     socket.on('chat-message', (data) => {
//         const { roomCode, message, sender } = data;
//         if (!rooms[roomCode]) return;
        
//         const chatData = {
//             sender,
//             message,
//             timestamp: Date.now()
//         };
        
//         io.to(roomCode).emit('chat-message', chatData);
//     });
    
//     // Cancel game
//     socket.on('cancel-game', () => {
//         const roomCode = socket.roomCode;
        
//         if (roomCode && rooms[roomCode] && rooms[roomCode].host === socket.id) {
//             io.to(roomCode).emit('game-cancelled');
//             delete rooms[roomCode];
//         }
//     });
    
//     // Handle disconnection
//     socket.on('disconnect', () => {
//         console.log('Client disconnected:', socket.id);
        
//         const roomCode = socket.roomCode;
//         if (roomCode && rooms[roomCode]) {
//             const playerIndex = rooms[roomCode].players.findIndex(p => p.id === socket.id);
            
//             if (playerIndex !== -1) {
//                 rooms[roomCode].players.splice(playerIndex, 1);
                
//                 if (rooms[roomCode].host === socket.id) {
//                     io.to(roomCode).emit('game-cancelled', { message: 'Host has left the game.' });
//                     delete rooms[roomCode];
//                 } else if (rooms[roomCode].players.length > 0) {
//                     io.to(roomCode).emit('player-left', {
//                         players: rooms[roomCode].players
//                     });
//                 } else {
//                     delete rooms[roomCode];
//                 }
//             }
//         }
//     });
// });

// // Send current question to all players in a room
// function sendQuestion(roomCode) {
//     const room = rooms[roomCode];
//     if (!room) return;
    
//     const currentQuestionIndex = room.currentQuestion;
//     const question = room.questions[currentQuestionIndex];
    
//     room.questionStartTime = Date.now();
    
//     io.to(roomCode).emit('new-question', {
//         questionIndex: currentQuestionIndex,
//         totalQuestions: room.questions.length,
//         question: question.question,
//         options: question.options,
//         serverTime: room.questionStartTime,
//         timeLimit: room.questionTimeLimit
//     });
    
//     setTimeout(() => {
//         if (room && room.currentQuestion === currentQuestionIndex) {
//             const allAnswered = room.players.every(p => 
//                 p.answers[currentQuestionIndex] !== undefined
//             );
            
//             if (!allAnswered) {
//                 room.players.forEach((player, playerIndex) => {
//                     if (player.answers[currentQuestionIndex] === undefined) {
//                         player.answers[currentQuestionIndex] = -1;
//                         player.answerTimes[currentQuestionIndex] = room.questionTimeLimit;
//                     }
//                 });
                
//                 io.to(roomCode).emit('question-results', {
//                     questionIndex: currentQuestionIndex,
//                     correctAnswer: question.correctAnswer,
//                     players: room.players
//                 });
                
//                 setTimeout(() => {
//                     room.currentQuestion++;
                    
//                     if (room.currentQuestion >= room.questions.length) {
//                         endQuiz(roomCode);
//                     } else {
//                         sendQuestion(roomCode);
//                     }
//                 }, 3000);
//             }
//         }
//     }, room.questionTimeLimit * 1000 + 500);
// }

// // End the quiz and show final results
// function endQuiz(roomCode) {
//     const room = rooms[roomCode];
//     if (!room) return;
    
//     const sortedPlayers = [...room.players].sort((a, b) => b.score - a.score);
    
//     io.to(roomCode).emit('quiz-ended', {
//         players: sortedPlayers
//     });
    
//     setTimeout(() => {
//         if (rooms[roomCode]) {
//             delete rooms[roomCode];
//         }
//     }, 60000);
// }

// // Start the server
// const PORT = process.env.PORT || 3000;
// server.listen(PORT, () => {
//     console.log(`Server running on port ${PORT}`);
// });
