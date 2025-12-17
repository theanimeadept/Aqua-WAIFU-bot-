require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const mongoose = require('mongoose');
const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const { saveAllData, saveBotData, saveWaifusData, saveUsersData } = require('./src/auto_save_data.js');
const { connectDB } = require('./src/db');
const User = require('./src/models/User');
const Waifu = require('./src/models/Waifu');
const Harem = require('./src/models/Harem');

// Import guess bot module
let guessBotModule = null;
try {
    guessBotModule = require('./src/guess_bot.js');
    console.log('✅ Guess bot module loaded');
} catch (error) {
    console.error('❌ Error loading guess bot module:', error.message);
}

// Try multiple token sources for compatibility
const token = process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN || process.env.BOT_TOKEN_1;
const channelId = process.env.CHANNEL_ID || process.env.DATABASE_CHANNEL_ID;
const uploadGroupId = process.env.UPLOAD_GROUP_ID || '-1002503593313';
const uploadNotificationGroup = '-1002503593313';
const OWNER_ID = parseInt(process.env.OWNER_ID || process.env.DEVELOPER_ID) || 6245574035;

if (!token) {
    console.error('Error: Bot token not found in environment variables');
    console.error('Please add one of these secrets in Replit:');
    console.error('- TELEGRAM_BOT_TOKEN');
    console.error('- BOT_TOKEN');
    console.error('- BOT_TOKEN_1');
    process.exit(1);
}

const bot = new TelegramBot(token, {
    polling: false  // Never use polling on Render - always use webhooks
});

connectDB();

const app = express();
const PORT = process.env.PORT || 5000;

// Webhook endpoint for Render deployment
app.post('/webhook', express.json(), (req, res) => {
    try {
        console.log('📨 Webhook received:', req.body);
        bot.processUpdate(req.body);
        res.sendStatus(200);
        console.log('✅ Webhook processed successfully');
    } catch (error) {
        console.error('❌ Webhook processing error:', error);
        res.sendStatus(500);
    }
});

// Set webhook on startup with retry logic
async function setupWebhook(retryCount = 0) {
    const maxRetries = 3;

    if (process.env.WEBHOOK_URL) {
        try {
            const webhookUrl = process.env.WEBHOOK_URL + '/webhook';
            console.log(`🔄 Setting webhook to: ${webhookUrl} (attempt ${retryCount + 1}/${maxRetries + 1})`);

            const result = await bot.setWebHook(webhookUrl, {
                max_connections: 100,
                allowed_updates: ["message", "callback_query", "inline_query"]
            });
            console.log('✅ Webhook setup result:', result);

            // Verify webhook is set
            const webhookInfo = await bot.getWebHookInfo();
            console.log('📋 Webhook info:', webhookInfo);

            if (webhookInfo.url === webhookUrl) {
                console.log('🎉 Webhook successfully configured!');
                return true;
            } else {
                console.error('⚠️ Webhook URL mismatch:', webhookInfo.url, 'vs expected:', webhookUrl);
                throw new Error('Webhook URL mismatch');
            }
        } catch (error) {
            console.error('❌ Webhook setup failed:', error.message);

            if (retryCount < maxRetries) {
                console.log(`🔄 Retrying webhook setup in ${5 * (retryCount + 1)} seconds...`);
                setTimeout(() => setupWebhook(retryCount + 1), 5000 * (retryCount + 1));
                return false;
            } else {
                console.error('❌ Max retries reached. Webhook mode only - no polling fallback to prevent duplicate messages.');
                return false;
            }
        }
    } else {
        console.log('⚠️ No WEBHOOK_URL provided, using polling mode for local development');
        try {
            // Delete any existing webhook first to prevent conflicts
            await bot.deleteWebHook();
            bot.startPolling({
                polling: {
                    interval: 300,
                    autoStart: true,
                    params: {
                        timeout: 10
                    }
                }
            });
            console.log('✅ Polling mode started successfully');
        } catch (pollError) {
            console.error('❌ Polling start failed:', pollError.message);
        }
        return true;
    }
}

