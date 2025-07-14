function generateGameId() {
  return Math.random().toString(36).substring(2, 15);
}// netlify/functions/api.js
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
      
      case '/admin/download':
        return downloadResponses();
      
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
  
  // Check for existing lobby
  let { data: existingGame } = await supabase
    .from('games')
    .select('*')
    .eq('status', 'lobby')
    .gte('created_at', new Date(Date.now() - 25000).toISOString()) // Within last 25 seconds (give 5s buffer)
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
  const gameId = generateGameId();
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
  
  const lobbyTimer = Math.max(0, 20 - Math.floor((Date.now() - new Date(data.created_at)) / 1000));
  
  // Auto-start game if lobby timer expired and still in lobby
  if (lobbyTimer === 0 && data.status === 'lobby') {
    await fillWithBotsAndStart(gameId);
    // Fetch updated game data
    const { data: updatedData } = await supabase
      .from('games')
      .select('*')
      .eq('id', gameId)
      .single();
    
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        status: updatedData.status,
        players: updatedData.players,
        lobbyTimer: 0
      })
    };
  }
  
  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      status: data.status,
      players: data.players,
      lobbyTimer
    })
  };
}

async function fillWithBotsAndStart(gameId) {
  try {
    console.log(`🎮 Starting fillWithBotsAndStart for game ${gameId}`);
    
    const { data: game, error: gameError } = await supabase
      .from('games')
      .select('*')
      .eq('id', gameId)
      .single();
    
    if (gameError) {
      console.error('❌ Error fetching game:', gameError);
      return;
    }
    
    if (!game || game.status !== 'lobby') {
      console.log(`⚠️ Game ${gameId} not found or not in lobby state. Status: ${game?.status}`);
      return;
    }
    
    console.log(`✅ Game ${gameId} found in lobby with ${game.players?.length || 0} players`);
    
    const players = [...(game.players || [])]; // Create a copy
    const botNames = ['Alex', 'Sarah', 'Mike', 'Emma'];
    
    // Fill remaining slots with bots
    while (players.length < 4) {
      players.push({
        id: Date.now() + Math.random() * 1000 + players.length,
        name: botNames[players.length - 1] || `Bot${players.length}`,
        panelId: null,
        isBot: true,
        score: 0
      });
    }
    
    console.log(`🤖 Added bots. Total players: ${players.length}`);
    
    // Get products for the game - try with different approaches for RLS issues
    console.log('📦 Fetching products...');
    let products = null;
    let productsError = null;
    
    // First try: Normal query
    const { data: productsData, error: normalError } = await supabase
      .from('products')
      .select('*');
    
    if (normalError) {
      console.error('❌ Normal products query failed:', normalError);
      productsError = normalError;
    } else {
      products = productsData;
      console.log(`✅ Products fetched successfully: ${products?.length || 0} products`);
    }
    
    // If products query failed or returned empty, try with service role
    if (!products || products.length === 0) {
      console.log('🔑 Trying products query with service role...');
      
      // Create service role client if we have the key
      if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
        const serviceSupabase = createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY);
        const { data: serviceProducts, error: serviceError } = await serviceSupabase
          .from('products')
          .select('*');
        
        if (serviceError) {
          console.error('❌ Service role products query failed:', serviceError);
        } else {
          products = serviceProducts;
          console.log(`✅ Service role products fetched: ${products?.length || 0} products`);
        }
      } else {
        console.log('⚠️ No service role key available');
      }
    }
    
    if (!products || products.length === 0) {
      console.error('❌ No products found. Creating default products...');
      
      // Create some default products if none exist
      const defaultProducts = [
        { name: 'iPhone 15', price: 999, image: '📱', is_finale: false },
        { name: 'MacBook Pro', price: 2499, image: '💻', is_finale: false },
        { name: 'AirPods Pro', price: 249, image: '🎧', is_finale: false },
        { name: 'Apple Watch', price: 399, image: '⌚', is_finale: true }
      ];
      
      // Try to insert default products
      const { data: insertedProducts, error: insertError } = await supabase
        .from('products')
        .insert(defaultProducts)
        .select();
      
      if (insertError) {
        console.error('❌ Failed to create default products:', insertError);
        console.error('🚨 CANNOT START GAME - NO PRODUCTS AVAILABLE');
        return;
      } else {
        products = insertedProducts;
        console.log(`✅ Created ${products.length} default products`);
      }
    }
    
    const regularProducts = products.filter(p => !p.is_finale);
    const finaleProducts = products.filter(p => p.is_finale);
    
    if (regularProducts.length === 0) {
      console.error('❌ No regular products found. Need at least 1 regular product to start game.');
      return;
    }
    
    console.log(`📊 Regular products: ${regularProducts.length}, Finale products: ${finaleProducts.length}`);
    
    // Shuffle products
    const shuffledProducts = regularProducts.sort(() => Math.random() - 0.5);
    
    console.log('🎯 Starting game...');
    const { error: updateError } = await supabase
      .from('games')
      .update({
        status: 'playing',
        players,
        products: shuffledProducts,
        finale_product: finaleProducts[0] || null,
        current_round: 0,
        round_timer: 10
      })
      .eq('id', gameId)
      .eq('status', 'lobby'); // Only update if still in lobby to avoid race conditions
    
    if (updateError) {
      console.error('❌ Error starting game:', updateError);
    } else {
      console.log(`🎉 Game ${gameId} started successfully with ${players.length} players and ${shuffledProducts.length} products`);
      
      // Auto-advance to round 1 after 5 seconds (skip the "show first product" phase)
      setTimeout(async () => {
        console.log(`⏭️ Auto-advancing game ${gameId} to round 1`);
        await supabase
          .from('games')
          .update({
            current_round: 1,
            round_timer: 10
          })
          .eq('id', gameId);
      }, 5000);
    }
  } catch (error) {
    console.error('💥 Unexpected error in fillWithBotsAndStart:', error);
  }
}

