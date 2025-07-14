// netlify/functions/api.js
const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// CORS headers
const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Content-Type': 'application/json'
};

exports.handler = async (event, context) => {
  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  const path = event.path.replace('/.netlify/functions/api', '');
  const method = event.httpMethod;
  const body = event.body ? JSON.parse(event.body) : {};
  const query = event.queryStringParameters || {};

  try {
    // Admin authentication
    if (path.startsWith('/admin') && path !== '/admin/login') {
      const authHeader = event.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
      }
      
      const token = authHeader.split(' ')[1];
      if (token !== process.env.ADMIN_TOKEN) {
        return { statusCode: 401, headers, body: JSON.stringify({ error: 'Invalid token' }) };
      }
    }

    // Route handling
    switch (path) {
      case '/admin/login':
        return handleAdminLogin(body);
      
      case '/admin/products':
        if (method === 'GET') return getProducts();
        if (method === 'POST') return createProduct(body);
        if (method === 'PUT') return updateProduct(body);
        if (method === 'DELETE') return deleteProduct(query.id);
        break;
      
      case '/game/join':
        return joinGame(body);
      
      case '/game/lobby':
        return getLobbyStatus(query.gameId);
      
      case '/game/start':
        return startGame(body);
      
      case '/game/guess':
        return submitGuess(body);
      
      case '/game/status':
        return getGameStatus(query.gameId);
      
      case '/game/results':
        return getGameResults(query.gameId);
      
      default:
        return { statusCode: 404, headers, body: JSON.stringify({ error: 'Not found' }) };
    }
  } catch (error) {
    console.error('API Error:', error);
    return { 
      statusCode: 500, 
      headers, 
      body: JSON.stringify({ error: 'Internal server error' }) 
    };
  }
};

// Admin functions
async function handleAdminLogin(body) {
  const { password } = body;
  if (password === process.env.ADMIN_PASSWORD) {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ 
        success: true, 
        token: process.env.ADMIN_TOKEN 
      })
    };
  }
  return {
    statusCode: 401,
    headers,
    body: JSON.stringify({ error: 'Invalid password' })
  };
}

async function getProducts() {
  const { data, error } = await supabase
    .from('products')
    .select('*')
    .order('id');
  
  if (error) throw error;
  
  return {
    statusCode: 200,
    headers,
    body: JSON.stringify(data)
  };
}

async function createProduct(body) {
  const { name, price, image, isFinale } = body;
  
  const { data, error } = await supabase
    .from('products')
    .insert([{ name, price, image, is_finale: isFinale }])
    .select();
  
  if (error) throw error;
  
  return {
    statusCode: 201,
    headers,
    body: JSON.stringify(data[0])
  };
}

async function updateProduct(body) {
  const { id, name, price, image, isFinale } = body;
  
  const { data, error } = await supabase
    .from('products')
    .update({ name, price, image, is_finale: isFinale })
    .eq('id', id)
    .select();
  
  if (error) throw error;
  
  return {
    statusCode: 200,
    headers,
    body: JSON.stringify(data[0])
  };
}

async function deleteProduct(id) {
  const { error } = await supabase
    .from('products')
    .delete()
    .eq('id', id);
  
  if (error) throw error;
  
  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ success: true })
  };
}

// Game functions
async function joinGame(body) {
  const { playerName, panelId } = body;
  const gameId = generateGameId();
  
  // Check for existing lobby
  let { data: existingGame } = await supabase
    .from('games')
    .select('*')
    .eq('status', 'lobby')
    .gte('created_at', new Date(Date.now() - 30000).toISOString()) // Within last 30 seconds
    .limit(1);
  
  if (existingGame && existingGame.length > 0) {
    // Join existing game
    const game = existingGame[0];
    const players = game.players || [];
    
    if (players.length < 4) {
      players.push({
        id: Date.now(),
        name: playerName,
        panelId: panelId,
        isBot: false,
        score: 0
      });
      
      const { error } = await supabase
        .from('games')
        .update({ players })
        .eq('id', game.id);
      
      if (error) throw error;
      
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ 
          gameId: game.id, 
          playerId: players[players.length - 1].id,
          players: players.length
        })
      };
    }
  }
  
  // Create new game
  const player = {
    id: Date.now(),
    name: playerName,
    panelId: panelId,
    isBot: false,
    score: 0
  };
  
  const { data, error } = await supabase
    .from('games')
    .insert([{
      id: gameId,
      status: 'lobby',
      players: [player],
      current_round: 0,
      lobby_timer: 20,
      created_at: new Date().toISOString()
    }])
    .select();
  
  if (error) throw error;
  
  // Start lobby timer
  setTimeout(() => fillWithBotsAndStart(gameId), 20000);
  
  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ 
      gameId, 
      playerId: player.id,
      players: 1
    })
  };
}