app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Waifu Bot Status</title>
            <meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate">
            <meta http-equiv="Pragma" content="no-cache">
            <meta http-equiv="Expires" content="0">
            <style>
                body { font-family: Arial, sans-serif; max-width: 800px; margin: 50px auto; padding: 20px; }
                .status { background: #4CAF50; color: white; padding: 20px; border-radius: 10px; text-align: center; }
                .info { background: #f5f5f5; padding: 20px; margin-top: 20px; border-radius: 10px; }
                h1 { margin: 0; }
                p { margin: 10px 0; }
            </style>
        </head>
        <body>
            <div class="status">
                <h1>✅ Waifu Bot is Running!</h1>
                <p>Last checked: ${new Date().toLocaleString()}</p>
            </div>
            <div class="info">
                <h2>🤖 Bot Information</h2>
                <p><strong>Status:</strong> Online and Active</p>
                <p><strong>Platform:</strong> Telegram</p>
                <p><strong>Uptime:</strong> ${Math.floor(process.uptime())} seconds</p>
                <p><strong>Server:</strong> Replit</p>
            </div>
        </body>
        </html>
    `);
});

app.get('/health', async (req, res) => {
    try {
        res.setHeader('Cache-Control', 'no-cache');

        // Check database connection
        if (mongoose.connection.readyState !== 1) {
            throw new Error('Database not connected');
        }

        // Get webhook info
        let webhookInfo = null;
        try {
            webhookInfo = await bot.getWebHookInfo();
        } catch (e) {
            console.error('Webhook info error:', e.message);
        }

        res.json({
            status: 'online',
            uptime: process.uptime(),
            timestamp: new Date().toISOString(),
            database: 'connected',
            webhook: {
                url: webhookInfo?.url || null,
                pending_updates: webhookInfo?.pending_update_count || 0
            },
            environment: {
                node_env: process.env.NODE_ENV,
                use_webhook: process.env.USE_WEBHOOK,
                webhook_url: process.env.WEBHOOK_URL ? 'set' : 'not set',
                bot_token: process.env.TELEGRAM_BOT_TOKEN ? 'set' : 'not set'
            }
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Run initialization before server starts
setupWebhook().then(() => {
    console.log('✅ Main bot webhook setup complete');
    
    // Start guess bot after main bot is ready
    if (guessBotModule && guessBotModule.startGuessBotPolling) {
        return guessBotModule.startGuessBotPolling();
    }
    return true;
}).then(() => {
    console.log('✅ All bots initialized successfully');
}).catch((error) => {
    console.error('❌ Initialization error:', error);
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🌐 Web server running on port ${PORT}`);
    console.log(`✅ Bot is ready for deployment`);
    console.log(`🔗 Webhook endpoint: /webhook`);
}).on('error', (err) => {
    console.error('Server error:', err);
    if (err.code === 'EADDRINUSE') {
        console.error(`Port ${PORT} is already in use. Trying alternative port...`);
        app.listen(0, '0.0.0.0', () => {
            console.log(`🌐 Web server running on alternative port`);
        });
    }
});

bot.on('polling_error', (error) => {
    console.error('❌ Polling error:', error);
    if (error.code === 'ETELEGRAM') {
        console.error('🔄 Telegram API error - bot will attempt to reconnect');
    }
});

bot.on('webhook_error', (error) => {
    console.error('❌ Webhook error:', error);
    console.log('🔄 Attempting to reconfigure webhook...');

    // Wait a bit then try to reconfigure webhook
    setTimeout(() => {
        setupWebhook(0);
    }, 5000);
});

bot.on('error', (error) => {
    console.error('❌ Bot error:', error);
    if (error.code === 'ETELEGRAM') {
        console.log('🔄 Telegram API error detected, checking connection...');
    }
});

// Log incoming messages for debugging
bot.on('message', (msg) => {
    if (msg.from && msg.text) {
        console.log(`📨 Message from ${msg.from.first_name} (${msg.from.id}): ${msg.text}`);
    }
});

// ⚠️ CRITICAL ERROR HANDLERS - NEVER EXIT
process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ [UNHANDLED REJECTION]', reason?.message || reason);
    // DO NOT EXIT - keep running forever
});

process.on('uncaughtException', (error) => {
    console.error('❌ [UNCAUGHT EXCEPTION]', error?.message || error);
    // DO NOT EXIT - keep running forever
});