async function startGame(body) {
  const { gameId } = body;
  
  const { data, error } = await supabase
    .from('games')
    .update({ 
      status: 'playing',
      round_start_time: new Date().toISOString()
    })
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
    // Process round immediately
    await processRound(gameId, players, game);
  } else {
    // Just update players
    await supabase
      .from('games')
      .update({ players })
      .eq('id', gameId);
  }
  
  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ success: true })
  };
}

async function processRound(gameId, players, game) {
  const currentRound = game.current_round;
  const products = game.products || [];
  const finaleProduct = game.finale_product;
  
  // Get current and previous products
  let currentProduct, previousProduct;
  
  if (currentRound < products.length) {
    currentProduct = products[currentRound];
    previousProduct = currentRound > 0 ? products[currentRound - 1] : null;
  } else if (finaleProduct && currentRound === products.length) {
    currentProduct = finaleProduct;
    previousProduct = products[products.length - 1];
  }
  
  if (currentRound > 0 && previousProduct && currentProduct) {
    const isHigher = currentProduct.price > previousProduct.price;
    
    // Score players and store responses for real players only
    players.forEach(player => {
      if (player.isBot && !player.guess) {
        // Bots guess randomly with 60% accuracy
        player.guess = Math.random() > 0.4 ? (isHigher ? 'higher' : 'lower') : (isHigher ? 'lower' : 'higher');
      }
      
      if (player.guess) {
        const correct = (player.guess === 'higher' && isHigher) || (player.guess === 'lower' && !isHigher);
        if (correct) {
          player.score += 100;
        }
        
        // Store the response for this round - ONLY for real players (not bots)
        if (!player.isBot) {
          if (!player.responses) {
            player.responses = [];
          }
          
          player.responses.push({
            round: currentRound,
            guess: player.guess,
            correct: correct,
            actualHigher: isHigher,
            currentProduct: currentProduct.name,
            currentPrice: currentProduct.price,
            previousProduct: previousProduct.name,
            previousPrice: previousProduct.price,
            responseTime: new Date().toISOString()
          });
        }
      }
      
      // Clear guess for next round
      delete player.guess;
    });
  }
  
  const nextRound = currentRound + 1;
  const maxRounds = products.length + (finaleProduct ? 1 : 0);
  
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
    // Next round - add delay before starting next round
    setTimeout(async () => {
      const updateData = {
        players,
        current_round: nextRound,
        round_timer: 10
      };
      
      // Add round_start_time only if the column exists
      try {
        updateData.round_start_time = new Date().toISOString();
      } catch (e) {
        // Column doesn't exist, skip it
      }
      
      await supabase
        .from('games')
        .update(updateData)
        .eq('id', gameId);
    }, 3000); // 3 second delay between rounds
    
    // Temporarily update with results visible
    await supabase
      .from('games')
      .update({
        players,
        round_timer: 0 // Show results
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
  
  // Handle lobby timer expiration
  if (data.status === 'lobby') {
    const gameAge = Date.now() - new Date(data.created_at).getTime();
    const lobbyTimer = Math.max(0, 20 - Math.floor(gameAge / 1000));
    
    console.log(`🕐 Game ${gameId} lobby timer: ${lobbyTimer}s (age: ${Math.floor(gameAge/1000)}s)`);
    
    // Start game if timer expired or almost expired (within 1 second)
    if (lobbyTimer <= 1) {
      console.log(`🚀 TRIGGERING GAME START for ${gameId} - timer: ${lobbyTimer}`);
      
      // Call fillWithBotsAndStart and wait for it
      await fillWithBotsAndStart(gameId);
      
      // Fetch updated game data with retries
      let attempts = 0;
      let updatedData = data;
      
      while (attempts < 5 && updatedData.status === 'lobby') {
        console.log(`🔄 Retry ${attempts + 1} - fetching updated game data...`);
        await new Promise(resolve => setTimeout(resolve, 300)); // Wait 300ms
        
        const { data: retryData, error: retryError } = await supabase
          .from('games')
          .select('*')
          .eq('id', gameId)
          .single();
        
        if (retryError) {
          console.error(`❌ Retry ${attempts + 1} failed:`, retryError);
        } else if (retryData) {
          updatedData = retryData;
          console.log(`📊 Retry ${attempts + 1} - status: ${retryData.status}`);
        }
        attempts++;
      }
      
      if (updatedData && updatedData.status === 'playing') {
        console.log(`✅ Game ${gameId} successfully started after ${attempts} attempts`);
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify(updatedData)
        };
      } else {
        console.error(`❌ Game ${gameId} failed to start after ${attempts} attempts. Final status: ${updatedData?.status}`);
      }
    }
    
    // Add lobby timer to response
    data.lobbyTimer = lobbyTimer;
  }
  
  // Calculate remaining time for current round
  if (data.status === 'playing' && data.current_round > 0) {
    // Use round_start_time if available, otherwise use a default timer
    let remaining = 10;
    
    if (data.round_start_time) {
      const roundStartTime = new Date(data.round_start_time);
      const elapsed = Math.floor((Date.now() - roundStartTime) / 1000);
      remaining = Math.max(0, 10 - elapsed);
    } else {
      // Fallback: use existing round_timer or default
      remaining = data.round_timer || 10;
    }
    
    data.round_timer = remaining;
    
    // Auto-process round if time is up and not all players have voted
    if (remaining === 0) {
      const realPlayers = data.players.filter(p => !p.isBot);
      const votedPlayers = realPlayers.filter(p => p.guess);
      
      if (votedPlayers.length < realPlayers.length) {
        // Force process round with current votes
        console.log(`⏰ Round ${data.current_round} time expired - processing with ${votedPlayers.length}/${realPlayers.length} votes`);
        setTimeout(() => processRound(gameId, data.players, data), 100);
      }
    }
  }
  
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

async function downloadResponses() {
  try {
    // Get all games with their player responses
    const { data: games, error } = await supabase
      .from('games')
      .select('*')
      .eq('status', 'completed')
      .order('completed_at', { ascending: false });
    
    if (error) throw error;
    
    // Flatten the data for CSV export
    const csvData = [];
    
    games.forEach(game => {
      if (game.players && game.products) {
        // Only process real players (not bots)
        const realPlayers = game.players.filter(player => !player.isBot);
        
        realPlayers.forEach(player => {
          // Get player's responses from game rounds
          if (player.responses) {
            player.responses.forEach((response, responseIndex) => {
              const roundIndex = response.round - 1; // Convert to 0-based index
              const product = game.products[roundIndex];
              const previousProduct = roundIndex > 0 ? game.products[roundIndex - 1] : null;
              
              csvData.push({
                game_id: game.id,
                player_id: player.id,
                player_name: player.name,
                panel_id: player.panelId || '',
                round: response.round,
                current_product: response.currentProduct,
                current_price: response.currentPrice,
                previous_product: response.previousProduct,
                previous_price: response.previousPrice,
                player_guess: response.guess,
                correct_answer: response.correct ? 'correct' : 'incorrect',
                actual_comparison: response.actualHigher ? 'higher' : 'lower',
                final_score: player.score || 0,
                game_completed_at: game.completed_at,
                response_time: response.responseTime || ''
              });
            });
          }
        });
      }
    });
    
    // Convert to CSV
    if (csvData.length === 0) {
      return {
        statusCode: 200,
        headers: {
          ...headers,
          'Content-Type': 'text/csv',
          'Content-Disposition': 'attachment; filename="price_right_responses_empty.csv"'
        },
        body: 'No data available'
      };
    }
    
    const csvHeaders = Object.keys(csvData[0]).join(',');
    const csvRows = csvData.map(row => 
      Object.values(row).map(value => 
        typeof value === 'string' && value.includes(',') ? `"${value}"` : value
      ).join(',')
    );
    
    const csvContent = [csvHeaders, ...csvRows].join('\n');
    
    return {
      statusCode: 200,
      headers: {
        ...headers,
        'Content-Type': 'text/csv',
        'Content-Disposition': 'attachment; filename="price_right_responses.csv"'
      },
      body: csvContent
    };
  } catch (error) {
    console.error('Error downloading responses:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Failed to download responses' })
    };
  }
}