async function getLobbyStatus(gameId) {
  const { data, error } = await supabase
    .from('games')
    .select('*')
    .eq('id', gameId)
    .single();
  
  if (error) throw error;
  
  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      status: data.status,
      players: data.players,
      lobbyTimer: Math.max(0, 20 - Math.floor((Date.now() - new Date(data.created_at)) / 1000))
    })
  };
}

async function fillWithBotsAndStart(gameId) {
  const { data: game } = await supabase
    .from('games')
    .select('*')
    .eq('id', gameId)
    .single();
  
  if (!game || game.status !== 'lobby') return;
  
  const players = game.players || [];
  const botNames = ['Alex', 'Sarah', 'Mike', 'Emma'];
  
  // Fill remaining slots with bots
  while (players.length < 4) {
    players.push({
      id: Date.now() + Math.random(),
      name: botNames[players.length - 1] || `Bot${players.length}`,
      panelId: null,
      isBot: true,
      score: 0
    });
  }
  
  // Get products for the game
  const { data: products } = await supabase
    .from('products')
    .select('*');
  
  const regularProducts = products.filter(p => !p.is_finale);
  const finaleProducts = products.filter(p => p.is_finale);
  
  // Shuffle products
  const shuffledProducts = regularProducts.sort(() => Math.random() - 0.5);
  
  await supabase
    .from('games')
    .update({
      status: 'playing',
      players,
      products: shuffledProducts,
      finale_product: finaleProducts[0] || null,
      current_round: 0,
      round_timer: 10
    })
    .eq('id', gameId);
}

async function startGame(body) {
  const { gameId } = body;
  
  const { data, error } = await supabase
    .from('games')
    .update({ status: 'playing' })
    .eq('id', gameId)
    .select();
  
  if (error) throw error;
  
  return {
    statusCode: 200,
    headers,
    body: JSON.stringify(data[0])
  };
}

async function submitGuess(body) {
  const { gameId, playerId, guess } = body;
  
  // Get current game state
  const { data: game } = await supabase
    .from('games')
    .select('*')
    .eq('id', gameId)
    .single();
  
  if (!game) throw new Error('Game not found');
  
  // Update player's guess
  const players = game.players.map(p => 
    p.id === playerId ? { ...p, guess } : p
  );
  
  // Check if all real players have guessed
  const realPlayers = players.filter(p => !p.isBot);
  const guessedPlayers = realPlayers.filter(p => p.guess);
  
  if (guessedPlayers.length === realPlayers.length) {
    // Process round
    await processRound(gameId, players, game);
  }
  
  await supabase
    .from('games')
    .update({ players })
    .eq('id', gameId);
  
  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ success: true })
  };
}

async function processRound(gameId, players, game) {
  const currentProduct = game.products[game.current_round];
  const previousProduct = game.current_round > 0 ? game.products[game.current_round - 1] : null;
  
  if (game.current_round > 0 && previousProduct) {
    const isHigher = currentProduct.price > previousProduct.price;
    
    // Score players
    players.forEach(player => {
      if (player.isBot) {
        // Bots guess randomly with 60% accuracy
        player.guess = Math.random() > 0.4 ? (isHigher ? 'higher' : 'lower') : (isHigher ? 'lower' : 'higher');
      }
      
      const correct = (player.guess === 'higher' && isHigher) || (player.guess === 'lower' && !isHigher);
      if (correct) {
        player.score += 100;
      }
      
      // Clear guess for next round
      delete player.guess;
    });
  }
  
  const nextRound = game.current_round + 1;
  const maxRounds = game.products.length + (game.finale_product ? 1 : 0);
  
  if (nextRound >= maxRounds) {
    // Game complete
    await supabase
      .from('games')
      .update({
        status: 'completed',
        players,
        completed_at: new Date().toISOString()
      })
      .eq('id', gameId);
  } else {
    // Next round
    await supabase
      .from('games')
      .update({
        players,
        current_round: nextRound,
        round_timer: 10
      })
      .eq('id', gameId);
  }
}

async function getGameStatus(gameId) {
  const { data, error } = await supabase
    .from('games')
    .select('*')
    .eq('id', gameId)
    .single();
  
  if (error) throw error;
  
  return {
    statusCode: 200,
    headers,
    body: JSON.stringify(data)
  };
}

async function getGameResults(gameId) {
  const { data, error } = await supabase
    .from('games')
    .select('*')
    .eq('id', gameId)
    .single();
  
  if (error) throw error;
  
  // Sort players by score
  const sortedPlayers = data.players.sort((a, b) => b.score - a.score);
  
  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      players: sortedPlayers,
      gameData: data
    })
  };
}

function generateGameId() {
  return Math.random().toString(36).substring(2, 15);
}