// Helper functions for MongoDB operations
async function ensureUser(userId, username, firstName) {
    try {
        let user = await User.findOne({ user_id: userId });
        if (!user) {
            user = new User({
                user_id: userId,
                username: username,
                first_name: firstName,
                berries: 1000, // Starting balance
                daily_streak: 0,
                weekly_streak: 0,
                favorite_waifu_id: null,
                joined_at: new Date()
            });
            await user.save();
            console.log(`✅ New user created: ${firstName} (${userId})`);
        }
        return user;
    } catch (error) {
        console.error('❌ Error ensuring user:', error);
        return null;
    }
}

async function checkBanned(userId) {
    try {
        // For now, no ban system - can be added later
        return false;
    } catch (error) {
        console.error('❌ Error checking ban status:', error);
        return false;
    }
}

async function checkUserAccess(msg) {
    // Basic access check - can be expanded
    return true;
}

// Bot Commands
bot.onText(/\/start/, async (msg) => {
    const userId = msg.from.id;
    
    if (await checkBanned(userId)) {
        return;
    }
    
    if (!await checkUserAccess(msg)) return;

    await ensureUser(userId, msg.from.username, msg.from.first_name);

    const botUsername = (await bot.getMe()).username;
    const mainMenuKeyboard = {
        inline_keyboard: [
            [
                { text: 'SUPPORT', url: 'https://t.me/+jhEIZcNrvtcxZjc1' },
                { text: 'HELP', callback_data: 'menu_help' }
            ],
            [{ text: 'ADD ME BABY 💖', url: `https://t.me/${botUsername}?startgroup=true` }],
            [
                { text: 'OFFICIALGC', url: 'https://t.me/+jhEIZcNrvtcxZjc1' },
                { text: 'CREDITS', callback_data: 'menu_credits' }
            ]
        ]
    };

    const welcomeText = `👋 ʜɪ, ᴍʏ ɴᴀᴍᴇ ɪs 𝗔𝗤𝗨𝗔 𝗪𝗔𝗜𝗙𝗨 𝗕𝗢𝗧, ᴀɴ ᴀɴɪᴍᴇ-ʙᴀsᴇᴅ ɢᴀᴍᴇs ʙᴏᴛ! ᴀᴅᴅ ᴍᴇ ᴛᴏ ʏᴏᴜʀ ɢʀᴏᴜᴘ ᴀɴᴅ ᴛʜᴇ ᴇxᴘᴇʀɪᴇɴᴄᴇ ɢᴇᴛs ᴇxᴘᴀɴᴅᴇᴅ. ʟᴇᴛ's ɪɴɪᴛɪᴀᴛᴇ ᴏᴜʀ ᴊᴏᴜʀɴᴇʏ ᴛᴏɢᴇᴛʜᴇʀ!

sᴜᴘᴘᴏʀᴛ              ᴏғғɪᴄɪᴀʟ ɢʀᴏᴜᴘ

ᴏᴡɴᴇʀ                 ғᴏᴜɴᴅᴇʀ



OWNER - 6245574035 & 8195158525
FOUNDER - 6245574035`;

    try {
        await bot.sendMessage(msg.chat.id, welcomeText, {
            reply_to_message_id: msg.message_id,
            reply_markup: mainMenuKeyboard,
            parse_mode: 'HTML'
        });
    } catch (error) {
        console.error('❌ Error sending start message:', error);
        // Fallback without markup
        await bot.sendMessage(msg.chat.id, welcomeText, {
            reply_to_message_id: msg.message_id,
            parse_mode: 'HTML'
        });
    }
});

bot.onText(/\/bal/, async (msg) => {
    const userId = msg.from.id;
    
    if (await checkBanned(userId)) return;
    if (!await checkUserAccess(msg)) return;

    try {
        const user = await User.findOne({ user_id: userId });
        if (!user) {
            await ensureUser(userId, msg.from.username, msg.from.first_name);
            return bot.sendMessage(msg.chat.id, '❌ User not found. Please use /start first.');
        }

        const haremCount = await Harem.countDocuments({ user_id: userId });
        
        const balanceText = `💰 <b>Your Balance</b>\n\n` +
            `👤 <b>User:</b> ${user.first_name}\n` +
            `💸 <b>Berries:</b> ${user.berries.toLocaleString()}\n` +
            `👰 <b>Waifus:</b> ${haremCount}\n` +
            `🔥 <b>Daily Streak:</b> ${user.daily_streak}\n` +
            `📅 <b>Weekly Streak:</b> ${user.weekly_streak}`;

        await bot.sendMessage(msg.chat.id, balanceText, {
            reply_to_message_id: msg.message_id,
            parse_mode: 'HTML'
        });
    } catch (error) {
        console.error('❌ Error getting balance:', error);
        await bot.sendMessage(msg.chat.id, '❌ Error retrieving balance. Please try again.');
    }
});

bot.onText(/\/dwaifu/, async (msg) => {
    const userId = msg.from.id;
    
    if (await checkBanned(userId)) return;
    if (!await checkUserAccess(msg)) return;

    try {
        const user = await User.findOne({ user_id: userId });
        if (!user) {
            return bot.sendMessage(msg.chat.id, '❌ Please use /start first to register.');
        }

        // Check if user already claimed today
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        if (user.last_daily_claim && user.last_daily_claim >= today) {
            const nextClaim = new Date(today);
            nextClaim.setDate(nextClaim.getDate() + 1);
            const timeLeft = nextClaim - new Date();
            const hoursLeft = Math.floor(timeLeft / (1000 * 60 * 60));
            const minutesLeft = Math.floor((timeLeft % (1000 * 60 * 60)) / (1000 * 60));
            
            return bot.sendMessage(msg.chat.id, 
                `⏰ <b>Daily Waifu Already Claimed!</b>\n\n` +
                `You can claim again in: <b>${hoursLeft}h ${minutesLeft}m</b>`, {
                parse_mode: 'HTML'
            });
        }

        // Get random waifu
        const waifuCount = await Waifu.countDocuments();
        if (waifuCount === 0) {
            return bot.sendMessage(msg.chat.id, '❌ No waifus available. Please contact admin.');
        }

        const randomIndex = Math.floor(Math.random() * waifuCount);
        const waifu = await Waifu.findOne().skip(randomIndex);
        
        if (!waifu) {
            return bot.sendMessage(msg.chat.id, '❌ Error getting waifu. Please try again.');
        }

        // Check if user already has this waifu
        const existingHarem = await Harem.findOne({ user_id: userId, waifu_id: waifu.waifu_id });
        
        let reward = 50; // Base reward
        let message = '';

        if (existingHarem) {
            // Duplicate - give berries
            reward = Math.floor(Math.random() * 51) + 25; // 25-75 berries
            message = `💝 <b>Duplicate Waifu!</b>\n\n` +
                `You already have <b>${waifu.name}</b>!\n\n` +
                `💸 <b>Reward:</b> ${reward} berries\n` +
                `💰 <b>New Balance:</b> ${user.berries + reward}`;
        } else {
            // New waifu - add to harem
            const newHarem = new Harem({
                user_id: userId,
                waifu_id: waifu.waifu_id,
                obtained_at: new Date()
            });
            await newHarem.save();
            
            message = `🎉 <b>New Waifu Obtained!</b>\n\n` +
                `👰 <b>${waifu.name}</b>\n` +
                `📊 <b>Rarity:</b> ${waifu.rarity}\n` +
                `🎭 <b>Anime:</b> ${waifu.anime}\n\n` +
                `💸 <b>Bonus:</b> ${reward} berries\n` +
                `💰 <b>New Balance:</b> ${user.berries + reward}`;
        }

        // Update user
        user.berries += reward;
        user.last_daily_claim = new Date();
        user.daily_streak += 1;
        await user.save();

        // Send waifu image if available
        if (waifu.image_url) {
            try {
                await bot.sendPhoto(msg.chat.id, waifu.image_url, {
                    caption: message,
                    reply_to_message_id: msg.message_id,
                    parse_mode: 'HTML'
                });
            } catch (imageError) {
                console.error('❌ Error sending waifu image:', imageError);
                await bot.sendMessage(msg.chat.id, message, {
                    reply_to_message_id: msg.message_id,
                    parse_mode: 'HTML'
                });
            }
        } else {
            await bot.sendMessage(msg.chat.id, message, {
                reply_to_message_id: msg.message_id,
                parse_mode: 'HTML'
            });
        }

    } catch (error) {
        console.error('❌ Error claiming daily waifu:', error);
        await bot.sendMessage(msg.chat.id, '❌ Error claiming daily waifu. Please try again.');
    }
});

// Add more commands as needed...

console.log('✅ Bot commands loaded successfully');
console.log('🚀 Aqua Waifu Bot is fully operational!');
