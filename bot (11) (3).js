require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const { Pool } = require('pg');
const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const { saveAllData, saveBotData, saveWaifusData, saveUsersData } = require('./auto_save_data.js');

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
    polling: {
        interval: 3000,      // Check every 3 seconds (instead of 300ms)
        autoStart: true,
        params: { 
            timeout: 60      // Longer timeout to avoid crashes
        }
    }
});
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const app = express();
const PORT = process.env.PORT || 3000;

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

app.get('/health', (req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.json({ 
        status: 'online', 
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
    });
});

// CRITICAL: Clear spawn_tracker on bot startup to prevent race conditions
async function initializeSpawnTracker() {
    try {
        // Create redeem_codes table if not exists
        await pool.query(`
            CREATE TABLE IF NOT EXISTS redeem_codes (
                code TEXT PRIMARY KEY,
                code_type TEXT NOT NULL,
                amount BIGINT,
                waifu_id INT,
                max_uses INT DEFAULT 1,
                uses INT DEFAULT 0,
                created_at TIMESTAMP DEFAULT NOW()
            )
        `);
        console.log('✅ Redeem codes table ready');
        
        await pool.query('DELETE FROM spawn_tracker WHERE message_count >= 100 OR active_spawn_waifu_id IS NOT NULL');
        console.log('✅ Spawn tracker cleared on startup');
    } catch (error) {
        console.error('Error initializing spawn tracker:', error);
    }
}

// Run initialization before server starts
initializeSpawnTracker();

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🌐 Web server running on port ${PORT}`);
    console.log(`✅ Bot is ready for deployment`);
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
    console.error('Polling error:', error);
    if (error.code === 'ETELEGRAM') {
        console.error('Telegram API error - bot will attempt to reconnect');
    }
});

bot.on('error', (error) => {
    console.error('Bot error:', error);
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

// ADDITIONAL SAFETY: catch pool errors
pool.on('error', (err, client) => {
    console.error('❌ [POOL ERROR]', err.message);
    // Keep running
});

const USER_DATA_DIR = './users';

const BACKUP_DIR = './backups';

async function ensureBackupDir() {
    try {
        await fs.mkdir(BACKUP_DIR, { recursive: true });
    } catch (error) {
        console.error('Error creating backup directory:', error);
    }
}

ensureBackupDir();

async function backupAllData() {
    try {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

        const users = await pool.query('SELECT * FROM users');
        const waifus = await pool.query('SELECT * FROM waifus');
        const harem = await pool.query('SELECT * FROM harem');
        const roles = await pool.query('SELECT * FROM roles');

        const backupData = {
            timestamp: new Date().toISOString(),
            users: users.rows,
            waifus: waifus.rows,
            harem: harem.rows,
            roles: roles.rows
        };

        const backupPath = path.join(BACKUP_DIR, `backup_${timestamp}.json`);
        await fs.writeFile(backupPath, JSON.stringify(backupData, null, 2));

        console.log(`✅ Backup saved: ${backupPath}`);
    } catch (error) {
        console.error('Error creating backup:', error);
    }
}

setInterval(backupAllData, 6 * 60 * 60 * 1000);
backupAllData();

// Auto-save all data files every 10 minutes
setInterval(() => {
    console.log('🔄 Running auto-save...');
    saveAllData().catch(err => {
        console.error('❌ Auto-save error:', err);
    });
}, 10 * 60 * 1000);

// Initial save on startup (with delay to ensure DB is ready)
setTimeout(() => {
    console.log('🔄 Initial data save starting...');
    saveAllData().catch(err => {
        console.error('❌ Initial save error:', err);
    });
}, 5000);

console.log('✅ Auto-save system initialized - Data will be saved every 10 minutes');
console.log('✅ Backup system initialized - Backups will be created every 6 hours');

const RARITY_NAMES = {
    1: 'Common ⚪',
    2: 'Rare 🟢',
    3: 'Normal 🟣',
    4: 'Legendary 🟡',
    5: 'Summer 🏖',
    6: 'Winter ❄️',
    7: 'Valentine 💕',
    8: 'Manga ✨',
    9: 'Unique 👑',
    10: 'Neon 💫',
    11: 'Celestial 🪽',
    12: 'Mythical 🪭',
    13: 'Special 🫧',
    14: 'Masterpiece 💸',
    15: 'Limited 🔮',
    16: 'AMV 🎥'
};

const bazaarMessageTimers = new Map();

const RARITY_PRICES = {
    1: 20000,    // Common ⚪
    2: 20000,    // Rare 🟢
    3: 40000,    // Normal 🟣
    4: 50000,    // Legendary 🟡
    5: 400000,   // Summer 🏖
    6: 600000,   // Winter ❄️
    7: 300000,   // Valentine 💕
    8: 20000,    // Manga ✨
    9: 400000,   // Unique 👑
    10: 700000,  // Neon 💫
    11: 800000,  // Celestial 🪽
    12: 900000,  // Mythical 🪭
    13: 1000000, // Special 🫧
    14: 1200000, // Masterpiece 💸
    15: 1300000, // Limited 🔮
    16: 1400000  // AMV 🎥
};

const userCommandCount = new Map();
const SPAM_THRESHOLD = 10;
const SPAM_WINDOW = 10000;
const SPAM_BLOCK_DURATION = 20 * 60 * 1000;

async function ensureUserDataDir() {
    try {
        await fs.mkdir(USER_DATA_DIR, { recursive: true });
    } catch (error) {
        console.error('Error creating user data directory:', error);
    }
}

ensureUserDataDir();

async function saveUserDataToFile(userId) {
    try {
        const user = await pool.query('SELECT * FROM users WHERE user_id = $1', [userId]);
        if (user.rows.length === 0) return;

        const harem = await pool.query('SELECT waifu_id FROM harem WHERE user_id = $1', [userId]);

        const userData = {
            user_id: userId,
            username: user.rows[0].username,
            first_name: user.rows[0].first_name,
            berries: user.rows[0].berries,
            daily_streak: user.rows[0].daily_streak,
            weekly_streak: user.rows[0].weekly_streak,
            favorite_waifu_id: user.rows[0].favorite_waifu_id,
            waifus: harem.rows.map(h => h.waifu_id),
            last_updated: new Date().toISOString()
        };

        const filePath = path.join(USER_DATA_DIR, `${userId}.json`);
        await fs.writeFile(filePath, JSON.stringify(userData, null, 2));
        
        // Auto-save all users data periodically
        saveUsersData().catch(console.error);
    } catch (error) {
        console.error('Error saving user data to file:', error);
    }
}

async function checkMonthlyReset() {
    try {
        const now = new Date();
        if (now.getDate() === 1) {
            const lastReset = await pool.query('SELECT value FROM bot_settings WHERE key = $1', ['last_monthly_reset']);
            const lastResetMonth = lastReset.rows.length > 0 ? new Date(lastReset.rows[0].value).getMonth() : -1;

            if (lastResetMonth !== now.getMonth()) {
                await pool.query('UPDATE users SET daily_streak = 0, weekly_streak = 0');
                await pool.query(
                    'INSERT INTO bot_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2',
                    ['last_monthly_reset', now.toISOString()]
                );
                console.log('✅ Monthly streak reset completed');
            }
        }
    } catch (error) {
        console.error('Error in monthly reset:', error);
    }
}

setInterval(checkMonthlyReset, 60 * 60 * 1000);
checkMonthlyReset();

async function ensureUser(userId, username, firstName) {
    // Ensure gems column exists
    await pool.query(`
        DO $$ BEGIN
            IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='gems') THEN
                ALTER TABLE users ADD COLUMN gems INT DEFAULT 0;
            END IF;
        END $$;
    `).catch(() => {});
    
    const result = await pool.query(
        'INSERT INTO users (user_id, username, first_name) VALUES ($1, $2, $3) ON CONFLICT (user_id) DO UPDATE SET username = $2, first_name = $3 RETURNING *',
        [userId, username, firstName]
    );
    await saveUserDataToFile(userId);
    return result.rows[0];
}

async function checkBanned(userId) {
    const result = await pool.query('SELECT * FROM banned_users WHERE user_id = $1', [userId]);
    return result.rows.length > 0;
}

async function checkSpamBlock(userId) {
    const result = await pool.query('SELECT * FROM spam_blocks WHERE user_id = $1 AND blocked_until > NOW()', [userId]);
    if (result.rows.length > 0) {
        return result.rows[0].blocked_until;
    }

    await pool.query('DELETE FROM spam_blocks WHERE user_id = $1 AND blocked_until <= NOW()', [userId]);
    return null;
}

async function trackSpam(userId) {
    try {
        const now = Date.now();
        const userData = userCommandCount.get(userId) || { count: 0, resetTime: now };

        if (now - userData.resetTime > SPAM_WINDOW) {
            userData.count = 1;
            userData.resetTime = now;
        } else {
            userData.count++;
        }

        userCommandCount.set(userId, userData);

        if (userData.count > SPAM_THRESHOLD) {
            const blockUntil = new Date(now + SPAM_BLOCK_DURATION);
            try {
                await pool.query(
                    'INSERT INTO spam_blocks (user_id, blocked_until, spam_count) VALUES ($1, $2, 1) ON CONFLICT (user_id) DO UPDATE SET blocked_until = $2, spam_count = spam_blocks.spam_count + 1',
                    [userId, blockUntil]
                );
            } catch (dbErr) {
                // If constraint fails, try simple insert
                try {
                    await pool.query('DELETE FROM spam_blocks WHERE user_id = $1', [userId]);
                    await pool.query('INSERT INTO spam_blocks (user_id, blocked_until, spam_count) VALUES ($1, $2, 1)', [userId, blockUntil]);
                } catch (e) {
                    console.error('[trackSpam] DB error (non-fatal):', e.message);
                }
            }
            userCommandCount.delete(userId);
            return blockUntil;
        }

        return null;
    } catch (error) {
        console.error('[trackSpam] Unexpected error:', error.message);
        return null;
    }
}

async function hasRole(userId, role) {
    const result = await pool.query('SELECT * FROM roles WHERE user_id = $1 AND role_type = $2', [userId, role]);
    return result.rows.length > 0;
}

async function checkCooldown(userId, command, cooldownSeconds) {
    try {
        const result = await pool.query('SELECT last_used FROM cooldowns WHERE user_id = $1 AND command = $2', [userId, command]);
        if (result.rows.length > 0) {
            const lastUsed = new Date(result.rows[0].last_used);
            const now = new Date();
            const diff = (now - lastUsed) / 1000;
            if (diff < cooldownSeconds) {
                return Math.ceil(cooldownSeconds - diff);
            }
        }
        
        try {
            await pool.query(
                'INSERT INTO cooldowns (user_id, command, last_used) VALUES ($1, $2, NOW()) ON CONFLICT (user_id, command) DO UPDATE SET last_used = NOW()',
                [userId, command]
            );
        } catch (dbErr) {
            // If constraint fails, try upsert alternative
            try {
                await pool.query('DELETE FROM cooldowns WHERE user_id = $1 AND command = $2', [userId, command]);
                await pool.query('INSERT INTO cooldowns (user_id, command, last_used) VALUES ($1, $2, NOW())', [userId, command]);
            } catch (e) {
                console.error('[checkCooldown] DB error (non-fatal):', e.message);
            }
        }
        return 0;
    } catch (error) {
        console.error('[checkCooldown] Unexpected error:', error.message);
        return 0;
    }
}

async function getRandomWaifu(rarityRange = [1, 13], excludeRarities = []) {
    let query = 'SELECT * FROM waifus WHERE rarity BETWEEN $1 AND $2 AND is_locked = FALSE';
    let params = rarityRange;

    if (excludeRarities.length > 0) {
        query += ' AND rarity NOT IN (' + excludeRarities.join(',') + ')';
    }

    query += ' ORDER BY RANDOM() LIMIT 1';

    const result = await pool.query(query, params);
    return result.rows[0];
}

async function sendReply(chatId, messageId, text, options = {}) {
    return bot.sendMessage(chatId, text, {
        reply_to_message_id: messageId,
        parse_mode: 'HTML',
        ...options
    });
}

async function sendPhotoReply(chatId, messageId, photo, caption, options = {}) {
    return bot.sendPhoto(chatId, photo, {
        reply_to_message_id: messageId,
        caption,
        parse_mode: 'HTML',
        ...options
    });
}

async function checkUserAccess(msg) {
    if (!msg.from || msg.from.is_bot) return false;

    const userId = msg.from.id;

    // Check if user is banned - this blocks ALL bot usage
    if (await checkBanned(userId)) {
        // Don't even respond to banned users
        return false;
    }

    // Owner and developers are EXEMPT from spam checks
    if (userId === OWNER_ID || await hasRole(userId, 'dev')) {
        return true;
    }

    const spamBlock = await checkSpamBlock(userId);
    if (spamBlock) {
        const minutes = Math.ceil((new Date(spamBlock) - new Date()) / 60000);
        await sendReply(msg.chat.id, msg.message_id, `⏱️ You're blocked for spamming. Wait ${minutes} more minutes.`);
        return false;
    }

    const spamTriggered = await trackSpam(userId);
    if (spamTriggered) {
        await sendReply(msg.chat.id, msg.message_id, '🚫 Spam detected! You are blocked for 20 minutes.');
        return false;
    }

    return true;
}

async function getTargetUser(msg, args) {
    let targetId = null;
    let targetName = null;

    if (msg.reply_to_message) {
        targetId = msg.reply_to_message.from.id;
        targetName = msg.reply_to_message.from.first_name;
    } else if (args.length > 0) {
        if (args[0].startsWith('@')) {
            const username = args[0].substring(1);
            const result = await pool.query('SELECT user_id, first_name FROM users WHERE username = $1', [username]);
            if (result.rows.length > 0) {
                targetId = result.rows[0].user_id;
                targetName = result.rows[0].first_name;
            }
        } else {
            targetId = parseInt(args[0]);
            const result = await pool.query('SELECT first_name FROM users WHERE user_id = $1', [targetId]);
            if (result.rows.length > 0) {
                targetName = result.rows[0].first_name;
            }
        }
    }

    return { targetId, targetName };
}

bot.onText(/\/start/, async (msg) => {
    const userId = msg.from.id;
    
    // Block banned users completely
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
        // Get random media from start_media table
        const mediaResult = await pool.query('SELECT * FROM start_media ORDER BY RANDOM() LIMIT 1');
        
        if (mediaResult.rows.length > 0) {
            const media = mediaResult.rows[0];
            if (media.media_type === 'video') {
                await bot.sendVideo(msg.chat.id, media.file_id, {
                    caption: welcomeText,
                    reply_to_message_id: msg.message_id,
                    reply_markup: mainMenuKeyboard,
                    parse_mode: 'HTML'
                });
            } else {
                await bot.sendPhoto(msg.chat.id, media.file_id, {
                    caption: welcomeText,
                    reply_to_message_id: msg.message_id,
                    reply_markup: mainMenuKeyboard,
                    parse_mode: 'HTML'
                });
            }
        } else {
            // Fallback to default video
            await bot.sendVideo(msg.chat.id, 'https://screenapp.io/app/v/JVe_oriUTy', {
                caption: welcomeText,
                reply_to_message_id: msg.message_id,
                reply_markup: mainMenuKeyboard,
                parse_mode: 'HTML'
            });
        }
    } catch (error) {
        await sendReply(msg.chat.id, msg.message_id, welcomeText, { reply_markup: mainMenuKeyboard });
    }
});

bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;
    const data = query.data;

    try {
        // Skip if data is already handled by other handlers
        if (data.startsWith('bazaar_') || data.startsWith('harem_') || 
            data.startsWith('cmode_') || data.startsWith('rfind_') || 
            data.startsWith('find_') || data === 'delete_message' || 
            data.startsWith('show_char_') || data.startsWith('reset_cash_')) {
            return;
        }

        if (data === 'menu_credits') {
            const creditsText = `ʙᴏᴛ ᴄʀᴇᴅɪᴛs\n\nᴜsᴇʀs ʙᴇʟᴏᴡ ᴀʀᴇ ᴛʜᴇ ᴅᴇᴠᴇʟᴏᴘᴇʀs, ᴜᴘʟᴏᴀᴅᴇʀs, ᴇᴛᴄ... ᴏғ ᴛʜɪs ʙᴏᴛ, ʏᴏᴜ ᴄᴀɴ ᴘᴇʀsᴏɴᴀʟʟʏ ᴄᴏɴᴛᴀᴄᴛ ᴛʜᴇᴍ ғᴏʀ ɪssᴜᴇs, ᴅᴏ ɴᴏᴛ ᴅᴍ ᴜɴɴᴇᴄᴇssᴀʀɪʟʏ.\n\nᴛʜᴀɴᴋ ʏᴏᴜ!`;
            const creditsKeyboard = {
                inline_keyboard: [
                    [{ text: 'DEVELOPER', callback_data: 'credits_developers' }, { text: 'SUDOS', callback_data: 'credits_sudos' }],
                    [{ text: 'UPLOADERS', callback_data: 'credits_uploaders' }, { text: 'BACK', callback_data: 'menu_credits' }]
                ]
            };
            await bot.editMessageText(creditsText, {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'HTML',
                reply_markup: creditsKeyboard
            });
        } else if (data === 'credits_uploaders') {
            const uploaders = await pool.query("SELECT DISTINCT u.user_id, u.username, u.first_name FROM users u JOIN roles r ON u.user_id = r.user_id WHERE r.role_type = 'uploader'");
            let text = '👤 <b>Uploaders</b>\n\n';

            if (uploaders.rows.length === 0) {
                text += 'No uploaders found.';
            } else {
                uploaders.rows.forEach(u => {
                    const name = u.username ? `@${u.username}` : u.first_name;
                    text += `• ${name} (ID: ${u.user_id})\n`;
                });
            }

            const keyboard = {
                inline_keyboard: [[{ text: '« BACK', callback_data: 'menu_credits' }]]
            };

            await bot.editMessageText(text, {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'HTML',
                reply_markup: keyboard
            });
        } else if (data === 'credits_developers') {
            const devs = await pool.query("SELECT DISTINCT u.user_id, u.username, u.first_name FROM users u JOIN roles r ON u.user_id = r.user_id WHERE r.role_type = 'dev' ORDER BY u.user_id");

            let text = '💻 <b>Developers</b>\n\n';
            const keyboard = { inline_keyboard: [] };

            if (devs.rows.length === 0) {
                text += 'No developers found.';
            } else {
                devs.rows.forEach(u => {
                    const name = u.username ? `@${u.username}` : u.first_name;
                    text += `• ${name}\n`;
                    keyboard.inline_keyboard.push([
                        { text: `${name}`, callback_data: `dev_info_${u.user_id}` }
                    ]);
                });
            }

            keyboard.inline_keyboard.push([{ text: '« BACK', callback_data: 'menu_credits' }]);

            await bot.editMessageText(text, {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'HTML',
                reply_markup: keyboard
            });
        } else if (data === 'credits_sudos') {
            const sudos = await pool.query("SELECT DISTINCT u.user_id, u.username, u.first_name FROM users u JOIN roles r ON u.user_id = r.user_id WHERE r.role_type = 'sudo' ORDER BY u.user_id");

            let text = '⚡ <b>Sudo Users</b>\n\n';
            const keyboard = { inline_keyboard: [] };

            if (sudos.rows.length === 0) {
                text += 'No sudo users found.';
            } else {
                sudos.rows.forEach(u => {
                    const name = u.username ? `@${u.username}` : u.first_name;
                    text += `• ${name}\n`;
                    keyboard.inline_keyboard.push([
                        { text: `${name}`, callback_data: `sudo_info_${u.user_id}` }
                    ]);
                });
            }

            keyboard.inline_keyboard.push([{ text: '« BACK', callback_data: 'menu_credits' }]);

            await bot.editMessageText(text, {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'HTML',
                reply_markup: keyboard
            });
        } else if (data.startsWith('dev_info_') || data.startsWith('sudo_info_')) {
            const userId = parseInt(data.split('_')[2]);
            const user = await pool.query('SELECT user_id, username, first_name FROM users WHERE user_id = $1', [userId]);

            if (user.rows.length > 0) {
                const u = user.rows[0];
                const name = u.username ? `@${u.username}` : u.first_name;
                const roleType = data.startsWith('dev_info_') ? 'Developer' : 'Sudo User';

                let text = `👤 <b>${roleType}</b>\n\n`;
                text += `Name: ${name}\n`;
                text += `ID: <code>${u.user_id}</code>`;

                const keyboard = {
                    inline_keyboard: [
                        [{ text: '💬 Send DM', url: `tg://user?id=${u.user_id}` }],
                        [{ text: '« BACK', callback_data: data.startsWith('dev_info_') ? 'credits_developers' : 'credits_sudos' }]
                    ]
                };

                await bot.editMessageText(text, {
                    chat_id: chatId,
                    message_id: messageId,
                    parse_mode: 'HTML',
                    reply_markup: keyboard
                });
            }
        } else if (data === 'menu_help') {
            const keyboard = {
                inline_keyboard: [
                    [{ text: 'BASIC', callback_data: 'help_basic' }, { text: 'INTERACTIVE', callback_data: 'help_interactive' }],
                    [{ text: '« BACK', callback_data: 'menu_main' }]
                ]
            };
            const helpText = `<b>📖 HELP & COMMANDS</b>\n\n<b>BASIC</b> - Essential commands for beginners\n<b>INTERACTIVE</b> - Advanced gameplay commands\n\nChoose one to explore!`;
            await bot.editMessageText(helpText, {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'HTML',
                reply_markup: keyboard
            });
        } else if (data === 'help_basic') {
            const keyboard = {
                inline_keyboard: [
                    [{ text: 'NEXT PAGE ➡️', callback_data: 'help_basic_2' }],
                    [{ text: '« BACK', callback_data: 'menu_help' }]
                ]
            };
            const helpText = `<b>𝗕𝗔𝗦𝗜𝗖 𝗖𝗢𝗠𝗠𝗔𝗡𝗗𝗦 𝟭/𝟮</b>\n\n<b>/Start</b> - 𝗦𝗧𝗔𝗥𝗧 𝗧𝗛𝗘 𝗕𝗢𝗧\n\n<b>/Grab</b> - 𝗚𝗥𝗔𝗕 𝗧𝗛𝗘 𝗖𝗛𝗔𝗥𝗔𝗖𝗧𝗘𝗥\n\n<b>/Fav</b> - 𝗔𝗗𝗗 𝗔 𝗖𝗛𝗔𝗥𝗔𝗖𝗧𝗘𝗥 𝗧𝗢 𝗬𝗢𝗨𝗥 𝗙𝗔𝗩\n\n<b>/Dwaifu</b> - 𝗖𝗟𝗔𝗜𝗠 𝗬𝗢𝗨𝗥 𝗗𝗔𝗜𝗟𝗬 𝗪𝗔𝗜𝗙𝗨\n\n<b>/Pay</b> - 𝗚𝗜𝗩𝗘 ɢᴇᴍs 💠 𝗧𝗢 𝗢𝗧𝗛𝗘𝗥 𝗨𝗦𝗘𝗥𝗦\n\n<b>/Bal</b> - 𝗦𝗘𝗘 𝗬𝗢𝗨𝗥 𝗕𝗔𝗟𝗔𝗡𝗖𝗘`;
            await bot.editMessageText(helpText, {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'HTML',
                reply_markup: keyboard
            });
        } else if (data === 'help_basic_2') {
            const keyboard = {
                inline_keyboard: [
                    [{ text: '⬅️ PREVIOUS', callback_data: 'help_basic' }],
                    [{ text: '« BACK', callback_data: 'menu_help' }]
                ]
            };
            const helpText = `<b>𝗕𝗔𝗦𝗜𝗖 𝗖𝗢𝗠𝗠𝗔𝗡𝗗𝗦 𝟮/𝟮</b>\n\n<b>/Harem</b> - 𝗩𝗜𝗘𝗪 𝗬𝗢𝗨𝗥 𝗖𝗢𝗟𝗟𝗘𝗖𝗧𝗜𝗢𝗡\n\n<b>/Profile</b> - 𝗖𝗛𝗘𝗖𝗞 𝗬𝗢𝗨𝗥 𝗣𝗥𝗢𝗙𝗜𝗟𝗘\n\n<b>/Help</b> - 𝗩𝗜𝗘𝗪 𝗔𝗟𝗟 𝗖𝗢𝗠𝗠𝗔𝗡𝗗𝗦\n\n<b>/Top</b> - 𝗦𝗘𝗘 𝗟𝗘𝗔𝗗𝗘𝗥𝗕𝗢𝗔𝗥𝗗𝗦\n\n<b>/Daily</b> - 𝗖𝗟𝗔𝗜𝗠 𝗗𝗔𝗜𝗟𝗬 𝗥𝗘𝗪𝗔𝗥𝗗\n\n<b>/Weekly</b> - 𝗖𝗟𝗔𝗜𝗠 𝗪𝗘𝗘𝗞𝗟𝗬 𝗥𝗘𝗪𝗔𝗥𝗗`;
            await bot.editMessageText(helpText, {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'HTML',
                reply_markup: keyboard
            });
        } else if (data === 'help_interactive') {
            const keyboard = {
                inline_keyboard: [
                    [{ text: 'NEXT PAGE ➡️', callback_data: 'help_interactive_2' }],
                    [{ text: '« BACK', callback_data: 'menu_help' }]
                ]
            };
            const helpText = `<b>𝗜𝗡𝗧𝗘𝗥𝗔𝗖𝗧𝗜𝗩𝗘 𝗖𝗢𝗠𝗠𝗔𝗡𝗗𝗦 𝟭/𝟯</b>\n\n<b>/Bazaar</b> - 𝗩𝗜𝗘𝗪 𝗗𝗔𝗜𝗟𝗬 𝗟𝗜𝗠𝗜𝗧𝗘𝗗/𝗔𝗨𝗖𝗧𝗜𝗢𝗡𝗦/𝗠𝗔𝗥𝗞𝗘𝗧𝗣𝗟𝗔𝗖𝗘\n\n<b>/Cmode</b> - 𝗖𝗛𝗔𝗡𝗚𝗘 𝗬𝗢𝗨𝗥 𝗛𝗔𝗥𝗘𝗠 𝗠𝗢𝗗𝗘\n\n<b>/Marry</b> - 𝗠𝗔𝗥𝗥𝗬 𝗔 𝗖𝗛𝗔𝗥𝗔𝗖𝗧𝗘𝗥\n\n<b>/Propose</b> - 𝗣𝗥𝗢𝗣𝗢𝗦𝗘 𝗧𝗢 𝗔 𝗖𝗛𝗔𝗥𝗔𝗖𝗧𝗘𝗥 [𝗜𝗧 𝗪𝗜𝗟𝗟 𝗗𝗘𝗗𝗨𝗖𝗧 𝗬𝗢𝗨𝗥 𝟮𝟬𝗞 ɢᴇᴍs 💠]\n\n<b>/Explore</b> - 𝗚𝗘𝗧 𝗦𝗢𝗠𝗘 ɢᴇᴍs 💠`;
            await bot.editMessageText(helpText, {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'HTML',
                reply_markup: keyboard
            });
        } else if (data === 'help_interactive_2') {
            const keyboard = {
                inline_keyboard: [
                    [{ text: '⬅️ PREVIOUS', callback_data: 'help_interactive' }, { text: 'NEXT PAGE ➡️', callback_data: 'help_interactive_3' }],
                    [{ text: '« BACK', callback_data: 'menu_help' }]
                ]
            };
            const helpText = `<b>𝗜𝗡𝗧𝗘𝗥𝗔𝗖𝗧𝗜𝗩𝗘 𝗖𝗢𝗠𝗠𝗔𝗡𝗗𝗦 𝟮/𝟯</b>\n\n<b>/Dart</b> - 𝗕𝗘𝗧 𝗬𝗢𝗨𝗥 ɢᴇᴍs 💠 𝗜𝗡 𝗗𝗔𝗥𝗧 𝗚𝗔𝗠𝗘\n\n<b>/Trade</b> - 𝗧𝗥𝗔𝗗𝗘 𝗪𝗔𝗜𝗙𝗨𝗦\n\n<b>/Sell</b> - 𝗦𝗘𝗟𝗟 𝗔 𝗪𝗔𝗜𝗙𝗨\n\n<b>/Gift</b> - 𝗚𝗜𝗙𝗧 𝗔 𝗪𝗔𝗜𝗙𝗨\n\n<b>/Find</b> - 𝗙𝗜𝗡𝗗 𝗪𝗔𝗜𝗙𝗨𝗦`;
            await bot.editMessageText(helpText, {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'HTML',
                reply_markup: keyboard
            });
        } else if (data === 'help_interactive_3') {
            const keyboard = {
                inline_keyboard: [
                    [{ text: '⬅️ PREVIOUS', callback_data: 'help_interactive_2' }],
                    [{ text: '« BACK', callback_data: 'menu_help' }]
                ]
            };
            const helpText = `<b>𝗜𝗡𝗧𝗘𝗥𝗔𝗖𝗧𝗜𝗩𝗘 𝗖𝗢𝗠𝗠𝗔𝗡𝗗𝗦 𝟯/𝟯</b>\n\n<b>/D</b> - 𝗩𝗜𝗘𝗪 𝗖𝗛𝗔𝗥𝗔𝗖𝗧𝗘𝗥 𝗜𝗡𝗙𝗢\n\n<b>/Rfind</b> - 𝗙𝗜𝗡𝗗 𝗕𝗬 𝗥𝗔𝗥𝗜𝗧𝗬\n\n<b>/Dprofile</b> - 𝗩𝗜𝗘𝗪 𝗗𝗘𝗧𝗔𝗜𝗟𝗘𝗗 𝗣𝗥𝗢𝗙𝗜𝗟𝗘\n\n<i>💡 Use commands in groups for maximum fun!</i>`;
            await bot.editMessageText(helpText, {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'HTML',
                reply_markup: keyboard
            });
        } else if (data === 'menu_main') {
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
            const welcomeText = `👋 ʜɪ, ᴍʏ ɴᴀᴍᴇ ɪs 𝗔𝗾𝘂𝗮 𝗪𝗮𝗶𝗳𝘂 𝗯𝗼𝘁, ᴀɴ ᴀɴɪᴍᴇ-ʙᴀsᴇᴅ ɢᴀᴍᴇs ʙᴏᴛ! ᴀᴅᴅ ᴍᴇ ᴛᴏ ʏᴏᴜʀ ɢʀᴏᴜᴘ ᴀɴᴅ ᴛʜᴇ ᴇxᴘᴇʀɪᴇɴᴄᴇ ɢᴇᴛs ᴇxᴘᴀɴᴅᴇᴅ. ʟᴇᴛ's ɪɴɪᴛɪᴀᴛᴇ ᴏᴜʀ ᴊᴏᴜʀɴᴇʏ ᴛᴏɢᴇᴛʜᴇʀ!`;
            await bot.editMessageText(welcomeText, {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'HTML',
                reply_markup: mainMenuKeyboard
            });
        } else if (data === 'top_cash') {
            const topCash = await pool.query('SELECT user_id, username, first_name, berries FROM users ORDER BY berries DESC LIMIT 10');
            let message = '💸 <b>Top Cash Holders</b>\n\n';
            topCash.rows.forEach((u, i) => {
                const name = u.username ? `@${u.username}` : u.first_name;
                message += `${i + 1}. ${name} - <b>${u.berries} 💸 ᴄᴀꜱʜ</b>\n`;
            });
            const keyboard = {
                inline_keyboard: [
                    [{ text: '🩷 ᴡᴀɪғᴜs', callback_data: 'top_waifus' }, { text: '💎 ɢᴇᴍs', callback_data: 'top_gems' }],
                    [{ text: '« CLOSE', callback_data: 'delete_message' }]
                ]
            };
            await bot.editMessageText(message, {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'HTML',
                reply_markup: keyboard
            });
        } else if (data === 'top_waifus') {
            const topWaifus = await pool.query(
                'SELECT u.user_id, u.username, u.first_name, COUNT(h.waifu_id) as count FROM users u JOIN harem h ON u.user_id = h.user_id GROUP BY u.user_id ORDER BY count DESC LIMIT 10'
            );
            let message = '🩷 <b>Top Waifu Collectors</b>\n\n';
            topWaifus.rows.forEach((u, i) => {
                const name = u.username ? `@${u.username}` : u.first_name;
                message += `${i + 1}. ${name} - <b>${u.count} waifus</b>\n`;
            });
            const keyboard = {
                inline_keyboard: [
                    [{ text: '💸 ᴄᴀꜱʜ', callback_data: 'top_cash' }, { text: '💎 ɢᴇᴍs', callback_data: 'top_gems' }],
                    [{ text: '« CLOSE', callback_data: 'delete_message' }]
                ]
            };
            await bot.editMessageText(message, {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'HTML',
                reply_markup: keyboard
            });
        } else if (data === 'top_gems') {
            const topGems = await pool.query('SELECT user_id, username, first_name, gems FROM users ORDER BY gems DESC LIMIT 10');
            let message = '💎 <b>Top Gem Holders</b>\n\n';
            topGems.rows.forEach((u, i) => {
                const name = u.username ? `@${u.username}` : u.first_name;
                message += `${i + 1}. ${name} - <b>${u.gems || 0} 💎 ɢᴇᴍs</b>\n`;
            });
            const keyboard = {
                inline_keyboard: [
                    [{ text: '💸 ᴄᴀꜱʜ', callback_data: 'top_cash' }, { text: '🩷 ᴡᴀɪғᴜs', callback_data: 'top_waifus' }],
                    [{ text: '« CLOSE', callback_data: 'delete_message' }]
                ]
            };
            await bot.editMessageText(message, {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'HTML',
                reply_markup: keyboard
            });
        } else if (data === 'delete_message') {
            await bot.deleteMessage(chatId, messageId);
        } else if (data.startsWith('show_char_')) {
            const waifuId = parseInt(data.split('_')[2]);
            const waifu = await pool.query('SELECT * FROM waifus WHERE waifu_id = $1', [waifuId]);
            if (waifu.rows.length > 0) {
                const w = waifu.rows[0];
                if (w.image_file_id) {
                    await bot.sendPhoto(chatId, w.image_file_id, {
                        caption: `<b>${w.name}</b>\nFrom: ${w.anime}\nRarity: ${RARITY_NAMES[w.rarity]}`,
                        parse_mode: 'HTML'
                    });
                }
            }
            await bot.answerCallbackQuery(query.id);
            return;
        }

        await bot.answerCallbackQuery(query.id);
    } catch (error) {
        console.error('Callback query error:', error);
        try {
            await bot.answerCallbackQuery(query.id, { text: 'Error occurred' });
        } catch (e) {}
    }
});

bot.onText(/\/explore/, async (msg) => {
    if (!await checkUserAccess(msg)) return;

    const userId = msg.from.id;
    await ensureUser(userId, msg.from.username, msg.from.first_name);

    const cooldown = await checkCooldown(userId, 'explore', 60);
    if (cooldown > 0) {
        return sendReply(msg.chat.id, msg.message_id, `ʏᴏᴜ ᴍᴜꜱᴛ ᴡᴀɪᴛ ${cooldown} ꜱᴇᴄᴏɴᴅꜱ ʙᴇꜰᴏʀᴇ ᴜꜱɪɴɢ ᴇxᴘʟᴏʀᴇ ᴀɢᴀɪɴ.`);
    }

    const cash = Math.floor(Math.random() * 5001) + 2000;
    await pool.query('UPDATE users SET berries = berries + $1 WHERE user_id = $2', [cash, userId]);
    await saveUserDataToFile(userId);

    let message;
    if (cash >= 6500 && cash <= 7000) {
        message = `ʏᴏᴜ ᴇxᴘʟᴏʀᴇ ᴀ ᴅᴜɴɢᴇᴏɴ ᴀɴᴅ ɢᴏᴛ TREASURE <b>${cash} ᴄᴀꜱʜ💸</b>`;
    } else {
        message = `ʏᴏᴜ ᴇxᴘʟᴏʀᴇ ᴀ ᴅᴜɴɢᴇᴏɴ ᴀɴᴅ ɢᴏᴛ <b>${cash} ᴄᴀꜱʜ💸</b>`;
    }

    sendReply(msg.chat.id, msg.message_id, message);
});

bot.onText(/\/bal/, async (msg) => {
    const userId = msg.from.id;
    const user = await ensureUser(userId, msg.from.username, msg.from.first_name);
    
    const gems = user.gems || 0;
    const cash = user.berries || 0;
    const crimson = user.crimson || 0;
    
    const message = `💰 <b>Your Balance:</b>\n\n💠 ɢᴇᴍs: ${gems}\n💸 ᴄᴀsʜ: ${cash}\n🩸 ᴄʀɪᴍsᴏɴ: ${crimson}`;
    
    sendReply(msg.chat.id, msg.message_id, message);
});

bot.onText(/\/claim/, async (msg) => {
    if (!await checkUserAccess(msg)) return;

    const userId = msg.from.id;
    const user = await ensureUser(userId, msg.from.username, msg.from.first_name);

    if (user.last_claim_date) {
        return sendReply(msg.chat.id, msg.message_id, '❌ You have already claimed your first-time reward!');
    }

    const rewardAmount = 5000000;
    await pool.query('UPDATE users SET berries = berries + $1, last_claim_date = CURRENT_DATE WHERE user_id = $2', [rewardAmount, userId]);
    await saveUserDataToFile(userId);

    sendReply(msg.chat.id, msg.message_id, `🎁 First-time claim successful! You received <b>${rewardAmount} 💸 ᴄᴀꜱʜ</b>!`);
});

bot.onText(/\/daily/, async (msg) => {
    if (!await checkUserAccess(msg)) return;

    const userId = msg.from.id;
    const user = await ensureUser(userId, msg.from.username, msg.from.first_name);

    const now = new Date();
    const lastDaily = user.last_daily_claim ? new Date(user.last_daily_claim) : null;

    if (lastDaily && (now - lastDaily) / (1000 * 60 * 60 * 24) < 1) {
        const nextDaily = new Date(lastDaily.getTime() + 24 * 60 * 60 * 1000);
        const hoursUntilDaily = Math.ceil((nextDaily - now) / (1000 * 60 * 60));
        return sendReply(msg.chat.id, msg.message_id, `⏱️ Daily bonus already claimed! Available in ${hoursUntilDaily}h`);
    }

    const streak = (!lastDaily || (now - lastDaily) / (1000 * 60 * 60 * 48) < 1) ? user.daily_streak + 1 : 1;
    let dailyReward = 50000;

    await pool.query('UPDATE users SET berries = berries + $1, daily_streak = $2, last_daily_claim = NOW() WHERE user_id = $3', 
        [dailyReward, streak, userId]);
    await saveUserDataToFile(userId);

    sendReply(msg.chat.id, msg.message_id, `🎁 Daily bonus claimed!\n\n💸 Reward: ${dailyReward} 💸\n🔥 Streak: ${streak}\n\n✅ Congratulations!`);
});

bot.onText(/\/weekly/, async (msg) => {
    if (!await checkUserAccess(msg)) return;

    const userId = msg.from.id;
    const user = await ensureUser(userId, msg.from.username, msg.from.first_name);

    const now = new Date();
    const lastWeekly = user.last_weekly_claim ? new Date(user.last_weekly_claim) : null;

    if (lastWeekly && (now - lastWeekly) / (1000 * 60 * 60 * 24 * 7) < 1) {
        const nextWeekly = new Date(lastWeekly.getTime() + 7 * 24 * 60 * 60 * 1000);
        const daysUntilWeekly = Math.ceil((nextWeekly - now) / (1000 * 60 * 60 * 24));
        return sendReply(msg.chat.id, msg.message_id, `⏱️ Weekly bonus already claimed! Available in ${daysUntilWeekly}d`);
    }

    const streak = (!lastWeekly || (now - lastWeekly) / (1000 * 60 * 60 * 24 * 14) < 1) ? user.weekly_streak + 1 : 1;
    let weeklyReward = 3000000;

    await pool.query('UPDATE users SET berries = berries + $1, weekly_streak = $2, last_weekly_claim = NOW() WHERE user_id = $3', 
        [weeklyReward, streak, userId]);
    await saveUserDataToFile(userId);

    sendReply(msg.chat.id, msg.message_id, `🎁 Weekly bonus claimed!\n\n💸 Reward: ${weeklyReward} 💸\n📊 Streak: ${streak}\n\n✅ Congratulations!`);
});



bot.onText(/\/marry/, async (msg) => {
    if (!await checkUserAccess(msg)) return;

    const userId = msg.from.id;
    await ensureUser(userId, msg.from.username, msg.from.first_name);

    const cooldown = await checkCooldown(userId, 'marry', 3600);
    if (cooldown > 0) {
        const minutes = Math.floor(cooldown / 60);
        const seconds = cooldown % 60;
        return sendReply(msg.chat.id, msg.message_id, `⏱️ Wait ${minutes}m ${seconds}s before marrying again!`);
    }

    await bot.sendDice(msg.chat.id, { emoji: '🎲', reply_to_message_id: msg.message_id });

    await new Promise(resolve => setTimeout(resolve, 2000));

    const waifu = await getRandomWaifu([1, 4]);
    if (!waifu) {
        return sendReply(msg.chat.id, msg.message_id, '❌ No waifus available yet!');
    }

    const marriageSuccess = Math.random() < 0.7;

    if (!marriageSuccess) {
        return sendReply(msg.chat.id, msg.message_id, `${msg.from.first_name}, ʏᴏᴜʀ ᴍᴀʀʀɪᴀɢᴇ ᴘʀᴏᴘᴏꜱᴀʟ ᴡᴀꜱ ʀᴇᴊᴇᴄᴛᴇᴅ ᴀɴᴅ ꜱʜᴇ ʀᴀɴ ᴀᴡᴀʏ! 🤡`);
    }

    await pool.query('INSERT INTO harem (user_id, waifu_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [userId, waifu.waifu_id]);
    await saveUserDataToFile(userId);
    
    // Auto-save users data after marry
    saveUsersData().catch(console.error);

    const message = `ᴄᴏɴɢʀᴀᴛᴜʟᴀᴛɪᴏɴꜱ! ${msg.from.first_name}, ʏᴏᴜ ᴀʀᴇ ɴᴏᴡ ᴍᴀʀʀɪᴇᴅ! ʜᴇʀᴇ ɪꜱ ʏᴏᴜʀ ᴄʜᴀʀᴀᴄᴛᴇʀ:\n\n𝗡𝗔𝗠𝗘: ${waifu.name}\n𝗔𝗡𝗜𝗠𝗘: ${waifu.anime}\n𝗥𝗔𝗥𝗜𝗧𝗬: ${RARITY_NAMES[waifu.rarity]}`;

    if (waifu.image_file_id) {
        sendPhotoReply(msg.chat.id, msg.message_id, waifu.image_file_id, message);
    } else {
        sendReply(msg.chat.id, msg.message_id, message);
    }
});

bot.onText(/\/dart(?:\s+(\d+))?/, async (msg, match) => {
    if (!await checkUserAccess(msg)) return;

    if (!match[1]) {
        return sendReply(msg.chat.id, msg.message_id, 'ɪɴsᴜғғɪᴄɪᴇɴᴛ ʙᴀʟᴀɴᴄᴇ ᴛᴏ ᴘʟᴀᴄᴇ ᴛʜɪs ʙᴇᴛ.\n\nUsage: /dart <amount>');
    }

    const amount = parseInt(match[1]);
    const userId = msg.from.id;
    const user = await ensureUser(userId, msg.from.username, msg.from.first_name);

    if (amount <= 0 || isNaN(amount)) {
        return sendReply(msg.chat.id, msg.message_id, '❌ Invalid amount! Use: /dart <amount>');
    }

    if (user.berries < amount) {
        return sendReply(msg.chat.id, msg.message_id, `❌ Insufficient cash! You have ${user.berries} 💸`);
    }

    const diceMsg = await bot.sendDice(msg.chat.id, { emoji: '🎯', reply_to_message_id: msg.message_id });

    await new Promise(resolve => setTimeout(resolve, 4000));

    const win = Math.random() < 0.30;

    if (win) {
        const winAmount = amount * 3;
        await pool.query('UPDATE users SET berries = berries + $1 WHERE user_id = $2', [amount * 2, userId]);
        await saveUserDataToFile(userId);
        sendReply(msg.chat.id, msg.message_id, `🎯 <b>Bullseye!</b> You won <b>${winAmount} 💸</b>! (Net: +${amount * 2} 💸)`);
    } else {
        await pool.query('UPDATE users SET berries = berries - $1 WHERE user_id = $2', [amount, userId]);
        await saveUserDataToFile(userId);
        sendReply(msg.chat.id, msg.message_id, `💔 Missed! You lost <b>${amount} 💸</b>.`);
    }
});

bot.onText(/\/top/, async (msg) => {
    const keyboard = {
        inline_keyboard: [
            [{ text: '💸 ᴄᴀꜱʜ', callback_data: 'top_cash' }, { text: '🩷 ᴡᴀɪғᴜs', callback_data: 'top_waifus' }],
            [{ text: '💎 ɢᴇᴍs', callback_data: 'top_gems' }]
        ]
    };

    sendReply(msg.chat.id, msg.message_id, '🏆 <b>Leaderboards</b>\n\nChoose a category:', { reply_markup: keyboard });
});

// /Gtop command - Top 10 richest groups
bot.onText(/\/gtop/i, async (msg) => {
    try {
        const topGroups = await pool.query(`
            SELECT g.group_id, g.group_name, SUM(u.berries) as total_cash, COUNT(DISTINCT u.user_id) as member_count
            FROM group_settings g
            LEFT JOIN users u ON u.user_id IN (
                SELECT DISTINCT user_id FROM harem WHERE user_id IN (
                    SELECT user_id FROM users WHERE user_id > 0
                )
            )
            GROUP BY g.group_id, g.group_name
            ORDER BY total_cash DESC
            LIMIT 10
        `);

        let message = '💰 <b>Top 10 Richest Groups</b>\n\n';
        
        if (topGroups.rows.length === 0) {
            message += 'No group data available yet!';
        } else {
            topGroups.rows.forEach((group, i) => {
                const name = group.group_name || `Group ${group.group_id}`;
                const cash = group.total_cash || 0;
                const members = group.member_count || 0;
                message += `${i + 1}. ${name}\n   💸 ${cash.toLocaleString()} | 👥 ${members} members\n\n`;
            });
        }

        sendReply(msg.chat.id, msg.message_id, message);
    } catch (error) {
        console.error('Error in /gtop:', error);
        sendReply(msg.chat.id, msg.message_id, '❌ Error loading group leaderboard!');
    }
});

bot.onText(/\/uploaderlist/, async (msg) => {
    const uploaders = await pool.query("SELECT DISTINCT u.user_id, u.username, u.first_name FROM users u JOIN roles r ON u.user_id = r.user_id WHERE r.role_type = 'uploader' ORDER BY u.first_name");

    let message = '👤 <b>Uploaders List</b>\n\n';

    if (uploaders.rows.length === 0) {
        message += 'No uploaders found.';
    } else {
        uploaders.rows.forEach((u, i) => {
            const name = u.username ? `@${u.username}` : u.first_name;
            message += `${i + 1}. ${name} (ID: <code>${u.user_id}</code>)\n`;
        });
    }

    sendReply(msg.chat.id, msg.message_id, message);
});

bot.onText(/\/sudolist/, async (msg) => {
    const sudos = await pool.query("SELECT DISTINCT u.user_id, u.username, u.first_name FROM users u JOIN roles r ON u.user_id = r.user_id WHERE r.role_type = 'sudo' ORDER BY u.first_name");

    let message = '⚡ <b>Sudo Users List</b>\n\n';

    if (sudos.rows.length === 0) {
        message += 'No sudo users found.';
    } else {
        sudos.rows.forEach((u, i) => {
            const name = u.username ? `@${u.username}` : u.first_name;
            message += `${i + 1}. ${name} (ID: <code>${u.user_id}</code>)\n`;
        });
    }

    sendReply(msg.chat.id, msg.message_id, message);
});



bot.onText(/\/pay(?:\s+(.+))?/, async (msg, match) => {
    if (!await checkUserAccess(msg)) return;

    if (!msg.reply_to_message) {
        return sendReply(msg.chat.id, msg.message_id, 'ʀᴇᴘʟʏ ᴛᴏ ᴛʜᴇ ᴜsᴇʀ ʏᴏᴜ ᴡᴀɴᴛ ᴛᴏ ᴘᴀʏ.');
    }

    if (!match[1]) {
        return sendReply(msg.chat.id, msg.message_id, 'ʏᴏᴜ ɴᴇᴇᴅ ᴛᴏ ᴘʀᴏᴠɪᴅᴇ ᴀ ᴅɪɢɪᴛ!');
    }

    const amount = parseInt(match[1]);
    const fromId = msg.from.id;
    const toId = msg.reply_to_message.from.id;

    if (fromId === toId) {
        return sendReply(msg.chat.id, msg.message_id, '❌ Cannot send cash to yourself!');
    }

    if (amount <= 0 || isNaN(amount)) {
        return sendReply(msg.chat.id, msg.message_id, 'ʏᴏᴜ ɴᴇᴇᴅ ᴛᴏ ᴘʀᴏᴠɪᴅᴇ ᴀ ᴅɪɢɪᴛ!');
    }

    const fromUser = await ensureUser(fromId, msg.from.username, msg.from.first_name);
    const toUser = await ensureUser(toId, msg.reply_to_message.from.username, msg.reply_to_message.from.first_name);

    if (fromUser.berries < amount) {
        return sendReply(msg.chat.id, msg.message_id, '❌ Insufficient cash!');
    }

    await pool.query('UPDATE users SET berries = berries - $1 WHERE user_id = $2', [amount, fromId]);
    await pool.query('UPDATE users SET berries = berries + $1 WHERE user_id = $2', [amount, toId]);
    await saveUserDataToFile(fromId);
    await saveUserDataToFile(toId);

    sendReply(msg.chat.id, msg.message_id, `✅ Successfully sent <b>${amount} 💸 ᴄᴀꜱʜ</b> to ${toUser.first_name}!`);
});

bot.onText(/\/dinfo(?:\s+(.+))?/, async (msg, match) => {
    if (!match || !match[1]) {
        if (msg.reply_to_message) {
            return sendReply(msg.chat.id, msg.message_id, '🜲ᴀ×ᴡ 𓆩🖤𓆪');
        }
        return sendReply(msg.chat.id, msg.message_id, '❌ Use: /dinfo upload format OR /dinfo rarity OR /dinfo price');
    }

    const arg = match[1].toLowerCase().trim();

    if (arg === 'upload format') {
        const message = `📤 <b>Upload Format Guide</b>\n\nName - \nAnime - \nRarity - \n\n<b>Example:</b>\nName - Naruto Uzumaki\nAnime - Naruto Shippuden\nRarity - 6\n\n𝗨𝗦𝗘 𝗢𝗡𝗟𝗬 𝗧𝗛𝗜𝗦 𝗙𝗢𝗥𝗠𝗔𝗧 𝗙𝗢𝗥 𝗨𝗣𝗟𝗢𝗔𝗗𝗜𝗡𝗚`;
        return sendReply(msg.chat.id, msg.message_id, message);
    } else if (arg === 'rarity') {
        const message = `🎨 <b>Rarity List</b>\n\n1. Common ⚪\n2. Rare 🟢\n3. Normal 🟣\n4. Legendary 🟡\n5. Summer 🏖\n6. Winter ❄️\n7. Valentine 💕\n8. Manga ✨\n9. Unique 👑\n10. Neon 💫\n11. Celestial 🪽\n12. Mythical 🪭\n13. Special 🫧\n14. Masterpiece 💸\n15. Limited 🔮\n16. Amv 🎥\n\n𝗧𝗢𝗧𝗔𝗟 𝟭𝟲 𝗥𝗔𝗥𝗜𝗧𝗬`;
        return sendReply(msg.chat.id, msg.message_id, message);
    } else if (arg === 'price') {
        const message = `💰 <b>Rarity Prices</b>\n\nCommon ⚪ – 20,000 💸\nRare 🟢 – 20,000 💸\nNormal 🟣 – 40,000 💸\nLegendary 🟡 – 50,000 💸\nSummer 🏖 – 400,000 💸\nWinter ❄️ – 600,000 💸\nValentine 💕 – 300,000 💸\nManga ✨ – 20,000 💸\nUnique 👑 – 400,000 💸\nNeon 💫 – 700,000 💸\nCelestial 🪽 – 800,000 💸\nMythical 🪭 – 900,000 💸\nSpecial 🫧 – 1,000,000 💸\nMasterpiece 💸 – 1,200,000 💸\nLimited 🔮 – 1,300,000 💸\nAmv 🎥 – 1,400,000 💸`;
        return sendReply(msg.chat.id, msg.message_id, message);
    } else {
        return sendReply(msg.chat.id, msg.message_id, '❌ Invalid option! Use: upload format, rarity, or price');
    }
});

bot.onText(/\/cmode/, async (msg) => {
    const userId = msg.from.id;
    await ensureUser(userId, msg.from.username, msg.from.first_name);

    const keyboard = {
        inline_keyboard: [
            [{ text: 'All', callback_data: 'cmode_all' }, { text: 'Common ⚪', callback_data: 'cmode_1' }],
            [{ text: 'Rare 🟢', callback_data: 'cmode_2' }, { text: 'Normal 🟣', callback_data: 'cmode_3' }],
            [{ text: 'Legendary 🟡', callback_data: 'cmode_4' }, { text: 'Summer 🏖', callback_data: 'cmode_5' }],
            [{ text: 'Winter ❄️', callback_data: 'cmode_6' }, { text: 'Valentine 💕', callback_data: 'cmode_7' }],
            [{ text: 'Manga ✨', callback_data: 'cmode_8' }, { text: 'Unique 👑', callback_data: 'cmode_9' }],
            [{ text: 'Next →', callback_data: 'cmode_next' }]
        ]
    };

    sendReply(msg.chat.id, msg.message_id, '🎨 <b>Collection Mode</b>\n\nSelect a rarity to filter your harem:', { reply_markup: keyboard });
});

bot.on('callback_query', async (query) => {
    const data = query.data;

    if (data.startsWith('cmode_')) {
        const userId = query.from.id;

        if (data === 'cmode_next') {
            const keyboard = {
                inline_keyboard: [
                    [{ text: 'Neon 💫', callback_data: 'cmode_10' }, { text: 'Celestial 🪽', callback_data: 'cmode_11' }],
                    [{ text: 'Mythical 🪭', callback_data: 'cmode_12' }, { text: 'Special 🫧', callback_data: 'cmode_13' }],
                    [{ text: 'Masterpiece 💸', callback_data: 'cmode_14' }, { text: 'Limited 🔮', callback_data: 'cmode_15' }],
                    [{ text: 'Amv 🎥', callback_data: 'cmode_16' }],
                    [{ text: '← Back', callback_data: 'cmode_back' }]
                ]
            };

            await bot.editMessageReplyMarkup(keyboard, {
                chat_id: query.message.chat.id,
                message_id: query.message.message_id
            });
        } else if (data === 'cmode_back') {
            const keyboard = {
                inline_keyboard: [
                    [{ text: 'All', callback_data: 'cmode_all' }, { text: 'Common ⚪', callback_data: 'cmode_1' }],
                    [{ text: 'Rare 🟢', callback_data: 'cmode_2' }, { text: 'Normal 🟣', callback_data: 'cmode_3' }],
                    [{ text: 'Legendary 🟡', callback_data: 'cmode_4' }, { text: 'Summer 🏖', callback_data: 'cmode_5' }],
                    [{ text: 'Winter ❄️', callback_data: 'cmode_6' }, { text: 'Valentine 💕', callback_data: 'cmode_7' }],
                    [{ text: 'Manga ✨', callback_data: 'cmode_8' }, { text: 'Unique 👑', callback_data: 'cmode_9' }],
                    [{ text: 'Next →', callback_data: 'cmode_next' }]
                ]
            };

            await bot.editMessageReplyMarkup(keyboard, {
                chat_id: query.message.chat.id,
                message_id: query.message.message_id
            });
        } else if (data === 'cmode_all') {
            await pool.query('UPDATE users SET harem_filter_rarity = NULL WHERE user_id = $1', [userId]);
            await bot.answerCallbackQuery(query.id, { text: '✅ Filter set to: All', show_alert: true });
            await bot.editMessageText('✅ Harem filter set to: <b>All</b>\n\nUse /harem to view your collection.', {
                chat_id: query.message.chat.id,
                message_id: query.message.message_id,
                parse_mode: 'HTML'
            });
        } else {
            const rarity = parseInt(data.split('_')[1]);
            await pool.query('UPDATE users SET harem_filter_rarity = $1 WHERE user_id = $2', [rarity, userId]);
            await bot.answerCallbackQuery(query.id, { text: `✅ Filter set to: ${RARITY_NAMES[rarity]}`, show_alert: true });
            await bot.editMessageText(`✅ Harem filter set to: <b>${RARITY_NAMES[rarity]}</b>\n\nUse /harem to view your collection.`, {
                chat_id: query.message.chat.id,
                message_id: query.message.message_id,
                parse_mode: 'HTML'
            });
        }
    }
});

bot.onText(/\/harem(?:\s+(\d+))?/, async (msg, match) => {
    if (!await checkUserAccess(msg)) return;
    
    const userId = msg.from.id;
    const user = await ensureUser(userId, msg.from.username, msg.from.first_name);

    const page = parseInt(match[1]) || 1;
    const limit = 40;
    const offset = (page - 1) * limit;

    let query;
    let params;

    if (user.harem_filter_rarity) {
        query = `SELECT w.*, h.acquired_date FROM harem h 
                 JOIN waifus w ON h.waifu_id = w.waifu_id 
                 WHERE h.user_id = $1 AND w.rarity = $2
                 ORDER BY h.acquired_date DESC 
                 LIMIT $3 OFFSET $4`;
        params = [userId, user.harem_filter_rarity, limit, offset];
    } else {
        query = `SELECT w.*, h.acquired_date FROM harem h 
                 JOIN waifus w ON h.waifu_id = w.waifu_id 
                 WHERE h.user_id = $1 
                 ORDER BY h.acquired_date DESC 
                 LIMIT $2 OFFSET $3`;
        params = [userId, limit, offset];
    }

    const result = await pool.query(query, params);

    let countQuery;
    let countParams;

    if (user.harem_filter_rarity) {
        countQuery = 'SELECT COUNT(*) FROM harem h JOIN waifus w ON h.waifu_id = w.waifu_id WHERE h.user_id = $1 AND w.rarity = $2';
        countParams = [userId, user.harem_filter_rarity];
    } else {
        countQuery = 'SELECT COUNT(*) FROM harem WHERE user_id = $1';
        countParams = [userId];
    }

    const countResult = await pool.query(countQuery, countParams);
    const total = parseInt(countResult.rows[0].count);

    if (total === 0) {
        const filterMsg = user.harem_filter_rarity ? ` in ${RARITY_NAMES[user.harem_filter_rarity]}` : '';
        return sendReply(msg.chat.id, msg.message_id, `📭 Your harem is empty${filterMsg}! Use /marry to get waifus.`);
    }

    const favId = user.favorite_waifu_id;
    const username = user.username ? `@${user.username}` : user.first_name;
    const totalPages = Math.ceil(total / limit);

    let message = `📚 <b>${username}'s Harem`;
    if (user.harem_filter_rarity) {
        message += ` (${RARITY_NAMES[user.harem_filter_rarity]})`;
    }
    message += ` (Page ${page}/${totalPages}):</b>\n\n`;

    if (user.harem_filter_rarity) {
        // Count duplicate waifus
        const waifuCounts = {};
        result.rows.forEach(w => {
            waifuCounts[w.waifu_id] = (waifuCounts[w.waifu_id] || 0) + 1;
        });
        
        let index = offset;
        const displayedIds = new Set();
        
        result.rows.forEach((w) => {
            if (!displayedIds.has(w.waifu_id)) {
                const fav = w.waifu_id === favId ? '⭐' : '';
                const count = waifuCounts[w.waifu_id];
                const countDisplay = count > 1 ? ` (×${count})` : '';
                message += `${offset + 1 + Array.from(displayedIds).length}. ${fav} ${w.name}${countDisplay} - ${w.anime} (ID: ${w.waifu_id})\n`;
                displayedIds.add(w.waifu_id);
            }
        });
    } else {
        // Count duplicate waifus
        const waifuCounts = {};
        result.rows.forEach(w => {
            waifuCounts[w.waifu_id] = (waifuCounts[w.waifu_id] || 0) + 1;
        });
        
        let currentRarity = null;
        let index = offset;
        const displayedIds = new Set();

        result.rows.forEach((w) => {
            if (!displayedIds.has(w.waifu_id)) {
                if (currentRarity !== w.rarity) {
                    currentRarity = w.rarity;
                    message += `\n<b>${RARITY_NAMES[w.rarity]}</b>\n`;
                }
                const fav = w.waifu_id === favId ? '⭐' : '';
                const count = waifuCounts[w.waifu_id];
                const countDisplay = count > 1 ? ` (×${count})` : '';
                index++;
                message += `${index}. ${fav} ${w.name}${countDisplay} - ${w.anime} (ID: ${w.waifu_id})\n`;
                displayedIds.add(w.waifu_id);
            }
        });
    }

    message += `\nTotal: ${total} waifus`;

    const keyboard = {
        inline_keyboard: []
    };

    if (page > 1) {
        keyboard.inline_keyboard.push([{ text: '⬅️ Previous', callback_data: `harem_${page - 1}` }]);
    }

    if (page < totalPages) {
        if (keyboard.inline_keyboard.length === 0) {
            keyboard.inline_keyboard.push([{ text: 'Next ➡️', callback_data: `harem_${page + 1}` }]);
        } else {
            keyboard.inline_keyboard[0].push({ text: 'Next ➡️', callback_data: `harem_${page + 1}` });
        }
    }

    if (favId) {
        const favResult = await pool.query('SELECT * FROM waifus WHERE waifu_id = $1', [favId]);
        if (favResult.rows.length > 0 && favResult.rows[0].image_file_id) {
            return sendPhotoReply(msg.chat.id, msg.message_id, favResult.rows[0].image_file_id, message, { reply_markup: keyboard.inline_keyboard.length > 0 ? keyboard : undefined });
        }
    }

    sendReply(msg.chat.id, msg.message_id, message, { reply_markup: keyboard.inline_keyboard.length > 0 ? keyboard : undefined });
});

bot.on('callback_query', async (query) => {
    if (query.data.startsWith('harem_')) {
        const page = parseInt(query.data.split('_')[1]);
        const userId = query.from.id;
        const user = await pool.query('SELECT * FROM users WHERE user_id = $1', [userId]);

        if (user.rows.length === 0) return;

        const u = user.rows[0];
        const limit = 40;
        const offset = (page - 1) * limit;

        let queryStr;
        let params;

        if (u.harem_filter_rarity) {
            queryStr = `SELECT w.*, h.acquired_date FROM harem h 
                     JOIN waifus w ON h.waifu_id = w.waifu_id 
                     WHERE h.user_id = $1 AND w.rarity = $2
                     ORDER BY h.acquired_date DESC 
                     LIMIT $3 OFFSET $4`;
            params = [userId, u.harem_filter_rarity, limit, offset];
        } else {
            queryStr = `SELECT w.*, h.acquired_date FROM harem h 
                     JOIN waifus w ON h.waifu_id = w.waifu_id 
                     WHERE h.user_id = $1 
                     ORDER BY h.acquired_date DESC 
                     LIMIT $2 OFFSET $3`;
            params = [userId, limit, offset];
        }

        const result = await pool.query(queryStr, params);

        let countQuery;
        let countParams;

        if (u.harem_filter_rarity) {
            countQuery = 'SELECT COUNT(*) FROM harem h JOIN waifus w ON h.waifu_id = w.waifu_id WHERE h.user_id = $1 AND w.rarity = $2';
            countParams = [userId, u.harem_filter_rarity];
        } else {
            countQuery = 'SELECT COUNT(*) FROM harem WHERE user_id = $1';
            countParams = [userId];
        }

        const countResult = await pool.query(countQuery, countParams);
        const total = parseInt(countResult.rows[0].count);

        const favId = u.favorite_waifu_id;
        const username = u.username ? `@${u.username}` : u.first_name;
        const totalPages = Math.ceil(total / limit);

        let message = `📚 <b>${username}'s Harem`;
        if (u.harem_filter_rarity) {
            message += ` (${RARITY_NAMES[u.harem_filter_rarity]})`;
        }
        message += ` (Page ${page}/${totalPages}):</b>\n\n`;

        if (u.harem_filter_rarity) {
            // Count duplicate waifus
            const waifuCounts = {};
            result.rows.forEach(w => {
                waifuCounts[w.waifu_id] = (waifuCounts[w.waifu_id] || 0) + 1;
            });
            
            let index = offset;
            const displayedIds = new Set();
            
            result.rows.forEach((w) => {
                if (!displayedIds.has(w.waifu_id)) {
                    const fav = w.waifu_id === favId ? '⭐' : '';
                    const count = waifuCounts[w.waifu_id];
                    const countDisplay = count > 1 ? ` (×${count})` : '';
                    message += `${offset + 1 + Array.from(displayedIds).length}. ${fav} ${w.name}${countDisplay} - ${w.anime} (ID: ${w.waifu_id})\n`;
                    displayedIds.add(w.waifu_id);
                }
            });
        } else {
            // GROUP BY ANIME (not rarity)
            const waifuCounts = {};
            result.rows.forEach(w => {
                waifuCounts[w.waifu_id] = (waifuCounts[w.waifu_id] || 0) + 1;
            });
            
            let currentAnime = null;
            let index = offset;
            const displayedIds = new Set();

            result.rows.forEach((w) => {
                if (!displayedIds.has(w.waifu_id)) {
                    // Group by anime name
                    if (currentAnime !== w.anime) {
                        currentAnime = w.anime;
                        message += `\n<b>${w.anime.toUpperCase()}</b>\n`;
                    }
                    const fav = w.waifu_id === favId ? '⭐' : '';
                    const count = waifuCounts[w.waifu_id];
                    const countDisplay = count > 1 ? ` (×${count})` : '';
                    index++;
                    message += `${index}. ${fav} ${w.name}${countDisplay} (ID: ${w.waifu_id})\n`;
                    displayedIds.add(w.waifu_id);
                }
            });
        }

        message += `\nTotal: ${total} waifus`;

        const keyboard = {
            inline_keyboard: []
        };

        if (page > 1) {
            keyboard.inline_keyboard.push([{ text: '⬅️ Previous', callback_data: `harem_${page - 1}` }]);
        }

        if (page < totalPages) {
            if (keyboard.inline_keyboard.length === 0) {
                keyboard.inline_keyboard.push([{ text: 'Next ➡️', callback_data: `harem_${page + 1}` }]);
            } else {
                keyboard.inline_keyboard[0].push({ text: 'Next ➡️', callback_data: `harem_${page + 1}` });
            }
        }

        try {
            await bot.editMessageCaption(message, {
                chat_id: query.message.chat.id,
                message_id: query.message.message_id,
                parse_mode: 'HTML',
                reply_markup: keyboard.inline_keyboard.length > 0 ? keyboard : undefined
            });
        } catch (e) {
            try {
                await bot.editMessageText(message, {
                    chat_id: query.message.chat.id,
                    message_id: query.message.message_id,
                    parse_mode: 'HTML',
                    reply_markup: keyboard.inline_keyboard.length > 0 ? keyboard : undefined
                });
            } catch (err) {}
        }

        bot.answerCallbackQuery(query.id);
    }
});

bot.onText(/\/adev(?:\s+(.+))?/, async (msg, match) => {
    const userId = msg.from.id;

    if (userId !== OWNER_ID) {
        return sendReply(msg.chat.id, msg.message_id, `❌ Only the owner (id: ${OWNER_ID}) can use this command!`);
    }

    // If no args and no reply, give dev to yourself
    if (!msg.reply_to_message && !match[1]) {
        await ensureUser(userId, msg.from.username, msg.from.first_name);
        await pool.query('INSERT INTO roles (user_id, role_type) VALUES ($1, $2) ON CONFLICT DO NOTHING', [userId, 'dev']);
        return sendReply(msg.chat.id, msg.message_id, '✅ You now have developer role!');
    }

    let targetId = null;
    let targetName = null;
    let targetUsername = null;

    // Method 1: If replying to someone
    if (msg.reply_to_message) {
        targetId = msg.reply_to_message.from.id;
        targetName = msg.reply_to_message.from.first_name;
        targetUsername = msg.reply_to_message.from.username;
    } else if (match[1]) {
        const args = match[1].trim();
        
        // Method 2: If username provided (@username)
        if (args.startsWith('@')) {
            const username = args.substring(1);
            const result = await pool.query('SELECT user_id, first_name, username FROM users WHERE username = $1', [username]);
            if (result.rows.length > 0) {
                targetId = result.rows[0].user_id;
                targetName = result.rows[0].first_name;
                targetUsername = result.rows[0].username;
            } else {
                return sendReply(msg.chat.id, msg.message_id, `❌ User with username @${username} not found in database!`);
            }
        } 
        // Method 3: If user ID provided (number)
        else if (!isNaN(args)) {
            targetId = parseInt(args);
            const result = await pool.query('SELECT first_name, username FROM users WHERE user_id = $1', [targetId]);
            if (result.rows.length > 0) {
                targetName = result.rows[0].first_name;
                targetUsername = result.rows[0].username;
            } else {
                targetName = `User ${targetId}`;
                targetUsername = null;
            }
        } else {
            return sendReply(msg.chat.id, msg.message_id, '❌ Invalid format! Use:\n• /adev (reply to user)\n• /adev @username\n• /adev [user_id]');
        }
    }

    if (!targetId) {
        return sendReply(msg.chat.id, msg.message_id, '❌ Reply to a user or use: /adev @username or /adev [user_id]');
    }

    // First ensure user exists in database
    await ensureUser(targetId, targetUsername, targetName);
    
    // Then add dev role
    await pool.query('INSERT INTO roles (user_id, role_type) VALUES ($1, $2) ON CONFLICT DO NOTHING', [targetId, 'dev']);

    const displayName = targetUsername ? `@${targetUsername}` : targetName;
    sendReply(msg.chat.id, msg.message_id, `✅ ${displayName} (ID: ${targetId}) is now a developer!`);
});

bot.onText(/\/rdev(?:\s+(.+))?/, async (msg, match) => {
    const userId = msg.from.id;

    if (userId !== OWNER_ID) {
        return sendReply(msg.chat.id, msg.message_id, `❌ Only the owner (id: ${OWNER_ID}) can use this command!`);
    }

    let targetId = null;
    let targetName = null;

    // If replying to someone
    if (msg.reply_to_message) {
        targetId = msg.reply_to_message.from.id;
        targetName = msg.reply_to_message.from.first_name;
    } else if (match[1]) {
        // If username provided
        const args = match[1].trim();
        if (args.startsWith('@')) {
            const username = args.substring(1);
            const result = await pool.query('SELECT user_id, first_name FROM users WHERE username = $1', [username]);
            if (result.rows.length > 0) {
                targetId = result.rows[0].user_id;
                targetName = result.rows[0].first_name;
            }
        } else {
            // If user ID provided
            targetId = parseInt(args);
            const result = await pool.query('SELECT first_name FROM users WHERE user_id = $1', [targetId]);
            if (result.rows.length > 0) {
                targetName = result.rows[0].first_name;
            } else {
                targetName = `User ${targetId}`;
            }
        }
    }

    if (!targetId) {
        return sendReply(msg.chat.id, msg.message_id, '❌ Reply to a user or use: /rdev @username or /rdev [user_id]');
    }

    const result = await pool.query("DELETE FROM roles WHERE user_id = $1 AND role_type = 'dev' RETURNING *", [targetId]);

    if (result.rowCount === 0) {
        return sendReply(msg.chat.id, msg.message_id, `❌ ${targetName} is not a developer!`);
    }

    sendReply(msg.chat.id, msg.message_id, `✅ Removed developer role from ${targetName}!`);
});

bot.onText(/\/reset_waifu\s+(.+)/, async (msg, match) => {
    const userId = msg.from.id;

    if (!await hasRole(userId, 'dev')) {
        return sendReply(msg.chat.id, msg.message_id, '❌ Developer permission required!');
    }

    const args = match[1].split(' ');

    if (args[0] === 'all') {
        const target = await getTargetUser(msg, args.slice(1));

        if (!target.targetId) {
            return sendReply(msg.chat.id, msg.message_id, '❌ Reply to a user or provide username/ID!');
        }

        await pool.query('DELETE FROM harem WHERE user_id = $1', [target.targetId]);
        await saveUserDataToFile(target.targetId);

        sendReply(msg.chat.id, msg.message_id, `✅ All waifus removed from ${target.targetName}!`);
    } else {
        const waifuId = parseInt(args[0]);
        const target = await getTargetUser(msg, args.slice(1));

        if (!target.targetId) {
            return sendReply(msg.chat.id, msg.message_id, '❌ Reply to a user or provide username/ID!');
        }

        const result = await pool.query('DELETE FROM harem WHERE user_id = $1 AND waifu_id = $2 RETURNING *', [target.targetId, waifuId]);

        if (result.rowCount === 0) {
            return sendReply(msg.chat.id, msg.message_id, '❌ User does not own this waifu!');
        }

        await saveUserDataToFile(target.targetId);
        sendReply(msg.chat.id, msg.message_id, `✅ Waifu ID ${waifuId} removed from ${target.targetName}!`);
    }
});

bot.onText(/\/reset_cash\s+(.+)/, async (msg, match) => {
    const userId = msg.from.id;

    if (!await hasRole(userId, 'dev')) {
        return sendReply(msg.chat.id, msg.message_id, '❌ Developer permission required!');
    }

    const args = match[1].split(' ');

    if (args[0] === 'all') {
        // ⚠️ SAFETY: Show inline Yes/No buttons for confirmation
        const keyboard = {
            inline_keyboard: [
                [
                    { text: '✅ YES - Reset All', callback_data: 'reset_cash_yes' },
                    { text: '❌ NO - Cancel', callback_data: 'reset_cash_no' }
                ]
            ]
        };
        return bot.sendMessage(msg.chat.id, 
            '⚠️ <b>DANGER WARNING!</b>\n\nThis will reset <b>ALL</b> users cash to 0!\n\nAre you sure?',
            {
                reply_to_message_id: msg.message_id,
                parse_mode: 'HTML',
                reply_markup: keyboard
            }
        );
    } else {
        const amount = parseInt(args[0]);
        const target = await getTargetUser(msg, args.slice(1));

        if (!target.targetId) {
            return sendReply(msg.chat.id, msg.message_id, '❌ Reply to a user or provide username/ID!');
        }

        if (isNaN(amount) || amount < 0) {
            return sendReply(msg.chat.id, msg.message_id, '❌ Invalid amount!');
        }

        await pool.query('UPDATE users SET berries = GREATEST(berries - $1, 0) WHERE user_id = $2', [amount, target.targetId]);
        await saveUserDataToFile(target.targetId);

        sendReply(msg.chat.id, msg.message_id, `✅ Removed ${amount} 💸 ᴄᴀꜱʜ from ${target.targetName}!`);
    }
});

// Handle reset_cash callback buttons
bot.on('callback_query', async (query) => {
    if (query.data === 'reset_cash_yes') {
        const userId = query.from.id;
        
        if (!await hasRole(userId, 'sudo') && !await hasRole(userId, 'dev') && userId !== OWNER_ID) {
            return bot.answerCallbackQuery(query.id, { text: '❌ Only OWNER can reset all cash!', show_alert: true });
        }

        try {
            await pool.query('UPDATE users SET berries = 0');
            const users = await pool.query('SELECT user_id FROM users');
            for (const u of users.rows) {
                await saveUserDataToFile(u.user_id);
            }

            console.log(`⚠️ MASS CASH RESET by ${query.from.first_name}`);
            
            bot.editMessageText(
                '✅ <b>COMPLETED!</b>\n\n✅ All users cash has been reset to 0!',
                {
                    chat_id: query.message.chat.id,
                    message_id: query.message.message_id,
                    parse_mode: 'HTML'
                }
            );
            
            bot.answerCallbackQuery(query.id, { text: '✅ Reset complete!', show_alert: true });
        } catch (error) {
            console.error('Error resetting cash:', error);
            bot.answerCallbackQuery(query.id, { text: '❌ Error resetting cash!', show_alert: true });
        }
    } else if (query.data === 'reset_cash_no') {
        bot.editMessageText(
            '❌ <b>CANCELLED</b>\n\nCash reset was cancelled.',
            {
                chat_id: query.message.chat.id,
                message_id: query.message.message_id,
                parse_mode: 'HTML'
            }
        );
        
        bot.answerCallbackQuery(query.id, { text: 'Reset cancelled', show_alert: false });
    }
});

bot.onText(/\/gban\s+(.+)/, async (msg, match) => {
    const userId = msg.from.id;

    if (!await hasRole(userId, 'dev')) {
        return sendReply(msg.chat.id, msg.message_id, '❌ Developer permission required!');
    }

    const args = match[1].split(' ');
    const target = await getTargetUser(msg, args);

    if (!target.targetId) {
        return sendReply(msg.chat.id, msg.message_id, '❌ Reply to a user or provide username/ID!');
    }

    const reason = args.slice(1).join(' ') || 'No reason provided';

    await pool.query('INSERT INTO banned_users (user_id, reason) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET reason = $2', [target.targetId, reason]);
    await pool.query('DELETE FROM harem WHERE user_id = $1', [target.targetId]);
    await pool.query('UPDATE users SET berries = 0, daily_streak = 0, weekly_streak = 0 WHERE user_id = $1', [target.targetId]);
    await saveUserDataToFile(target.targetId);

    sendReply(msg.chat.id, msg.message_id, `✅ ${target.targetName} has been globally banned!\n\nReason: ${reason}`);
});

bot.onText(/\/gunban\s+(.+)/, async (msg, match) => {
    const userId = msg.from.id;

    if (!await hasRole(userId, 'dev')) {
        return sendReply(msg.chat.id, msg.message_id, '❌ Developer permission required!');
    }

    const args = match[1].split(' ');
    const target = await getTargetUser(msg, args);

    if (!target.targetId) {
        return sendReply(msg.chat.id, msg.message_id, '❌ Reply to a user or provide username/ID!');
    }

    const result = await pool.query('DELETE FROM banned_users WHERE user_id = $1 RETURNING *', [target.targetId]);

    if (result.rowCount === 0) {
        return sendReply(msg.chat.id, msg.message_id, '❌ User is not banned!');
    }

    sendReply(msg.chat.id, msg.message_id, `✅ ${target.targetName} has been unbanned!`);
});

bot.onText(/\/gen\s+(.+)\s+(\d+)/i, async (msg, match) => {
    const userId = msg.from.id;

    if (!await hasRole(userId, 'sudo') && !await hasRole(userId, 'dev')) {
        return sendReply(msg.chat.id, msg.message_id, '❌ Sudo/Dev permission required!');
    }

    const amountStr = match[1].trim();
    const quantity = parseInt(match[2]);

    if (quantity <= 0) {
        return sendReply(msg.chat.id, msg.message_id, '❌ Quantity must be positive!');
    }

    let amount;
    try {
        amount = BigInt(amountStr);
        if (amount <= 0) {
            return sendReply(msg.chat.id, msg.message_id, '❌ Amount must be positive!');
        }
    } catch (e) {
        const parsed = parseFloat(amountStr);
        if (isNaN(parsed) || parsed <= 0) {
            return sendReply(msg.chat.id, msg.message_id, '❌ Invalid amount!');
        }
        amount = BigInt(Math.floor(parsed));
    }

    const code = 'CASH' + Math.random().toString(36).substring(2, 10).toUpperCase();

    try {
        await pool.query(
            'INSERT INTO redeem_codes (code, code_type, amount, max_uses, uses) VALUES ($1, $2, $3, $4, 0)',
            [code, 'cash', amount.toString(), quantity]
        );

        console.log(`✅ Cash code: ${code} by ${msg.from.first_name}`);
        sendReply(msg.chat.id, msg.message_id, `✅ Cash code generated!\n\n💳 Code: <code>${code}</code>\n💸 Amount: ${amount}\n📦 Uses: ${quantity}`);
    } catch (error) {
        console.error('❌ /gen error:', error.message);
        sendReply(msg.chat.id, msg.message_id, `❌ Database error: ${error.message}`);
    }
});

bot.onText(/\/dgen\s+(\d+)\s+(\d+)/i, async (msg, match) => {
    const userId = msg.from.id;

    if (!await hasRole(userId, 'sudo') && !await hasRole(userId, 'dev')) {
        return sendReply(msg.chat.id, msg.message_id, '❌ Sudo/Dev permission required!');
    }

    const waifuId = parseInt(match[1]);
    const quantity = parseInt(match[2]);

    if (quantity <= 0) {
        return sendReply(msg.chat.id, msg.message_id, '❌ Quantity must be positive!');
    }

    try {
        const waifuCheck = await pool.query('SELECT * FROM waifus WHERE waifu_id = $1', [waifuId]);
        if (waifuCheck.rows.length === 0) {
            return sendReply(msg.chat.id, msg.message_id, '❌ Waifu not found!');
        }

        const code = 'WAIFU' + Math.random().toString(36).substring(2, 10).toUpperCase();

        await pool.query(
            'INSERT INTO redeem_codes (code, code_type, waifu_id, max_uses, uses) VALUES ($1, $2, $3, $4, 0)',
            [code, 'waifu', waifuId, quantity]
        );

        console.log(`✅ Waifu code: ${code} for ${waifuCheck.rows[0].name}`);
        sendReply(msg.chat.id, msg.message_id, `✅ Waifu code generated!\n\n💳 Code: <code>${code}</code>\n🎴 Waifu: ${waifuCheck.rows[0].name}\n📦 Uses: ${quantity}`);
    } catch (error) {
        console.error('❌ /dgen error:', error.message);
        sendReply(msg.chat.id, msg.message_id, `❌ Database error: ${error.message}`);
    }
});

bot.onText(/\/give\s+(.+)/, async (msg, match) => {
    const userId = msg.from.id;

    if (!await hasRole(userId, 'sudo') && !await hasRole(userId, 'dev')) {
        return sendReply(msg.chat.id, msg.message_id, '❌ Sudo permission required!');
    }

    if (!msg.reply_to_message) {
        return sendReply(msg.chat.id, msg.message_id, '❌ Reply to a user!');
    }

    const waifuId = parseInt(match[1]);
    const targetId = msg.reply_to_message.from.id;

    const waifuCheck = await pool.query('SELECT * FROM waifus WHERE waifu_id = $1', [waifuId]);
    if (waifuCheck.rows.length === 0) {
        return sendReply(msg.chat.id, msg.message_id, '❌ Waifu not found!');
    }

    await ensureUser(targetId, msg.reply_to_message.from.username, msg.reply_to_message.from.first_name);
    await pool.query('INSERT INTO harem (user_id, waifu_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [targetId, waifuId]);
    await saveUserDataToFile(targetId);

    sendReply(msg.chat.id, msg.message_id, `✅ Gave ${waifuCheck.rows[0].name} to ${msg.reply_to_message.from.first_name}!`);
});

bot.onText(/\/give_waifu\s+(.+)/, async (msg, match) => {
    const userId = msg.from.id;

    if (!await hasRole(userId, 'dev')) {
        return sendReply(msg.chat.id, msg.message_id, '❌ Developer permission required!');
    }

    const args = match[1].trim().split(' ');
    
    let waifuIdentifier;
    let targetArgs = [];
    
    if (msg.reply_to_message) {
        waifuIdentifier = args.join(' ');
    } else if (args.length >= 2) {
        const lastArg = args[args.length - 1];
        if (lastArg.startsWith('@') || !isNaN(lastArg)) {
            waifuIdentifier = args.slice(0, -1).join(' ');
            targetArgs = [lastArg];
        } else {
            waifuIdentifier = args.join(' ');
        }
    } else {
        waifuIdentifier = args[0];
    }

    const target = await getTargetUser(msg, targetArgs);

    if (!target.targetId) {
        return sendReply(msg.chat.id, msg.message_id, '❌ Reply to a user or use: /give_waifu [waifu_id/name] @username or /give_waifu [waifu_id/name] [user_id]');
    }

    let waifuCheck;
    if (isNaN(waifuIdentifier)) {
        waifuCheck = await pool.query('SELECT * FROM waifus WHERE LOWER(name) = LOWER($1) LIMIT 1', [waifuIdentifier]);
    } else {
        const waifuId = parseInt(waifuIdentifier);
        waifuCheck = await pool.query('SELECT * FROM waifus WHERE waifu_id = $1', [waifuId]);
    }

    if (waifuCheck.rows.length === 0) {
        return sendReply(msg.chat.id, msg.message_id, '❌ Waifu not found! Use waifu ID or exact name.');
    }

    const waifu = waifuCheck.rows[0];
    
    let targetUsername = null;
    let targetFirstName = target.targetName;
    
    if (msg.reply_to_message) {
        targetUsername = msg.reply_to_message.from.username;
        targetFirstName = msg.reply_to_message.from.first_name;
    } else {
        const userInfo = await pool.query('SELECT username, first_name FROM users WHERE user_id = $1', [target.targetId]);
        if (userInfo.rows.length > 0) {
            targetUsername = userInfo.rows[0].username;
            targetFirstName = userInfo.rows[0].first_name || target.targetName;
        }
    }
    
    await ensureUser(target.targetId, targetUsername, targetFirstName);
    await pool.query('INSERT INTO harem (user_id, waifu_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [target.targetId, waifu.waifu_id]);
    await saveUserDataToFile(target.targetId);

    sendReply(msg.chat.id, msg.message_id, `✅ Gave ${waifu.name} (ID: ${waifu.waifu_id}) to ${targetFirstName}!`);
});

bot.onText(/\/give_cash\s+(.+)/, async (msg, match) => {
    const userId = msg.from.id;

    if (!await hasRole(userId, 'dev')) {
        return sendReply(msg.chat.id, msg.message_id, '❌ Developer permission required!');
    }

    const args = match[1].split(' ');
    const amount = parseInt(args[0]);

    if (isNaN(amount) || amount <= 0) {
        return sendReply(msg.chat.id, msg.message_id, '❌ Invalid amount! Use: /give_cash <amount> @username or reply to message');
    }

    const target = await getTargetUser(msg, args.slice(1));

    if (!target.targetId) {
        return sendReply(msg.chat.id, msg.message_id, '❌ Reply to a user or use: /give_cash [amount] @username or /give_cash [amount] [user_id]');
    }

    let targetUsername = null;
    let targetFirstName = target.targetName;
    
    if (msg.reply_to_message) {
        targetUsername = msg.reply_to_message.from.username;
        targetFirstName = msg.reply_to_message.from.first_name;
    } else {
        const userInfo = await pool.query('SELECT username, first_name FROM users WHERE user_id = $1', [target.targetId]);
        if (userInfo.rows.length > 0) {
            targetUsername = userInfo.rows[0].username;
            targetFirstName = userInfo.rows[0].first_name || target.targetName;
        }
    }

    await ensureUser(target.targetId, targetUsername, targetFirstName);
    await pool.query('UPDATE users SET berries = berries + $1 WHERE user_id = $2', [amount, target.targetId]);
    await saveUserDataToFile(target.targetId);

    const userResult = await pool.query('SELECT berries FROM users WHERE user_id = $1', [target.targetId]);
    const newBalance = userResult.rows[0].berries;

    sendReply(msg.chat.id, msg.message_id, `✅ Gave ${amount} 💸 ᴄᴀꜱʜ to ${targetFirstName}!\nNew balance: ${newBalance} 💸`);
});

bot.onText(/\/gift(?:\s+(.+))?/, async (msg, match) => {
    if (!await checkUserAccess(msg)) return;

    if (!msg.reply_to_message) {
        return sendReply(msg.chat.id, msg.message_id, 'ʏᴏᴜ ɴᴇᴇᴅ ᴛᴏ ʀᴇᴘʟʏ ᴛᴏ ᴀ ᴜsᴇʀ\'s ᴍᴇssᴀɢᴇ ᴛᴏ ɢɪғᴛ ᴀ ᴄʜᴀʀᴀᴄᴛᴇʀ!');
    }

    if (!match[1]) {
        return sendReply(msg.chat.id, msg.message_id, 'ʏᴏᴜ ɴᴇᴇᴅ ᴛᴏ ᴘʀᴏᴠɪᴅᴇ ᴀ ᴄʜᴀʀᴀᴄᴛᴇʀ ɪᴅ!');
    }

    const waifuId = parseInt(match[1]);
    const fromId = msg.from.id;
    const toId = msg.reply_to_message.from.id;

    if (isNaN(waifuId)) {
        return sendReply(msg.chat.id, msg.message_id, 'ʏᴏᴜ ɴᴇᴇᴅ ᴛᴏ ᴘʀᴏᴠɪᴅᴇ ᴀ ᴄʜᴀʀᴀᴄᴛᴇʀ ɪᴅ!');
    }

    if (fromId === toId) {
        return sendReply(msg.chat.id, msg.message_id, '❌ Cannot gift to yourself!');
    }

    const owned = await pool.query('SELECT * FROM harem WHERE user_id = $1 AND waifu_id = $2', [fromId, waifuId]);
    if (owned.rows.length === 0) {
        return sendReply(msg.chat.id, msg.message_id, "❌ You don't own this waifu!");
    }

    const waifu = await pool.query('SELECT * FROM waifus WHERE waifu_id = $1', [waifuId]);

    await pool.query('DELETE FROM harem WHERE user_id = $1 AND waifu_id = $2', [fromId, waifuId]);
    await pool.query('INSERT INTO harem (user_id, waifu_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [toId, waifuId]);
    await ensureUser(toId, msg.reply_to_message.from.username, msg.reply_to_message.from.first_name);
    await saveUserDataToFile(fromId);
    await saveUserDataToFile(toId);

    sendReply(msg.chat.id, msg.message_id, `🎁 ${msg.from.first_name} gifted ${waifu.rows[0].name} to ${msg.reply_to_message.from.first_name}!`);
});

bot.onText(/\/adduploader/, async (msg) => {
    const userId = msg.from.id;

    if (!await hasRole(userId, 'dev')) {
        return sendReply(msg.chat.id, msg.message_id, '❌ Developer permission required!');
    }

    if (!msg.reply_to_message) {
        return sendReply(msg.chat.id, msg.message_id, '❌ Reply to a user!');
    }

    const targetId = msg.reply_to_message.from.id;
    await ensureUser(targetId, msg.reply_to_message.from.username, msg.reply_to_message.from.first_name);
    await pool.query('INSERT INTO roles (user_id, role_type) VALUES ($1, $2) ON CONFLICT DO NOTHING', [targetId, 'uploader']);

    sendReply(msg.chat.id, msg.message_id, `✅ ${msg.reply_to_message.from.first_name} is now an uploader!`);
});

bot.onText(/\/ruploader/, async (msg) => {
    const userId = msg.from.id;

    if (!await hasRole(userId, 'dev')) {
        return sendReply(msg.chat.id, msg.message_id, '❌ Developer permission required!');
    }

    if (!msg.reply_to_message) {
        return sendReply(msg.chat.id, msg.message_id, '❌ Reply to a user!');
    }

    const targetId = msg.reply_to_message.from.id;
    await pool.query("DELETE FROM roles WHERE user_id = $1 AND role_type = 'uploader'", [targetId]);

    sendReply(msg.chat.id, msg.message_id, `✅ ${msg.reply_to_message.from.first_name} is no longer an uploader!`);
});

bot.onText(/\/addsudo/, async (msg) => {
    const userId = msg.from.id;

    if (!await hasRole(userId, 'dev')) {
        return sendReply(msg.chat.id, msg.message_id, '❌ Developer permission required!');
    }

    if (!msg.reply_to_message) {
        return sendReply(msg.chat.id, msg.message_id, '❌ Reply to a user!');
    }

    const targetId = msg.reply_to_message.from.id;
    await ensureUser(targetId, msg.reply_to_message.from.username, msg.reply_to_message.from.first_name);
    await pool.query('INSERT INTO roles (user_id, role_type) VALUES ($1, $2) ON CONFLICT DO NOTHING', [targetId, 'sudo']);

    sendReply(msg.chat.id, msg.message_id, `✅ ${msg.reply_to_message.from.first_name} is now a sudo user!`);
});

bot.onText(/\/rsudo/, async (msg) => {
    const userId = msg.from.id;

    if (!await hasRole(userId, 'dev')) {
        return sendReply(msg.chat.id, msg.message_id, '❌ Developer permission required!');
    }

    if (!msg.reply_to_message) {
        return sendReply(msg.chat.id, msg.message_id, '❌ Reply to a user!');
    }

    const targetId = msg.reply_to_message.from.id;
    await pool.query("DELETE FROM roles WHERE user_id = $1 AND role_type = 'sudo'", [targetId]);

    sendReply(msg.chat.id, msg.message_id, `✅ ${msg.reply_to_message.from.first_name} is no longer a sudo user!`);
});

bot.onText(/\/upload/, async (msg) => {
    const userId = msg.from.id;

    if (!await hasRole(userId, 'uploader') && !await hasRole(userId, 'sudo') && !await hasRole(userId, 'dev')) {
        return sendReply(msg.chat.id, msg.message_id, '❌ Uploader permission required!');
    }

    if (!msg.reply_to_message || (!msg.reply_to_message.photo && !msg.reply_to_message.video && !msg.reply_to_message.animation) || !msg.reply_to_message.caption) {
        return sendReply(msg.chat.id, msg.message_id, '❌ Reply to a photo/video/AMV with the correct caption format!\n\n📤 <b>Upload Format Guide</b>\n\nUser sends photo/video with caption in this exact format (each on a new line):\n\n<code>Name - \nAnime - \nRarity - </code>\n\n<b>Example:</b>\n<code>Name - Saitama\nAnime - One Punch Man\nRarity - 1</code>\n\nThen reply to that message with /upload\n\n💡 For AMV (rarity 16), send as video or animation');
    }

    const caption = msg.reply_to_message.caption.trim();

    const lines = caption.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    const data = {};

    for (const line of lines) {
        const parts = line.split(' - ');
        if (parts.length >= 2) {
            const key = parts[0].trim().toLowerCase();
            const value = parts.slice(1).join(' - ').trim();
            data[key] = value;
        }
    }

    if (!data.name || !data.anime || data.rarity === undefined) {
        return sendReply(msg.chat.id, msg.message_id, '❌ Invalid format! Caption must contain:\n\n<code>Name - (value)\nAnime - (value)\nRarity - (value)</code>\n\n<b>Example:</b>\n<code>Name - Saitama\nAnime - One Punch Man\nRarity - 1</code>\n\n<b>Found keys:</b> ' + JSON.stringify(Object.keys(data)));
    }

    const name = data.name.trim();
    const anime = data.anime.trim();
    const rarityStr = data.rarity.toString().trim();
    const rarity = parseInt(rarityStr);

    if (!name || name.length === 0) {
        return sendReply(msg.chat.id, msg.message_id, '❌ Name cannot be empty!');
    }
    
    if (!anime || anime.length === 0) {
        return sendReply(msg.chat.id, msg.message_id, '❌ Anime cannot be empty!');
    }

    if (isNaN(rarity) || rarity < 1 || rarity > 16) {
        return sendReply(msg.chat.id, msg.message_id, `❌ Rarity must be a number between 1 and 16! You provided: "${rarityStr}"`);
    }

    let fileId;
    let mediaType = 'photo';
    if (msg.reply_to_message.photo) {
        fileId = msg.reply_to_message.photo[msg.reply_to_message.photo.length - 1].file_id;
        mediaType = 'photo';
    } else if (msg.reply_to_message.video) {
        fileId = msg.reply_to_message.video.file_id;
        mediaType = 'video';
    } else if (msg.reply_to_message.animation) {
        fileId = msg.reply_to_message.animation.file_id;
        mediaType = 'animation';
    }

    try {
        const price = RARITY_PRICES[rarity] || 5000;

        console.log(`[UPLOAD] Inserting waifu: ${name}, ${anime}, rarity ${rarity}`);

        const result = await pool.query(
            'INSERT INTO waifus (name, anime, rarity, image_file_id, price, uploaded_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING waifu_id',
            [name, anime, rarity, fileId, price, userId]
        );

        const waifuId = result.rows[0].waifu_id;
        const uploadCaption = `Name: ${name}\nAnime: ${anime}\nRarity: ${RARITY_NAMES[rarity]}\nID: ${waifuId}\nPrice: ${price} 💸\nUploaded by: ${msg.from.first_name}`;
        const notificationCaption = `⚠️ 𝗧𝗛𝗜𝗦 𝗪𝗔𝗜𝗙𝗨 𝗛𝗔𝗦 𝗕𝗘𝗘𝗡 𝗨𝗣𝗟𝗢𝗔𝗗𝗘𝗗, 𝗡𝗢 𝗢𝗡𝗘 𝗦𝗛𝗢𝗨𝗟𝗗 𝗨𝗣𝗟𝗢𝗔𝗗 𝗜𝗧 𝗡𝗢𝗪.`;

        // Post to upload notification group (database channel)
        if (uploadNotificationGroup) {
            try {
                if (rarity === 16 || mediaType === 'video') {
                    await bot.sendVideo(uploadNotificationGroup, fileId, {
                        caption: uploadCaption,
                        parse_mode: 'HTML'
                    });
                } else if (mediaType === 'animation') {
                    await bot.sendAnimation(uploadNotificationGroup, fileId, {
                        caption: uploadCaption,
                        parse_mode: 'HTML'
                    });
                } else {
                    await bot.sendPhoto(uploadNotificationGroup, fileId, {
                        caption: uploadCaption,
                        parse_mode: 'HTML'
                    });
                }
                console.log('✅ Waifu posted to database channel');
            } catch (e) {
                console.error('❌ Database channel post error:', e);
            }
        }

        if (uploadNotificationGroup) {
            try {
                if (rarity === 16 || mediaType === 'video') {
                    await bot.sendVideo(uploadNotificationGroup, fileId, {
                        caption: notificationCaption,
                        parse_mode: 'HTML'
                    });
                } else if (mediaType === 'animation') {
                    await bot.sendAnimation(uploadNotificationGroup, fileId, {
                        caption: notificationCaption,
                        parse_mode: 'HTML'
                    });
                } else {
                    await bot.sendPhoto(uploadNotificationGroup, fileId, {
                        caption: notificationCaption,
                        parse_mode: 'HTML'
                    });
                }
            } catch (e) {
                console.error('Upload group post error:', e);
            }
        }

        const successCaption = `✅ <b>Waifu Successfully Added to Collection!</b>\n\n𝗡𝗔𝗠𝗘: ${name}\n𝗔𝗡𝗜𝗠𝗘: ${anime}\n𝗥𝗔𝗥𝗜𝗧𝗬: ${RARITY_NAMES[rarity]}\n𝗜𝗗: ${waifuId}\n𝗣𝗥𝗜𝗖𝗘: ${price}💸`;

        // Auto-save waifus and bot data after upload
        saveWaifusData().catch(console.error);
        saveBotData().catch(console.error);

        if (rarity === 16 || mediaType === 'video') {
            await bot.sendVideo(msg.chat.id, fileId, {
                caption: successCaption,
                parse_mode: 'HTML',
                reply_to_message_id: msg.message_id
            });
        } else if (mediaType === 'animation') {
            await bot.sendAnimation(msg.chat.id, fileId, {
                caption: successCaption,
                parse_mode: 'HTML',
                reply_to_message_id: msg.message_id
            });
        } else {
            await sendPhotoReply(msg.chat.id, msg.message_id, fileId, successCaption);
        }
    } catch (error) {
        console.error('❌ Upload error:', error.message, error.stack);
        sendReply(msg.chat.id, msg.message_id, `❌ Upload failed: ${error.message}\n\nCheck caption format!`);
    }
});

bot.onText(/\/delete(?:\s+(\d+))?/, async (msg, match) => {
    const userId = msg.from.id;

    if (!await hasRole(userId, 'dev')) {
        return sendReply(msg.chat.id, msg.message_id, '❌ Developer permission required!');
    }

    if (!match[1]) {
        return sendReply(msg.chat.id, msg.message_id, 'ᴘʟᴇᴀꜱᴇ ᴘʀᴏᴠɪᴅᴇ ᴀ ᴠᴀʟɪᴅ ɪᴅ ❌\n\nUsage: /delete <waifu_id>');
    }

    const waifuId = parseInt(match[1]);

    const waifu = await pool.query('SELECT * FROM waifus WHERE waifu_id = $1', [waifuId]);
    if (waifu.rows.length === 0) {
        return sendReply(msg.chat.id, msg.message_id, '❌ Waifu not found!');
    }

    await pool.query('DELETE FROM harem WHERE waifu_id = $1', [waifuId]);
    await pool.query('DELETE FROM waifus WHERE waifu_id = $1', [waifuId]);

    const users = await pool.query('SELECT DISTINCT user_id FROM harem');
    for (const u of users.rows) {
        await saveUserDataToFile(u.user_id);
    }
    
    // Auto-save all data after waifu deletion
    saveWaifusData().catch(console.error);
    saveUsersData().catch(console.error);
    saveBotData().catch(console.error);

    sendReply(msg.chat.id, msg.message_id, `✅ Deleted ${waifu.rows[0].name} from database and all user harems!`);
});

bot.onText(/\/dwaifu/, async (msg) => {
    if (!await checkUserAccess(msg)) return;

    const userId = msg.from.id;
    
    // ensureUser creates user if doesn't exist and returns user data
    const user = await ensureUser(userId, msg.from.username, msg.from.first_name);
    
    if (!user) {
        // Shouldn't happen, but safety check
        return sendReply(msg.chat.id, msg.message_id, '❌ Error creating user! Please try again.');
    }
    
    const now = new Date();
    
    // Handle NULL last_claim_date for new users (first time claiming) - skip cooldown check
    if (user.last_claim_date !== null && user.last_claim_date !== undefined) {
        try {
            const lastClaim = new Date(user.last_claim_date);
            
            // Only check cooldown if we have a valid date
            if (!isNaN(lastClaim.getTime())) {
                const hoursSinceLastClaim = (now - lastClaim) / (1000 * 60 * 60);
                
                if (hoursSinceLastClaim < 24) {
                    const hoursUntilClaim = Math.ceil(24 - hoursSinceLastClaim);
                    return sendReply(msg.chat.id, msg.message_id, `⏱️ Daily waifu already claimed! Available in ${hoursUntilClaim}h`);
                }
            }
        } catch (error) {
            // If date parsing fails, allow claim (better UX than blocking)
            console.error('Error parsing last_claim_date:', error);
        }
    }

    const waifu = await getRandomWaifu([1, 4]);
    if (!waifu) {
        return sendReply(msg.chat.id, msg.message_id, '❌ No waifus available yet!');
    }

    await pool.query('INSERT INTO harem (user_id, waifu_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [userId, waifu.waifu_id]);
    await pool.query('UPDATE users SET last_claim_date = CURRENT_DATE WHERE user_id = $1', [userId]);
    await saveUserDataToFile(userId);

    const message = `🎁 Daily Waifu Claimed!\n\n𝗡𝗔𝗠𝗘: ${waifu.name}\n𝗔𝗡𝗜𝗠𝗘: ${waifu.anime}\n𝗥𝗔𝗥𝗜𝗧𝗬: ${RARITY_NAMES[waifu.rarity]}`;

    if (waifu.image_file_id) {
        sendPhotoReply(msg.chat.id, msg.message_id, waifu.image_file_id, message);
    } else {
        sendReply(msg.chat.id, msg.message_id, message);
    }
});

bot.onText(/\/lock\s+(\d+)/, async (msg, match) => {
    const userId = msg.from.id;

    if (!await hasRole(userId, 'dev')) {
        return sendReply(msg.chat.id, msg.message_id, '❌ Developer permission required!');
    }

    const waifuId = parseInt(match[1]);

    const waifu = await pool.query('SELECT * FROM waifus WHERE waifu_id = $1', [waifuId]);
    if (waifu.rows.length === 0) {
        return sendReply(msg.chat.id, msg.message_id, '❌ Waifu not found!');
    }

    await pool.query('UPDATE waifus SET is_locked = NOT is_locked WHERE waifu_id = $1', [waifuId]);

    const updated = await pool.query('SELECT is_locked FROM waifus WHERE waifu_id = $1', [waifuId]);
    const status = updated.rows[0].is_locked ? 'locked' : 'unlocked';

    sendReply(msg.chat.id, msg.message_id, `✅ ${waifu.rows[0].name} is now ${status}!`);
});

bot.onText(/\/fav\s+(\d+)/, async (msg, match) => {
    if (!await checkUserAccess(msg)) return;

    const userId = msg.from.id;
    const waifuId = parseInt(match[1]);

    const owned = await pool.query('SELECT * FROM harem WHERE user_id = $1 AND waifu_id = $2', [userId, waifuId]);
    if (owned.rows.length === 0) {
        return sendReply(msg.chat.id, msg.message_id, "❌ You don't own this waifu!");
    }

    const waifu = await pool.query('SELECT * FROM waifus WHERE waifu_id = $1', [waifuId]);

    await pool.query('UPDATE users SET favorite_waifu_id = $1 WHERE user_id = $2', [waifuId, userId]);
    await saveUserDataToFile(userId);

    sendReply(msg.chat.id, msg.message_id, `⭐ Set ${waifu.rows[0].name} as your favorite!`);
});

// Helper function to send broadcast message with retry logic
async function sendBroadcastMessage(chatId, replyMsg, maxRetries = 3) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            if (replyMsg.text) {
                await bot.sendMessage(chatId, replyMsg.text);
            } else if (replyMsg.photo) {
                await bot.sendPhoto(chatId, replyMsg.photo[replyMsg.photo.length - 1].file_id, { caption: replyMsg.caption });
            } else if (replyMsg.video) {
                await bot.sendVideo(chatId, replyMsg.video.file_id, { caption: replyMsg.caption });
            } else if (replyMsg.sticker) {
                await bot.sendSticker(chatId, replyMsg.sticker.file_id);
            } else if (replyMsg.animation) {
                await bot.sendAnimation(chatId, replyMsg.animation.file_id, { caption: replyMsg.caption });
            } else if (replyMsg.audio) {
                await bot.sendAudio(chatId, replyMsg.audio.file_id, { caption: replyMsg.caption });
            } else if (replyMsg.document) {
                await bot.sendDocument(chatId, replyMsg.document.file_id, { caption: replyMsg.caption });
            }
            return { success: true };
        } catch (error) {
            const errorMsg = error.message || '';
            
            // Skip "user blocked by bot" or "chat not found" errors - don't retry these


// Store for dynamic start media
const startMediaList = [];

// /uploaddp command - Upload media for /start command
bot.onText(/\/uploaddp/, async (msg) => {
    const userId = msg.from.id;

    if (!await hasRole(userId, 'dev') && userId !== OWNER_ID) {
        return sendReply(msg.chat.id, msg.message_id, '❌ Developer permission required!');
    }

    if (!msg.reply_to_message || (!msg.reply_to_message.photo && !msg.reply_to_message.video)) {
        return sendReply(msg.chat.id, msg.message_id, '❌ Reply to a photo or video to add it to /start rotation!');
    }

    try {
        let fileId;
        let mediaType;

        if (msg.reply_to_message.photo) {
            fileId = msg.reply_to_message.photo[msg.reply_to_message.photo.length - 1].file_id;
            mediaType = 'photo';
        } else if (msg.reply_to_message.video) {
            fileId = msg.reply_to_message.video.file_id;
            mediaType = 'video';
        }

        // Store in database
        await pool.query(`
            CREATE TABLE IF NOT EXISTS start_media (
                id SERIAL PRIMARY KEY,
                file_id TEXT NOT NULL,
                media_type TEXT NOT NULL,
                uploaded_by BIGINT,
                created_at TIMESTAMP DEFAULT NOW()
            )
        `);

        await pool.query(
            'INSERT INTO start_media (file_id, media_type, uploaded_by) VALUES ($1, $2, $3)',
            [fileId, mediaType, userId]
        );

        sendReply(msg.chat.id, msg.message_id, `✅ ${mediaType === 'photo' ? 'Photo' : 'Video'} added to /start rotation!\n\nFile ID: <code>${fileId}</code>`);
    } catch (error) {
        console.error('Error in /uploaddp:', error);
        sendReply(msg.chat.id, msg.message_id, '❌ Error adding media. Try again!');
    }
});

            if (errorMsg.includes('blocked by user') || 
                errorMsg.includes('user is deleted') || 
                errorMsg.includes('chat not found') ||
                errorMsg.includes('CHAT_WRITE_FORBIDDEN')) {
                return { success: false, skip: true, reason: errorMsg };
            }

            // Rate limit - wait and retry
            if (error.response && error.response.statusCode === 429) {
                const retryAfter = error.response.body.parameters?.retry_after || 1;
                if (attempt < maxRetries) {
                    const backoffTime = Math.min(retryAfter * 1000 * attempt, 10000); // Exponential backoff max 10s
                    await new Promise(resolve => setTimeout(resolve, backoffTime));
                    continue;
                }
            }

            // Network or other errors - retry with exponential backoff
            if (attempt < maxRetries) {
                const backoffTime = Math.min(1000 * Math.pow(2, attempt - 1), 5000); // Exponential: 1s, 2s, 4s
                await new Promise(resolve => setTimeout(resolve, backoffTime));
                continue;
            }

            return { success: false, skip: false, reason: errorMsg };
        }
    }
    
    return { success: false, skip: false, reason: 'Max retries exceeded' };
}

bot.onText(/\/send/, async (msg) => {
    const userId = msg.from.id;

    if (!await hasRole(userId, 'dev') && userId !== OWNER_ID) {
        return sendReply(msg.chat.id, msg.message_id, '❌ Developer permission required!');
    }

    if (msg.chat.type !== 'private') {
        return sendReply(msg.chat.id, msg.message_id, '❌ This command only works in DM!');
    }

    if (!msg.reply_to_message) {
        return sendReply(msg.chat.id, msg.message_id, '❌ Reply to a message (text, photo, video, sticker) to broadcast it!');
    }

    const replyMsg = msg.reply_to_message;
    
    // Get groups
    const groups = await pool.query('SELECT DISTINCT group_id FROM group_settings');
    
    // Get all users (only those who have interacted with bot)
    const users = await pool.query('SELECT DISTINCT user_id FROM users WHERE user_id IS NOT NULL');

    let successCount = 0;
    let failCount = 0;
    let skippedCount = 0;

    sendReply(msg.chat.id, msg.message_id, `🔄 Broadcasting to ${groups.rows.length} groups and ${users.rows.length} users...\n\n⏳ This may take a few minutes...`);

    // Broadcast to groups with AGGRESSIVE rate limiting
    for (let i = 0; i < groups.rows.length; i++) {
        const group = groups.rows[i];
        const result = await sendBroadcastMessage(group.group_id, replyMsg, 5); // More retries
        
        if (result.success) {
            successCount++;
            console.log(`✅ Sent ${i+1}/${groups.rows.length} to group ${group.group_id}`);
        } else if (result.skip) {
            skippedCount++;
        } else {
            failCount++;
            console.error(`❌ Failed ${i+1}/${groups.rows.length} to group ${group.group_id}: ${result.reason}`);
        }

        // SLOWER rate limiting - prevents Telegram blocks
        if ((i + 1) % 10 === 0) {
            await new Promise(resolve => setTimeout(resolve, 3000)); // 3s break every 10
        } else {
            await new Promise(resolve => setTimeout(resolve, 250)); // 250ms between sends
        }
    }

    // Broadcast to user DMs with AGGRESSIVE rate limiting
    for (let i = 0; i < users.rows.length; i++) {
        const user = users.rows[i];
        const result = await sendBroadcastMessage(user.user_id, replyMsg, 5); // More retries
        
        if (result.success) {
            successCount++;
            console.log(`✅ Sent ${i+1}/${users.rows.length} to user ${user.user_id}`);
        } else if (result.skip) {
            skippedCount++;
        } else {
            failCount++;
            console.error(`❌ Failed ${i+1}/${users.rows.length} to user ${user.user_id}: ${result.reason}`);
        }

        // EVEN SLOWER for DMs
        if ((i + 1) % 8 === 0) {
            await new Promise(resolve => setTimeout(resolve, 4000)); // 4s break every 8
        } else {
            await new Promise(resolve => setTimeout(resolve, 300)); // 300ms between sends
        }
    }

    let resultMsg = `✅ Broadcast complete!\n\n✅ Sent: ${successCount}\n⏭️ Skipped: ${skippedCount}`;
    if (failCount > 0) {
        resultMsg += `\n❌ Failed: ${failCount}`;
    }
    
    sendReply(msg.chat.id, msg.message_id, resultMsg);
});

bot.onText(/\/fwd(?:\s+(.+))?/, async (msg, match) => {
    const userId = msg.from.id;

    if (userId !== OWNER_ID && !await hasRole(userId, 'dev')) {
        return sendReply(msg.chat.id, msg.message_id, '❌ Only the bot owner/developer can use the /fwd broadcast command.');
    }

    let broadcastMessage = null;
    let forwardMessage = null;
    let mediaMessage = null;

    if (msg.reply_to_message) {
        forwardMessage = msg.reply_to_message;
        // Check if it's a media message
        if (forwardMessage.photo || forwardMessage.video || forwardMessage.sticker || forwardMessage.animation || forwardMessage.audio || forwardMessage.document) {
            mediaMessage = true;
        }
    } else if (match[1]) {
        broadcastMessage = match[1];
    } else {
        return sendReply(msg.chat.id, msg.message_id, '❌ Usage: /fwd <message> or reply to any message (text, photo, video, sticker) with /fwd');
    }

    // Get groups
    const groups = await pool.query('SELECT DISTINCT group_id FROM group_settings');
    
    // Get all users (only those who have interacted with bot)
    const users = await pool.query('SELECT DISTINCT user_id FROM users WHERE user_id IS NOT NULL');

    let successCount = 0;
    let failCount = 0;
    let skippedCount = 0;

    sendReply(msg.chat.id, msg.message_id, `🔄 Broadcasting to ${groups.rows.length} groups and ${users.rows.length} users...\n\n⏳ This may take a few minutes...`);

    // Helper to send fwd message with retry
    const sendFwdMessage = async (chatId, maxRetries = 3) => {
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                if (forwardMessage) {
                    if (mediaMessage) {
                        if (forwardMessage.photo) {
                            await bot.sendPhoto(chatId, forwardMessage.photo[forwardMessage.photo.length - 1].file_id, { caption: forwardMessage.caption });
                        } else if (forwardMessage.video) {
                            await bot.sendVideo(chatId, forwardMessage.video.file_id, { caption: forwardMessage.caption });
                        } else if (forwardMessage.sticker) {
                            await bot.sendSticker(chatId, forwardMessage.sticker.file_id);
                        } else if (forwardMessage.animation) {
                            await bot.sendAnimation(chatId, forwardMessage.animation.file_id, { caption: forwardMessage.caption });
                        } else if (forwardMessage.audio) {
                            await bot.sendAudio(chatId, forwardMessage.audio.file_id, { caption: forwardMessage.caption });
                        } else if (forwardMessage.document) {
                            await bot.sendDocument(chatId, forwardMessage.document.file_id, { caption: forwardMessage.caption });
                        }
                    } else {
                        await bot.forwardMessage(chatId, msg.chat.id, forwardMessage.message_id);
                    }
                } else {
                    await bot.sendMessage(chatId, `📢 <b>Broadcast from Owner</b>\n\n${broadcastMessage}`, { parse_mode: 'HTML' });
                }
                return { success: true };
            } catch (error) {
                const errorMsg = error.message || '';
                
                // Skip "user blocked by bot" or "chat not found" errors
                if (errorMsg.includes('blocked by user') || 
                    errorMsg.includes('user is deleted') || 
                    errorMsg.includes('chat not found') ||
                    errorMsg.includes('CHAT_WRITE_FORBIDDEN')) {
                    return { success: false, skip: true };
                }

                // Rate limit - wait and retry
                if (error.response && error.response.statusCode === 429) {
                    const retryAfter = error.response.body.parameters?.retry_after || 1;
                    if (attempt < maxRetries) {
                        const backoffTime = Math.min(retryAfter * 1000 * attempt, 10000);
                        await new Promise(resolve => setTimeout(resolve, backoffTime));
                        continue;
                    }
                }

                // Network or other errors - retry
                if (attempt < maxRetries) {
                    const backoffTime = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
                    await new Promise(resolve => setTimeout(resolve, backoffTime));
                    continue;
                }

                return { success: false, skip: false };
            }
        }
        return { success: false, skip: false };
    };

    // Broadcast to groups
    for (let i = 0; i < groups.rows.length; i++) {
        const group = groups.rows[i];
        const result = await sendFwdMessage(group.group_id, 3);
        
        if (result.success) {
            successCount++;
        } else if (result.skip) {
            skippedCount++;
        } else {
            failCount++;
        }

        if ((i + 1) % 20 === 0) {
            await new Promise(resolve => setTimeout(resolve, 1000));
        } else {
            await new Promise(resolve => setTimeout(resolve, 100));
        }
    }

    // Broadcast to users
    for (let i = 0; i < users.rows.length; i++) {
        const user = users.rows[i];
        const result = await sendFwdMessage(user.user_id, 3);
        
        if (result.success) {
            successCount++;
        } else if (result.skip) {
            skippedCount++;
        } else {
            failCount++;
        }

        if ((i + 1) % 15 === 0) {
            await new Promise(resolve => setTimeout(resolve, 1500));
        } else {
            await new Promise(resolve => setTimeout(resolve, 150));
        }
    }

    let resultMsg = `✅ Broadcast complete!\n\n✅ Sent: ${successCount}\n⏭️ Skipped: ${skippedCount}`;
    if (failCount > 0) {
        resultMsg += `\n❌ Failed: ${failCount}`;
    }
    
    sendReply(msg.chat.id, msg.message_id, resultMsg);
});

bot.onText(/\/d\b(?:\s+(\d+))?/, async (msg, match) => {
    if (!match[1]) {
        return sendReply(msg.chat.id, msg.message_id, 'ᴘʟᴇᴀꜱᴇ ᴘʀᴏᴠɪᴅᴇ ᴀ ᴠᴀʟɪᴅ ɪᴅ ❌');
    }

    const waifuId = parseInt(match[1]);

    const waifu = await pool.query('SELECT * FROM waifus WHERE waifu_id = $1', [waifuId]);
    if (waifu.rows.length === 0) {
        return sendReply(msg.chat.id, msg.message_id, '❌ No waifu found with this ID.');
    }

    const w = waifu.rows[0];

    const huntCount = await pool.query('SELECT COUNT(DISTINCT user_id) FROM harem WHERE waifu_id = $1', [waifuId]);
    const totalHunts = parseInt(huntCount.rows[0].count);

    const topHunters = await pool.query(
        'SELECT u.user_id, u.first_name, u.username FROM harem h JOIN users u ON h.user_id = u.user_id WHERE h.waifu_id = $1 GROUP BY u.user_id, u.first_name, u.username ORDER BY u.user_id LIMIT 10',
        [waifuId]
    );

    let huntersList = '';
    topHunters.rows.forEach((hunter, i) => {
        const name = hunter.username ? `@${hunter.username}` : hunter.first_name;
        huntersList += `${i + 1}. ${name}\n`;
    });

    const message = `💠 𝗖𝗛𝗔𝗥𝗔𝗖𝗧𝗘𝗥 𝗜𝗡𝗙𝗢:\n┏━━━━━━━━━━━━━⧫\n◈𝗡𝗔𝗠𝗘: ${w.name}\n◈𝗥𝗔𝗥𝗜𝗧𝗬: ${RARITY_NAMES[w.rarity] || 'Unknown'}\n◈𝗔𝗡𝗜𝗠𝗘: ${w.anime}\n┗━━━━━━━━━━━━━⧫\n\n𝕋𝕆ℙ ℍ𝕌ℕ𝕋𝔼ℝ𝕊 (${totalHunts})📊\n\n${huntersList || 'No hunters yet'}`;

    if (w.image_file_id) {
        // For rarity 16 (AMV) or if it's a video/animation, try sending as video/animation
        try {
            if (w.rarity === 16) {
                await bot.sendAnimation(msg.chat.id, w.image_file_id, {
                    caption: message,
                    parse_mode: 'HTML',
                    reply_to_message_id: msg.message_id,
                    has_spoiler: true
                });
            } else {
                await bot.sendPhoto(msg.chat.id, w.image_file_id, {
                    caption: message,
                    parse_mode: 'HTML',
                    reply_to_message_id: msg.message_id,
                    has_spoiler: true
                });
            }
        } catch (error) {
            // If sending as animation fails, try as photo
            try {
                await bot.sendPhoto(msg.chat.id, w.image_file_id, {
                    caption: message,
                    parse_mode: 'HTML',
                    reply_to_message_id: msg.message_id,
                    has_spoiler: true
                });
            } catch (e) {
                // If both fail, send as text
                sendReply(msg.chat.id, msg.message_id, message);
            }
        }
    } else {
        sendReply(msg.chat.id, msg.message_id, message);
    }
});



bot.onText(/\/redeem\s+(.+)/, async (msg, match) => {
    if (!await checkUserAccess(msg)) return;

    const userId = msg.from.id;
    const code = match[1].trim().toUpperCase();

    const codeData = await pool.query('SELECT * FROM redeem_codes WHERE code = $1', [code]);
    if (codeData.rows.length === 0) {
        return sendReply(msg.chat.id, msg.message_id, '❌ Invalid code!');
    }

    const c = codeData.rows[0];

    if (c.uses >= c.quantity) {
        return sendReply(msg.chat.id, msg.message_id, '❌ Code has been fully redeemed!');
    }

    if (c.code_type === 'cash') {
        await pool.query('UPDATE users SET berries = berries + $1 WHERE user_id = $2', [c.amount, userId]);
        await pool.query('UPDATE redeem_codes SET uses = uses + 1 WHERE code = $1', [code]);
        await saveUserDataToFile(userId);

        const remainingUses = c.quantity - (c.uses + 1);
        const redeemMsg = `✅ᴄᴏᴅᴇ ʀᴇᴅᴇᴇᴍᴇᴅ! \n💸 ${c.amount} ᴄᴀsʜ ᴀᴅᴅᴇᴅ ᴛᴏ ʏᴏᴜʀ ʙᴀʟᴀɴᴄᴇ. \n📦ʀᴇᴍᴀɪɴɪɴɢ ᴜsᴇs: ${remainingUses}`;
        sendReply(msg.chat.id, msg.message_id, redeemMsg);
    } else if (c.code_type === 'waifu') {
        const waifu = await pool.query('SELECT * FROM waifus WHERE waifu_id = $1', [c.waifu_id]);
        if (waifu.rows.length === 0) {
            return sendReply(msg.chat.id, msg.message_id, '❌ Waifu not found!');
        }

        await pool.query('INSERT INTO harem (user_id, waifu_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [userId, c.waifu_id]);
        await pool.query('UPDATE redeem_codes SET uses = uses + 1 WHERE code = $1', [code]);
        await saveUserDataToFile(userId);

        const remainingUses = c.quantity - (c.uses + 1);
        const waifuMsg = `🎉ᴄʜᴀʀᴀᴄᴛᴇʀ ʀᴇᴅᴇᴇᴍᴇᴅ sᴜᴄᴄᴇssғᴜʟʏ! \n🦋𝗡𝗔𝗠𝗘: ${waifu.rows[0].name}\n🆔𝗜𝗗: ${waifu.rows[0].waifu_id}\n✨𝗥𝗔𝗥𝗜𝗧𝗬: ${RARITY_NAMES[waifu.rows[0].rarity]}\n🔄𝗥𝗘𝗠𝗔𝗜𝗡𝗜𝗡𝗚 𝗨𝗦𝗘𝗦: ${remainingUses}`;
        sendReply(msg.chat.id, msg.message_id, waifuMsg);
    }
});

bot.onText(/\/dredeem\s+(.+)/, async (msg, match) => {
    if (!await checkUserAccess(msg)) return;

    const userId = msg.from.id;
    const code = match[1].trim().toUpperCase();

    const codeData = await pool.query('SELECT * FROM redeem_codes WHERE code = $1', [code]);
    if (codeData.rows.length === 0) {
        return sendReply(msg.chat.id, msg.message_id, '❌ Code not found!');
    }

    const c = codeData.rows[0];

    if (c.uses >= c.quantity) {
        return sendReply(msg.chat.id, msg.message_id, '❌ Code has been fully redeemed!');
    }

    if (c.code_type === 'cash') {
        await pool.query('UPDATE users SET berries = berries + $1 WHERE user_id = $2', [c.amount, userId]);
        await pool.query('UPDATE redeem_codes SET uses = uses + 1 WHERE code = $1', [code]);
        await saveUserDataToFile(userId);

        const remainingUses = c.quantity - (c.uses + 1);
        const redeemMsg = `✅ᴄᴏᴅᴇ ʀᴇᴅᴇᴇᴍᴇᴅ! \n💸 ${c.amount} ᴄᴀsʜ ᴀᴅᴅᴇᴅ ᴛᴏ ʏᴏᴜʀ ʙᴀʟᴀɴᴄᴇ. \n📦ʀᴇᴍᴀɪɴɪɴɢ ᴜsᴇs: ${remainingUses}`;
        sendReply(msg.chat.id, msg.message_id, redeemMsg);
    } else if (c.code_type === 'waifu') {
        const waifu = await pool.query('SELECT * FROM waifus WHERE waifu_id = $1', [c.waifu_id]);
        if (waifu.rows.length === 0) {
            return sendReply(msg.chat.id, msg.message_id, '❌ Waifu not found!');
        }

        await pool.query('INSERT INTO harem (user_id, waifu_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [userId, c.waifu_id]);
        await pool.query('UPDATE redeem_codes SET uses = uses + 1 WHERE code = $1', [code]);
        await saveUserDataToFile(userId);

        const remainingUses = c.quantity - (c.uses + 1);
        const waifuMsg = `🎉ᴄʜᴀʀᴀᴄᴛᴇʀ ʀᴇᴅᴇᴇᴍᴇᴅ sᴜᴄᴄᴇssғᴜʟʏ! \n🦋𝗡𝗔𝗠𝗘: ${waifu.rows[0].name}\n🆔𝗜𝗗: ${waifu.rows[0].waifu_id}\n✨𝗥𝗔𝗥𝗜𝗧𝗬: ${RARITY_NAMES[waifu.rows[0].rarity]}\n🔄𝗥𝗘𝗠𝗔𝗜𝗡𝗜𝗡𝗚 𝗨𝗦𝗘𝗦: ${remainingUses}`;
        sendReply(msg.chat.id, msg.message_id, waifuMsg);
    }
});

bot.onText(/\/chtime/, async (msg) => {
    if (!await checkUserAccess(msg)) return;

    const userId = msg.from.id;
    await ensureUser(userId, msg.from.username, msg.from.first_name);

    const cooldowns = await pool.query('SELECT command, last_used FROM cooldowns WHERE user_id = $1', [userId]);

    let message = '⏰ <b>Your Cooldown Status:</b>\n\n';

    const now = new Date();
    const cooldownTimes = {
        'explore': 60,
        'marry': 3600
    };

    if (cooldowns.rows.length === 0) {
        message += '✅ All commands are ready to use!';
    } else {
        let hasCooldowns = false;
        for (const cd of cooldowns.rows) {
            const lastUsed = new Date(cd.last_used);
            const requiredCooldown = cooldownTimes[cd.command];

            if (!requiredCooldown) continue;

            const elapsed = Math.floor((now - lastUsed) / 1000);
            const remaining = Math.max(0, requiredCooldown - elapsed);

            if (remaining > 0) {
                hasCooldowns = true;
                const minutes = Math.floor(remaining / 60);
                const seconds = remaining % 60;
                message += `/${cd.command}: ${minutes}m ${seconds}s remaining\n`;
            } else {
                message += `/${cd.command}: ✅ Ready\n`;
            }
        }

        if (!hasCooldowns) {
            message = '⏰ <b>Your Cooldown Status:</b>\n\n✅ All commands are ready to use!';
        }
    }

    sendReply(msg.chat.id, msg.message_id, message);
});

bot.onText(/\/changetime/, async (msg) => {
    const userId = msg.from.id;

    if (!await hasRole(userId, 'dev')) {
        return sendReply(msg.chat.id, msg.message_id, '❌ Developer permission required!');
    }

    if (!msg.reply_to_message) {
        return sendReply(msg.chat.id, msg.message_id, '❌ Reply to a user to reset their cooldowns!');
    }

    const targetId = msg.reply_to_message.from.id;

    await pool.query('DELETE FROM cooldowns WHERE user_id = $1', [targetId]);

    sendReply(msg.chat.id, msg.message_id, `✅ Reset all cooldowns for ${msg.reply_to_message.from.first_name}!`);
});

const bazaarState = new Map();

bot.onText(/\/bazaar/, async (msg) => {
    const userId = msg.from.id;
    const chatId = msg.chat.id;

    const storeWaifus = await pool.query(
        'SELECT * FROM waifus WHERE is_locked = FALSE AND rarity NOT IN (6, 7, 13) ORDER BY RANDOM() LIMIT 3'
    );

    if (storeWaifus.rows.length === 0) {
        return sendReply(chatId, msg.message_id, '🏪 Bazaar is empty! Come back later.');
    }

    bazaarState.set(userId, { waifus: storeWaifus.rows, currentIndex: 0 });

    await showBazaarCard(chatId, msg.message_id, userId);
});

bot.onText(/\/delcode\s+(.+)/, async (msg, match) => {
    const userId = msg.from.id;

    if (!await hasRole(userId, 'dev')) {
        return sendReply(msg.chat.id, msg.message_id, '❌ Developer permission required!');
    }

    const code = match[1].trim().toUpperCase();

    const result = await pool.query('DELETE FROM redeem_codes WHERE code = $1 RETURNING *', [code]);

    if (result.rowCount === 0) {
        return sendReply(msg.chat.id, msg.message_id, '❌ Code not found!');
    }

    sendReply(msg.chat.id, msg.message_id, `✅ Deleted redeem code: <code>${code}</code>`);
});

async function showBazaarCard(chatId, replyToId, userId, editMessageId = null) {
    const state = bazaarState.get(userId);
    if (!state) return;

    const waifu = state.waifus[state.currentIndex];
    if (!waifu) return;

    const price = RARITY_PRICES[waifu.rarity] || 5000;

    const owned = await pool.query('SELECT COUNT(*) FROM harem WHERE user_id = $1 AND waifu_id = $2', [userId, waifu.waifu_id]);
    const ownCount = parseInt(owned.rows[0].count);

    const currentPage = state.currentIndex + 1;
    const totalPages = state.waifus.length;

    let message = `🏪 <b>BAZAAR (Page ${currentPage}/${totalPages})</b>\n\n`;
    message += `NAME: ${waifu.name}\n`;
    message += `ANIME: ${waifu.anime}\n`;
    message += `RARITY: ${RARITY_NAMES[waifu.rarity]}\n`;
    message += `ID: ${waifu.waifu_id}\n`;
    message += `PRICE: ${price} 💸\n`;
    message += `YOU OWN: ${ownCount}\n`;

    const keyboard = {
        inline_keyboard: [
            [{ text: '🎟️ Buy', callback_data: `bazaar_buy_${waifu.waifu_id}_${userId}` }]
        ]
    };

    const navRow = [];
    navRow.push({ text: '⬅️ Back', callback_data: `bazaar_back_${userId}` });
    navRow.push({ text: 'Next ➡️', callback_data: `bazaar_next_${userId}` });

    keyboard.inline_keyboard.push(navRow);
    keyboard.inline_keyboard.push([{ text: '♻️ Refresh', callback_data: `bazaar_refresh_${userId}` }]);
    keyboard.inline_keyboard.push([{ text: '✖️ Close', callback_data: 'delete_message' }]);

    if (editMessageId) {
        // Edit existing message
        if (waifu.image_file_id) {
            try {
                await bot.editMessageMedia({
                    type: 'photo',
                    media: waifu.image_file_id,
                    caption: message,
                    parse_mode: 'HTML',
                    has_spoiler: true
                }, {
                    chat_id: chatId,
                    message_id: editMessageId,
                    reply_markup: keyboard
                });
            } catch (e) {
                // If edit fails, try caption only
                try {
                    await bot.editMessageCaption(message, {
                        chat_id: chatId,
                        message_id: editMessageId,
                        parse_mode: 'HTML',
                        reply_markup: keyboard
                    });
                } catch (e2) {}
            }
        }
        state.messageId = editMessageId;
    } else {
        // Send new message
        let sentMsg;
        if (waifu.image_file_id) {
            sentMsg = await bot.sendPhoto(chatId, waifu.image_file_id, {
                caption: message,
                parse_mode: 'HTML',
                has_spoiler: true,
                reply_markup: keyboard
            });
        } else {
            sentMsg = await bot.sendMessage(chatId, message, {
                parse_mode: 'HTML',
                reply_markup: keyboard
            });
        }

        state.messageId = sentMsg.message_id;

        setTimeout(async () => {
            try {
                await bot.deleteMessage(chatId, sentMsg.message_id);
                bazaarState.delete(userId);
            } catch (e) {}
        }, 600000);
    }
}

bot.on('callback_query', async (query) => {
    if (query.data.startsWith('bazaar_buy_')) {
        const parts = query.data.split('_');
        const waifuId = parseInt(parts[2]);
        const targetUserId = parseInt(parts[3]);
        const userId = query.from.id;

        if (userId !== targetUserId) {
            return bot.answerCallbackQuery(query.id, { text: '❌ This is not your bazaar session!', show_alert: true });
        }

        const waifu = await pool.query('SELECT * FROM waifus WHERE waifu_id = $1', [waifuId]);
        if (waifu.rows.length === 0) {
            return bot.answerCallbackQuery(query.id, { text: '❌ Waifu not found!', show_alert: true });
        }

        const price = RARITY_PRICES[waifu.rows[0].rarity] || 5000;
        const user = await pool.query('SELECT berries FROM users WHERE user_id = $1', [userId]);

        if (user.rows.length === 0 || user.rows[0].berries < price) {
            return bot.answerCallbackQuery(query.id, { text: '❌ Insufficient cash!', show_alert: true });
        }

        await pool.query('UPDATE users SET berries = berries - $1 WHERE user_id = $2', [price, userId]);
        await pool.query('INSERT INTO harem (user_id, waifu_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [userId, waifuId]);
        await ensureUser(userId, query.from.username, query.from.first_name);
        await saveUserDataToFile(userId);

        await bot.answerCallbackQuery(query.id, { text: 'THANK YOU FOR BUYING ❤️🔥', show_alert: true });

        try {
            await bot.editMessageCaption(`✅ THANK YOU FOR BUYING ❤️🔥\n\nYou bought ${waifu.rows[0].name} for ${price}💸!\n\nCheck your /harem now! 🦋`, {
                chat_id: query.message.chat.id,
                message_id: query.message.message_id,
                parse_mode: 'HTML'
            });
        } catch (e) {
            console.error('Edit message error:', e);
        }

        bazaarState.delete(userId);
        return;
    } else if (query.data.startsWith('bazaar_next_')) {
        const targetUserId = parseInt(query.data.split('_')[2]);
        const userId = query.from.id;

        if (userId !== targetUserId) {
            return bot.answerCallbackQuery(query.id, { text: '❌ This is not your bazaar session!', show_alert: true });
        }

        const state = bazaarState.get(userId);
        if (state) {
            state.currentIndex = (state.currentIndex + 1) % state.waifus.length;
            await showBazaarCard(query.message.chat.id, null, userId, query.message.message_id);
        }
        bot.answerCallbackQuery(query.id);
    } else if (query.data.startsWith('bazaar_back_')) {
        const targetUserId = parseInt(query.data.split('_')[2]);
        const userId = query.from.id;

        if (userId !== targetUserId) {
            return bot.answerCallbackQuery(query.id, { text: '❌ This is not your bazaar session!', show_alert: true });
        }

        const state = bazaarState.get(userId);
        if (state) {
            state.currentIndex = (state.currentIndex - 1 + state.waifus.length) % state.waifus.length;
            await showBazaarCard(query.message.chat.id, null, userId, query.message.message_id);
        }
        bot.answerCallbackQuery(query.id);
    } else if (query.data.startsWith('bazaar_refresh_')) {
        const targetUserId = parseInt(query.data.split('_')[2]);
        const userId = query.from.id;

        if (userId !== targetUserId) {
            return bot.answerCallbackQuery(query.id, { text: '❌ This is not your bazaar session!', show_alert: true });
        }

        const storeWaifus = await pool.query(
            'SELECT * FROM waifus WHERE is_locked = FALSE ORDER BY RANDOM() LIMIT 3'
        );

        if (storeWaifus.rows.length === 0) {
            return bot.answerCallbackQuery(query.id, { text: 'Bazaar is empty!', show_alert: true });
        }

        bazaarState.set(userId, { waifus: storeWaifus.rows, currentIndex: 0, messageId: query.message.message_id });
        await showBazaarCard(query.message.chat.id, null, userId, query.message.message_id);
        bot.answerCallbackQuery(query.id, { text: '♻️ Bazaar refreshed!' });
    }
});



bot.onText(/\/buy\s+(\d+)/, async (msg, match) => {
    if (!await checkUserAccess(msg)) return;

    const userId = msg.from.id;
    const itemId = parseInt(match[1]);

    const item = await pool.query(
        'SELECT b.*, w.name FROM bazaar_items b JOIN waifus w ON b.waifu_id = w.waifu_id WHERE b.item_id = $1 AND b.status = $2',
        [itemId, 'active']
    );

    if (item.rows.length === 0) {
        return sendReply(msg.chat.id, msg.message_id, '❌ Item not found or already sold!');
    }

    const i = item.rows[0];

    if (i.seller_id === userId) {
        return sendReply(msg.chat.id, msg.message_id, "❌ Can't buy your own item!");
    }

    const buyer = await pool.query('SELECT berries FROM users WHERE user_id = $1', [userId]);
    if (buyer.rows[0].berries < i.price) {
        return sendReply(msg.chat.id, msg.message_id, '❌ Insufficient cash!');
    }

    await pool.query('UPDATE users SET berries = berries - $1 WHERE user_id = $2', [i.price, userId]);
    await pool.query('UPDATE users SET berries = berries + $1 WHERE user_id = $2', [i.price, i.seller_id]);
    await pool.query('INSERT INTO harem (user_id, waifu_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [userId, i.waifu_id]);
    await pool.query('DELETE FROM harem WHERE user_id = $1 AND waifu_id = $2', [i.seller_id, i.waifu_id]);
    await pool.query("UPDATE bazaar_items SET status = 'sold' WHERE item_id = $1", [itemId]);
    await saveUserDataToFile(userId);
    await saveUserDataToFile(i.seller_id);

    sendReply(msg.chat.id, msg.message_id, `✅ Purchased ${i.name} for ${i.price} 💸 ᴄᴀꜱʜ!`);
});

bot.onText(/\/auction(?:\s+(\d+)\s+(\d+))?/, async (msg, match) => {
    if (!await checkUserAccess(msg)) return;

    const userId = msg.from.id;

    if (!match[1] || !match[2]) {
        const activeAuctions = await pool.query(
            `SELECT b.*, w.name, w.anime, w.rarity, u.username, u.first_name 
             FROM bazaar_items b 
             JOIN waifus w ON b.waifu_id = w.waifu_id 
             JOIN users u ON b.seller_id = u.user_id 
             WHERE b.status = 'active' 
             ORDER BY b.listed_at DESC 
             LIMIT 5`
        );

        if (activeAuctions.rows.length === 0) {
            return sendReply(msg.chat.id, msg.message_id, '📭 No waifu auctions right now.');
        }

        let message = '🔨 <b>Active Auctions</b>\n\n';
        activeAuctions.rows.forEach((item, i) => {
            const seller = item.username ? `@${item.username}` : item.first_name;
            message += `${i + 1}. <b>${item.name}</b> - ${item.anime}\n`;
            message += `   Rarity: ${RARITY_NAMES[item.rarity]}\n`;
            message += `   Price: ${item.price} 💸\n`;
            message += `   Seller: ${seller}\n\n`;
        });

        message += 'Use /auction <waifu_id> <price> to list your waifu';

        return sendReply(msg.chat.id, msg.message_id, message);
    }

    const waifuId = parseInt(match[1]);
    const price = parseInt(match[2]);

    if (price <= 0) {
        return sendReply(msg.chat.id, msg.message_id, '❌ Price must be positive!');
    }

    const owned = await pool.query('SELECT * FROM harem WHERE user_id = $1 AND waifu_id = $2', [userId, waifuId]);
    if (owned.rows.length === 0) {
        return sendReply(msg.chat.id, msg.message_id, "❌ You don't own this waifu!");
    }

    const waifu = await pool.query('SELECT * FROM waifus WHERE waifu_id = $1', [waifuId]);

    await pool.query('INSERT INTO bazaar_items (waifu_id, seller_id, price) VALUES ($1, $2, $3)', [waifuId, userId, price]);

    sendReply(msg.chat.id, msg.message_id, `✅ Listed ${waifu.rows[0].name} for ${price} 💸 ᴄᴀꜱʜ in the bazaar!`);
});

bot.on("message", async (msg) => { try {
    if (!msg.chat || msg.chat.type === 'private') return;
    if (msg.from.is_bot) return;
    if (msg.text && msg.text.startsWith('/')) return;

    const groupId = msg.chat.id;

    await pool.query(
        'INSERT INTO group_settings (group_id) VALUES ($1) ON CONFLICT (group_id) DO NOTHING',
        [groupId]
    );

    await pool.query(
        'INSERT INTO spawn_tracker (group_id, message_count) VALUES ($1, 0) ON CONFLICT (group_id) DO NOTHING',
        [groupId]
    );

    const tracker = await pool.query('SELECT * FROM spawn_tracker WHERE group_id = $1', [groupId]);

    const currentCount = tracker.rows[0].message_count + 1;
    const activeSpawn = tracker.rows[0].active_spawn_waifu_id;

    if (activeSpawn && currentCount >= 150) {
        const bidData = await pool.query('SELECT * FROM group_bids WHERE group_id = $1', [groupId]);

        if (bidData.rows.length > 0) {
            const bid = bidData.rows[0];
            const waifu = await pool.query('SELECT * FROM waifus WHERE waifu_id = $1', [bid.waifu_id]);

            if (bid.current_bidder_id) {
                await pool.query('UPDATE users SET berries = berries - $1 WHERE user_id = $2', [bid.current_bid, bid.current_bidder_id]);
                await pool.query('INSERT INTO harem (user_id, waifu_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [bid.current_bidder_id, bid.waifu_id]);
                await ensureUser(bid.current_bidder_id, null, 'Bidder');
                await saveUserDataToFile(bid.current_bidder_id);

                const winner = await pool.query('SELECT first_name FROM users WHERE user_id = $1', [bid.current_bidder_id]);
                await bot.sendMessage(groupId, `🎉 Auction ended! ${winner.rows[0].first_name} won ${waifu.rows[0].name} for ${bid.current_bid} 💸 ᴄᴀꜱʜ!`);
            } else {
                await bot.sendMessage(groupId, `❌ Auction ended with no bids for ${waifu.rows[0].name}.`);
            }

            await pool.query('DELETE FROM group_bids WHERE group_id = $1', [groupId]);
        }

        await pool.query('UPDATE spawn_tracker SET message_count = 0, active_spawn_waifu_id = NULL, bid_message_count = 0 WHERE group_id = $1', [groupId]);
        return;
    }

    if (!activeSpawn && currentCount >= 100) {
        // CRITICAL: Use transaction to prevent race condition (16 waifus bug)
        // Only ONE spawn per 100 messages - STRICTLY enforce with database lock
        const result = await pool.query(
            'UPDATE spawn_tracker SET active_spawn_waifu_id = -999, message_count = 0 WHERE group_id = $1 AND active_spawn_waifu_id IS NULL AND message_count >= 100 RETURNING *',
            [groupId]
        );
        
        // Only spawn if we successfully locked the group (exactly 1 update)
        if (result.rows.length > 0) {
            const waifu = await getRandomWaifu([1, 13]);

            if (waifu) {
                let message = `🎊 A wild waifu appeared!\n\nUse /grab to claim!`;

                if (waifu.image_file_id) {
                    await bot.sendPhoto(groupId, waifu.image_file_id, { 
                        caption: message,
                        has_spoiler: true
                    });
                } else {
                    await bot.sendMessage(groupId, message);
                }

                // Set actual spawn waifu (replace lock value -999)
                await pool.query('UPDATE spawn_tracker SET active_spawn_waifu_id = $1, active_spawn_name = $2 WHERE group_id = $3', [waifu.waifu_id, waifu.name, groupId]);
            }
        }
    } else {
        // ALWAYS update message_count (whether spawn is active or not)
        // This ensures counter keeps incrementing
        await pool.query('UPDATE spawn_tracker SET message_count = $1 WHERE group_id = $2', [currentCount, groupId]);
    }
} catch (err) { 
    console.error("[Message Handler Error]", err.message); 
}
});

bot.onText(/\/grab(?:\s+(.+))?/, async (msg, match) => {
    if (msg.chat.type === 'private') return;
    if (!await checkUserAccess(msg)) return;

    const userId = msg.from.id;
    const groupId = msg.chat.id;

    const tracker = await pool.query('SELECT * FROM spawn_tracker WHERE group_id = $1', [groupId]);

    if (tracker.rows.length === 0 || !tracker.rows[0].active_spawn_waifu_id) {
        return sendReply(msg.chat.id, msg.message_id, '❌ No active spawn! Wait for a waifu to appear.');
    }

    const activeBid = await pool.query('SELECT * FROM group_bids WHERE group_id = $1', [groupId]);
    if (activeBid.rows.length > 0) {
        return sendReply(msg.chat.id, msg.message_id, '❌ Auction is active! Use /bid to participate.');
    }

    const waifuId = tracker.rows[0].active_spawn_waifu_id;
    const spawnedName = tracker.rows[0].active_spawn_name;

    if (!spawnedName) {
        return sendReply(msg.chat.id, msg.message_id, '❌ Spawn data corrupted! Please wait for next spawn.');
    }

    if (!match || !match[1]) {
        return sendReply(msg.chat.id, msg.message_id, `❌ Please provide the waifu name! Use: /grab <name or part of name>`);
    }

    const guess = match[1].trim().toLowerCase();
    const actualName = spawnedName.toLowerCase();
    
    // Split the actual name into parts (words)
    const nameParts = actualName.split(/\s+/);
    
    // Check if guess matches the full name OR any individual part of the name
    // Also allow partial matches (first 3+ chars matching start of any part)
    const isMatch = guess === actualName || 
                    nameParts.some(part => part === guess) ||
                    (guess.length >= 3 && nameParts.some(part => part.startsWith(guess)));

    if (!isMatch) {
        return sendReply(msg.chat.id, msg.message_id, `❌ Wrong name! Try using the full name or any part of it (first, middle, or last name).`);
    }

    const waifu = await pool.query('SELECT * FROM waifus WHERE waifu_id = $1', [waifuId]);

    if (waifu.rows.length === 0) {
        return sendReply(msg.chat.id, msg.message_id, '❌ Waifu not found!');
    }

    const w = waifu.rows[0];

    await pool.query('INSERT INTO harem (user_id, waifu_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [userId, waifuId]);
    await pool.query('UPDATE spawn_tracker SET active_spawn_waifu_id = NULL, active_spawn_name = NULL, message_count = 0 WHERE group_id = $1', [groupId]);
    await ensureUser(userId, msg.from.username, msg.from.first_name);
    await saveUserDataToFile(userId);
    
    // Auto-save users data after grab
    saveUsersData().catch(console.error);

    const userName = msg.from.first_name;

    const grabMessage = `✨ <b>𝐂𝐎𝐍𝐆𝐑𝐀𝐓𝐔𝐋𝐀𝐓𝐈𝐎𝐍𝐒 🎉</b>\n${userName}\n•➵࿐•┈────┈•\n┊╰•➢ ɴᴀᴍᴇ: ${w.name}\n┊╰•➢ ᴀɴɪᴍᴇ: ${w.anime}\n╰─•➢ ʀᴀʀɪᴛʏ: ${RARITY_NAMES[w.rarity]}\n╰─•➢ 𝗜ᴅ: ${w.waifu_id}\n💫 ʏᴏᴜ ɢʀᴀʙʙᴇᴅ ᴀ ɴᴇᴡ ᴡᴀɪғᴜ\nᴄʜᴇᴄᴋ ɪɴ ʏᴏᴜʀ /harem ɴᴏᴡ 🦋`;

    sendReply(msg.chat.id, msg.message_id, grabMessage);
});



bot.onText(/\/propose(?:\s+(\d+))?/, async (msg, match) => {
    if (!await checkUserAccess(msg)) return;

    const userId = msg.from.id;
    const user = await ensureUser(userId, msg.from.username, msg.from.first_name);

    // If no waifu_id provided, show error
    if (!match[1]) {
        return sendReply(msg.chat.id, msg.message_id, '❌ Please provide a waifu ID!\n\nUsage: /propose <waifu_id>');
    }

    const waifuId = parseInt(match[1]);

    // Get the waifu
    const waifuResult = await pool.query('SELECT * FROM waifus WHERE waifu_id = $1', [waifuId]);
    if (waifuResult.rows.length === 0) {
        return sendReply(msg.chat.id, msg.message_id, '❌ Waifu not found!');
    }

    const waifu = waifuResult.rows[0];

    // Check if waifu is already married
    const marriageCheck = await pool.query('SELECT * FROM harem WHERE waifu_id = $1 AND user_id != $2', [waifuId, userId]);
    if (marriageCheck.rows.length > 0) {
        return sendReply(msg.chat.id, msg.message_id, `❌ This waifu is already married!`);
    }

    // Check if user has enough currency (25k for proposal)
    const PROPOSAL_COST = 25000;
    if (user.berries < PROPOSAL_COST) {
        return sendReply(msg.chat.id, msg.message_id, `❌ You need ${PROPOSAL_COST} 💸 to propose\n\nYou have: ${user.berries} 💸`);
    }

    // 70% success rate
    const success = Math.random() < 0.70;

    if (!success) {
        return sendReply(msg.chat.id, msg.message_id, `💔 𝗣𝗥𝗢𝗣𝗢𝗦𝗔𝗟 𝗥𝗘𝗝𝗘𝗖𝗧𝗘𝗗!\n\n${waifu.name} rejected your proposal... Try again later!`);
    }

    // Deduct cost and add waifu to harem
    await pool.query('UPDATE users SET berries = berries - $1 WHERE user_id = $2', [PROPOSAL_COST, userId]);
    await pool.query('INSERT INTO harem (user_id, waifu_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [userId, waifuId]);
    await saveUserDataToFile(userId);

    const message = `💍 𝗣𝗥𝗢𝗣𝗢𝗦𝗔𝗟 𝗔𝗖𝗖𝗘𝗣𝗧𝗘𝗗!\n\n✨ You successfully proposed to ${waifu.name}!\n💸 Cost: -${PROPOSAL_COST} 💸\n\n💝 Congratulations on your marriage! 🎉`;

    if (waifu.image_file_id) {
        try {
            await bot.sendPhoto(msg.chat.id, waifu.image_file_id, {
                caption: message,
                parse_mode: 'HTML',
                reply_to_message_id: msg.message_id
            });
        } catch (error) {
            sendReply(msg.chat.id, msg.message_id, message);
        }
    } else {
        sendReply(msg.chat.id, msg.message_id, message);
    }
});

bot.onText(/\/dprofile/, async (msg) => {
    let targetUser;
    let userId;

    if (msg.reply_to_message && msg.reply_to_message.from) {
        targetUser = msg.reply_to_message.from;
        userId = targetUser.id;
    } else {
        targetUser = msg.from;
        userId = targetUser.id;
    }

    const user = await ensureUser(userId, targetUser.username, targetUser.first_name);

    const haremCount = await pool.query('SELECT COUNT(*) FROM harem WHERE user_id = $1', [userId]);
    const total = parseInt(haremCount.rows[0].count);

    const favCount = await pool.query('SELECT COUNT(*) FROM harem WHERE user_id = $1 AND waifu_id = $2', [userId, user.favorite_waifu_id || 0]);


    const favorites = user.favorite_waifu_id ? 1 : 0;

    const displayName = targetUser.first_name || 'Unknown';
    const username = targetUser.username ? `@${targetUser.username}` : 'N/A';

    let message = `🏷️ 𝗨𝗦𝗘𝗥 𝗣𝗥𝗢𝗙𝗜𝗟𝗘:\n`;
    message += `┏━━━━━━━━━━━━━⧫\n`;
    message += `◈𝗡𝗔𝗠𝗘: ${displayName}\n`;
    message += `◈𝗨𝗦𝗘𝗥𝗡𝗔𝗠𝗘: ${username}\n`;
    message += `◈𝗨𝗦𝗘𝗥 𝗜𝗗: ${userId}\n`;
    message += `┣━━━━━━━━━━━━━⧫\n`;
    message += `◈𝗖𝗔𝗦𝗛: 💸 ${user.berries}\n`;
    message += `┣━━━━━━━━━━━━━⧫\n`;
    message += `◈𝗖𝗛𝗔𝗥𝗔𝗖𝗧𝗘𝗥𝗦: ${total}\n`;
    message += `◈𝗙𝗔𝗩𝗢𝗥𝗜𝗧𝗘𝗦: ${favorites}\n`;
    message += `┗━━━━━━━━━━━━━⧫`;

    try {
        const photos = await bot.getUserProfilePhotos(userId, { limit: 1 });
        if (photos.total_count > 0 && photos.photos.length > 0) {
            const fileId = photos.photos[0][0].file_id;
            await bot.sendPhoto(msg.chat.id, fileId, {
                caption: message,
                parse_mode: 'HTML',
                reply_to_message_id: msg.message_id
            });
        } else {
            sendReply(msg.chat.id, msg.message_id, message);
        }
    } catch (error) {
        sendReply(msg.chat.id, msg.message_id, message);
    }
});

bot.onText(/\/lock\s+(\d+)/, async (msg, match) => {
    const userId = msg.from.id;

    if (!await hasRole(userId, 'dev')) {
        return sendReply(msg.chat.id, msg.message_id, '❌ Developer permission required!');
    }

    const waifuId = parseInt(match[1]);

    const waifu = await pool.query('SELECT * FROM waifus WHERE waifu_id = $1', [waifuId]);
    if (waifu.rows.length === 0) {
        return sendReply(msg.chat.id, msg.message_id, '❌ Waifu not found!');
    }

    await pool.query('UPDATE waifus SET is_locked = NOT is_locked WHERE waifu_id = $1', [waifuId]);

    const updated = await pool.query('SELECT is_locked FROM waifus WHERE waifu_id = $1', [waifuId]);
    const status = updated.rows[0].is_locked ? 'locked' : 'unlocked';

    sendReply(msg.chat.id, msg.message_id, `✅ ${waifu.rows[0].name} is now ${status}!`);
});



// ==================== WELCOME MESSAGE FOR NEW MEMBERS ====================
bot.on('new_chat_members', async (msg) => {
    try {
        const chatId = msg.chat.id;
        const newMembers = msg.new_chat_members;

        for (const member of newMembers) {
            if (member.is_bot) continue; // Skip bots

            const userName = member.username ? `@${member.username}` : 'N/A';
            const firstName = member.first_name || 'Unknown';
            const userId = member.id;

            const welcomeText = `✨🌸 𝐖𝐄𝐋𝐂𝐎𝐌𝐄 𝐓𝐎 𝐀𝐐𝐔𝐀 𝐑𝐄𝐀𝐋𝐌 🌸✨  
  
❤️ 𝗨𝗦𝗘𝗥𝗡𝗔𝗠𝗘: ${userName}  
💝𝗡𝗔𝗠𝗘: ${firstName}
💛𝗜𝗗: ${userId}
  
𝐖𝐄𝐋𝐂𝐎𝐌𝐄 𝐓𝐎 𝐓𝐇𝐄 𝐌𝐀𝐆𝐈𝐂𝐀𝐋 𝐖𝐎𝐑𝐋𝐃 𝐎𝐅 𝐀𝐐𝐔𝐀 𝐑𝐄𝐀𝐋𝐌 ⚡💫  
𝐖𝐇𝐄𝐑𝐄 𝐖𝐀𝐈𝐅𝐔𝐒 𝐋𝐈𝐕𝐄, 𝐁𝐀𝐓𝐓𝐋𝐄𝐒 𝐇𝐀𝐏𝐏𝐄𝐍, 𝐀𝐍𝐃 𝐋𝐄𝐆𝐄𝐍𝐃𝐒 𝐀𝐑𝐄 𝐁𝐎𝐑𝐍 🔥❤️  
  
🔱 𝐓𝐇𝐈𝐒 𝐈𝐒 𝐀𝐐𝐔𝐀 𝐖𝐀𝐈𝐅𝐔 𝐁𝐎𝐓 🤖💙  
  
➤ 𝐄𝐏𝐈𝐂 𝐁𝐀𝐓𝐓𝐋𝐄𝐒 ⚔️  
➤ 𝐃𝐀𝐈𝐋𝐘 𝐑𝐄𝐖𝐀𝐑𝐃𝐒 💰  
➤ 𝐑𝐀𝐑𝐄 𝐖𝐀𝐈𝐅𝐔𝐒 💕  
➤ 𝐅𝐔𝐍, 𝐕𝐈𝐁𝐄𝐒 & 𝐂𝐇𝐀𝐎𝐒 😎🎉  
  
🛡️ 𝐇𝐄𝐋𝐏 & 𝐒𝐔𝐏𝐏𝐎𝐑𝐓:  

𝗧𝗛𝗘𝗚𝗔𝗠𝗘𝗥𝗔𝗗𝗘𝗣𝗧🫀🜲ᴀ×ᴡ 𓆩🖤𓆪

𝙉𝙊𝘽𝙄𝙏𝘼🜲ᴀ×ᴡ 𓆩🖤𓆪

𝙻𝚄𝙵𝙵𝚈 🜲ᴀ×ᴡ 𓆩🖤𓆪  
  
⚠️ 𝐑𝐔𝐋𝐄𝐒:  
• 𝐒𝐓𝐀𝐘 𝐑𝐄𝐒𝐏𝐄𝐂𝐓𝐅𝐔𝐋  
• 𝐍𝐎 𝐒𝐏𝐀𝐌  
• 𝐄𝐍𝐉𝐎𝐘 𝐓𝐇𝐄 𝐕𝐈𝐁𝐄𝐒 🔥  
  
🌸 𝐄𝐍𝐉𝐎𝐘 𝐘𝐎𝐔𝐑 𝐒𝐓𝐀𝐘 𝐈𝐍 𝐀𝐐𝐔𝐀 𝐑𝐄𝐀𝐋𝐌, 𝐖𝐀𝐑𝐑𝐈𝐎𝐑! 🌸`;

            const keyboard = {
                inline_keyboard: [
                    [{ text: '📢 UPDATES', url: 'https://t.me/AQUAxUPDATES' }],
                    [{ text: '🤖 START BOT', url: 'https://t.me/Aqua_waifu_bot?start=welcome' }],
                    [{ text: '👥 JOIN GROUP', url: 'https://t.me/AQUA_REALM' }]
                ]
            };

            try {
                await bot.sendVideo(chatId, 'https://screenapp.io/app/v/sITVky_nYR', {
                    caption: welcomeText,
                    parse_mode: 'HTML',
                    reply_markup: keyboard
                });
            } catch (videoError) {
                // Fallback to text if video fails
                await bot.sendMessage(chatId, welcomeText, {
                    parse_mode: 'HTML',
                    reply_markup: keyboard
                });
            }
        }
    } catch (error) {
        console.error('Welcome message error:', error);
    }
});

bot.onText(/\/tgm/, async (msg) => {
    const userId = msg.from.id;

    if (!await hasRole(userId, 'uploader') && !await hasRole(userId, 'sudo') && !await hasRole(userId, 'dev')) {
        return sendReply(msg.chat.id, msg.message_id, '❌ Uploader permission required!');
    }

    if (!msg.reply_to_message || (!msg.reply_to_message.photo && !msg.reply_to_message.video)) {
        return sendReply(msg.chat.id, msg.message_id, '❌ Reply to a photo or video to get the file_id!');
    }

    try {
        let fileId;
        let fileType;

        if (msg.reply_to_message.photo) {
            fileId = msg.reply_to_message.photo[msg.reply_to_message.photo.length - 1].file_id;
            fileType = 'Photo';
        } else if (msg.reply_to_message.video) {
            fileId = msg.reply_to_message.video.file_id;
            fileType = 'Video';
        }

        sendReply(msg.chat.id, msg.message_id, `📎 <b>${fileType} File ID:</b>\n\n<code>${fileId}</code>\n\n💡 Use this with /update command:\n<code>/update &lt;waifu_id&gt; image_url ${fileId}</code>`);
    } catch (error) {
        console.error('TGM error:', error);
        sendReply(msg.chat.id, msg.message_id, '❌ Failed to process file. Please try again.');
    }
});

bot.onText(/\/update\s+(\d+)\s+(image_url|anime|name|rarity)\s+(.+)/, async (msg, match) => {
    const userId = msg.from.id;

    if (!await hasRole(userId, 'dev') && !await hasRole(userId, 'uploader')) {
        return sendReply(msg.chat.id, msg.message_id, '❌ Developer or Uploader permission required!');
    }

    const waifuId = parseInt(match[1]);
    const field = match[2];
    const value = match[3].trim();

    const waifu = await pool.query('SELECT * FROM waifus WHERE waifu_id = $1', [waifuId]);
    if (waifu.rows.length === 0) {
        return sendReply(msg.chat.id, msg.message_id, '❌ Waifu not found!');
    }

    const oldWaifu = waifu.rows[0];

    try {
        if (field === 'image_url') {
            await pool.query('UPDATE waifus SET image_file_id = $1 WHERE waifu_id = $2', [value, waifuId]);

            const updatedWaifu = await pool.query('SELECT * FROM waifus WHERE waifu_id = $1', [waifuId]);
            const w = updatedWaifu.rows[0];

            if (w.image_file_id) {
                await sendPhotoReply(msg.chat.id, msg.message_id, w.image_file_id, 
                    `✅ Image updated successfully!\n\n𝗡𝗔𝗠𝗘: ${w.name}\n𝗔𝗡𝗜𝗠𝗘: ${w.anime}\n𝗥𝗔𝗥𝗜𝗧𝗬: ${RARITY_NAMES[w.rarity]}\n𝗜𝗗: ${w.waifu_id}`
                );
            }
        } else if (field === 'anime') {
            await pool.query('UPDATE waifus SET anime = $1 WHERE waifu_id = $2', [value, waifuId]);
            sendReply(msg.chat.id, msg.message_id, `✅ Anime updated from "${oldWaifu.anime}" to "${value}"`);
        } else if (field === 'name') {
            await pool.query('UPDATE waifus SET name = $1 WHERE waifu_id = $2', [value, waifuId]);
            sendReply(msg.chat.id, msg.message_id, `✅ Name updated from "${oldWaifu.name}" to "${value}"`);
        } else if (field === 'rarity') {
            const rarity = parseInt(value);
            if (isNaN(rarity) || rarity < 1 || rarity > 16) {
                return sendReply(msg.chat.id, msg.message_id, '❌ Rarity must be between 1 and 16!');
            }
            const price = RARITY_PRICES[rarity] || 5000;
            await pool.query('UPDATE waifus SET rarity = $1, price = $2 WHERE waifu_id = $3', [rarity, price, waifuId]);
            sendReply(msg.chat.id, msg.message_id, `✅ Rarity updated from ${RARITY_NAMES[oldWaifu.rarity]} to ${RARITY_NAMES[rarity]}\nPrice updated to ${price} 💸`);
        }

        const users = await pool.query('SELECT DISTINCT user_id FROM harem WHERE waifu_id = $1', [waifuId]);
        for (const u of users.rows) {
            await saveUserDataToFile(u.user_id);
        }
    } catch (error) {
        console.error('Update error:', error);
        sendReply(msg.chat.id, msg.message_id, `❌ Failed to update waifu: ${error.message}`);
    }
});

bot.onText(/\/rfind\s+(\d+)(?:\s+(\d+))?/, async (msg, match) => {
    const rarity = parseInt(match[1]);
    const page = parseInt(match[2]) || 1;
    const limit = 20;
    const offset = (page - 1) * limit;

    if (isNaN(rarity) || rarity < 1 || rarity > 16) {
        return sendReply(msg.chat.id, msg.message_id, '❌ Rarity must be between 1 and 16!');
    }

    const waifus = await pool.query(
        'SELECT * FROM waifus WHERE rarity = $1 ORDER BY name LIMIT $2 OFFSET $3',
        [rarity, limit, offset]
    );

    const count = await pool.query('SELECT COUNT(*) FROM waifus WHERE rarity = $1', [rarity]);
    const total = parseInt(count.rows[0].count);

    if (total === 0) {
        return sendReply(msg.chat.id, msg.message_id, `❌ No waifus found with rarity ${RARITY_NAMES[rarity]}`);
    }

    const totalPages = Math.ceil(total / limit);
    let message = `🔍 <b>Waifus with ${RARITY_NAMES[rarity]} (Page ${page}/${totalPages})</b>\n\n`;

    waifus.rows.forEach((w, i) => {
        message += `${offset + i + 1}. ${w.name} - ${w.anime} (ID: ${w.waifu_id})\n`;
    });

    message += `\nTotal: ${total} waifus`;

    const keyboard = {
        inline_keyboard: []
    };

    if (page > 1) {
        keyboard.inline_keyboard.push([{ text: '⬅️ Previous', callback_data: `rfind_${rarity}_${page - 1}` }]);
    }

    if (page < totalPages) {
        if (keyboard.inline_keyboard.length === 0) {
            keyboard.inline_keyboard.push([{ text: 'Next ➡️', callback_data: `rfind_${rarity}_${page + 1}` }]);
        } else {
            keyboard.inline_keyboard[0].push({ text: 'Next ➡️', callback_data: `rfind_${rarity}_${page + 1}` });
        }
    }

    sendReply(msg.chat.id, msg.message_id, message, { reply_markup: keyboard.inline_keyboard.length > 0 ? keyboard : undefined });
});

bot.onText(/\/find\s+(.+?)(?:\s+(\d+))?$/, async (msg, match) => {
    const searchName = match[1].trim();
    const page = parseInt(match[2]) || 1;
    const limit = 20;
    const offset = (page - 1) * limit;

    const waifus = await pool.query(
        'SELECT * FROM waifus WHERE LOWER(name) LIKE LOWER($1) ORDER BY rarity, name LIMIT $2 OFFSET $3',
        [`%${searchName}%`, limit, offset]
    );

    const count = await pool.query(
        'SELECT COUNT(*) FROM waifus WHERE LOWER(name) LIKE LOWER($1)',
        [`%${searchName}%`]
    );
    const total = parseInt(count.rows[0].count);

    if (total === 0) {
        return sendReply(msg.chat.id, msg.message_id, `❌ No waifus found matching "${searchName}"`);
    }

    const totalPages = Math.ceil(total / limit);
    let message = `🔍 <b>Search Results for "${searchName}" (Page ${page}/${totalPages})</b>\n\n`;

    let currentRarity = null;
    waifus.rows.forEach((w) => {
        if (currentRarity !== w.rarity) {
            currentRarity = w.rarity;
            message += `\n<b>${RARITY_NAMES[w.rarity]}</b>\n`;
        }
        message += `${w.name} - ${w.anime} (ID: ${w.waifu_id})\n`;
    });

    message += `\nTotal: ${total} results`;

    const keyboard = {
        inline_keyboard: []
    };

    if (page > 1) {
        keyboard.inline_keyboard.push([{ text: '⬅️ Previous', callback_data: `find_${Buffer.from(searchName).toString('base64')}_${page - 1}` }]);
    }

    if (page < totalPages) {
        if (keyboard.inline_keyboard.length === 0) {
            keyboard.inline_keyboard.push([{ text: 'Next ➡️', callback_data: `find_${Buffer.from(searchName).toString('base64')}_${page + 1}` }]);
        } else {
            keyboard.inline_keyboard[0].push({ text: 'Next ➡️', callback_data: `find_${Buffer.from(searchName).toString('base64')}_${page + 1}` });
        }
    }

    sendReply(msg.chat.id, msg.message_id, message, { reply_markup: keyboard.inline_keyboard.length > 0 ? keyboard : undefined });
});

bot.on('callback_query', async (query) => {
    if (query.data.startsWith('rfind_')) {
        const parts = query.data.split('_');
        const rarity = parseInt(parts[1]);
        const page = parseInt(parts[2]);

        const limit = 20;
        const offset = (page - 1) * limit;

        const waifus = await pool.query(
            'SELECT * FROM waifus WHERE rarity = $1 ORDER BY name LIMIT $2 OFFSET $3',
            [rarity, limit, offset]
        );

        const count = await pool.query('SELECT COUNT(*) FROM waifus WHERE rarity = $1', [rarity]);
        const total = parseInt(count.rows[0].count);
        const totalPages = Math.ceil(total / limit);

        let message = `🔍 <b>Waifus with ${RARITY_NAMES[rarity]} (Page ${page}/${totalPages})</b>\n\n`;

        waifus.rows.forEach((w, i) => {
            message += `${offset + i + 1}. ${w.name} - ${w.anime} (ID: ${w.waifu_id})\n`;
        });

        message += `\nTotal: ${total} waifus`;

        const keyboard = {
            inline_keyboard: []
        };

        if (page > 1) {
            keyboard.inline_keyboard.push([{ text: '⬅️ Previous', callback_data: `rfind_${rarity}_${page - 1}` }]);
        }

        if (page < totalPages) {
            if (keyboard.inline_keyboard.length === 0) {
                keyboard.inline_keyboard.push([{ text: 'Next ➡️', callback_data: `rfind_${rarity}_${page + 1}` }]);
            } else {
                keyboard.inline_keyboard[0].push({ text: 'Next ➡️', callback_data: `rfind_${rarity}_${page + 1}` });
            }
        }

        try {
            await bot.editMessageText(message, {
                chat_id: query.message.chat.id,
                message_id: query.message.message_id,
                parse_mode: 'HTML',
                reply_markup: keyboard.inline_keyboard.length > 0 ? keyboard : undefined
            });
        } catch (e) {}

        bot.answerCallbackQuery(query.id);
    } else if (query.data.startsWith('find_')) {
        const parts = query.data.split('_');
        const searchName = Buffer.from(parts[1], 'base64').toString('utf-8');
        const page = parseInt(parts[2]);

        const limit = 20;
        const offset = (page - 1) * limit;

        const waifus = await pool.query(
            'SELECT * FROM waifus WHERE LOWER(name) LIKE LOWER($1) ORDER BY rarity, name LIMIT $2 OFFSET $3',
            [`%${searchName}%`, limit, offset]
        );

        const count = await pool.query(
            'SELECT COUNT(*) FROM waifus WHERE LOWER(name) LIKE LOWER($1)',
            [`%${searchName}%`]
        );
        const total = parseInt(count.rows[0].count);
        const totalPages = Math.ceil(total / limit);

        let message = `🔍 <b>Search Results for "${searchName}" (Page ${page}/${totalPages})</b>\n\n`;

        let currentRarity = null;
        waifus.rows.forEach((w) => {
            if (currentRarity !== w.rarity) {
                currentRarity = w.rarity;
                message += `\n<b>${RARITY_NAMES[w.rarity]}</b>\n`;
            }
            message += `${w.name} - ${w.anime} (ID: ${w.waifu_id})\n`;
        });

        message += `\nTotal: ${total} results`;

        const keyboard = {
            inline_keyboard: []
        };

        if (page > 1) {
            keyboard.inline_keyboard.push([{ text: '⬅️ Previous', callback_data: `find_${Buffer.from(searchName).toString('base64')}_${page - 1}` }]);
        }

        if (page < totalPages) {
            if (keyboard.inline_keyboard.length === 0) {
                keyboard.inline_keyboard.push([{ text: 'Next ➡️', callback_data: `find_${Buffer.from(searchName).toString('base64')}_${page + 1}` }]);
            } else {
                keyboard.inline_keyboard[0].push({ text: 'Next ➡️', callback_data: `find_${Buffer.from(searchName).toString('base64')}_${page + 1}` });
            }
        }

        try {
            await bot.editMessageText(message, {
                chat_id: query.message.chat.id,
                message_id: query.message.message_id,
                parse_mode: 'HTML',
                reply_markup: keyboard.inline_keyboard.length > 0 ? keyboard : undefined
            });
        } catch (e) {}

        bot.answerCallbackQuery(query.id);
    }
});

bot.onText(/\/goal(?:\s+(.+))?/, async (msg, match) => {
    if (!await checkUserAccess(msg)) return;

    const userId = msg.from.id;
    
    try {
        await ensureUser(userId, msg.from.username, msg.from.first_name);

        // Create table if doesn't exist
        await pool.query(`
            CREATE TABLE IF NOT EXISTS user_goals (
                user_id BIGINT PRIMARY KEY,
                description TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT NOW()
            )
        `);

        if (!match[1]) {
            const goal = await pool.query('SELECT description FROM user_goals WHERE user_id = $1', [userId]);
            if (goal.rows.length === 0) {
                return sendReply(msg.chat.id, msg.message_id, '❌ No goal set! Use: /goal <your goal>');
            }
            return sendReply(msg.chat.id, msg.message_id, `🎯 Your Goal:\n\n${goal.rows[0].description}`);
        }

        const goalText = match[1].trim();
        if (!goalText || goalText.length === 0) {
            return sendReply(msg.chat.id, msg.message_id, '❌ Enter a valid goal!');
        }
        if (goalText.length > 500) {
            return sendReply(msg.chat.id, msg.message_id, '❌ Too long! Max 500 characters.');
        }
        
        await pool.query(
            'INSERT INTO user_goals (user_id, description) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET description = $2',
            [userId, goalText]
        );

        sendReply(msg.chat.id, msg.message_id, `✅ Goal set!\n\n🎯 ${goalText}`);
    } catch (error) {
        console.error('❌ /goal error:', error.message);
        sendReply(msg.chat.id, msg.message_id, `❌ Error: ${error.message}`);
    }
});

bot.onText(/\/savedata/, async (msg) => {
    const userId = msg.from.id;

    if (!await hasRole(userId, 'dev')) {
        return sendReply(msg.chat.id, msg.message_id, '❌ Developer permission required!');
    }

    sendReply(msg.chat.id, msg.message_id, '🔄 Saving all data files...');

    try {
        await saveAllData();
        sendReply(msg.chat.id, msg.message_id, '✅ All data files saved successfully!\n\n📁 Files created:\n• data_files/bot_data.json\n• data_files/waifus_data.json\n• data_files/users_data.json');
    } catch (error) {
        sendReply(msg.chat.id, msg.message_id, `❌ Error saving data: ${error.message}`);
    }
});

bot.onText(/\/lock\s+(\d+)/, async (msg, match) => {
    const userId = msg.from.id;

    if (!await hasRole(userId, 'dev')) {
        return sendReply(msg.chat.id, msg.message_id, '❌ Developer permission required!');
    }

    const waifuId = parseInt(match[1]);

    const waifu = await pool.query('SELECT * FROM waifus WHERE waifu_id = $1', [waifuId]);
    if (waifu.rows.length === 0) {
        return sendReply(msg.chat.id, msg.message_id, '❌ Waifu not found!');
    }

    await pool.query('UPDATE waifus SET is_locked = NOT is_locked WHERE waifu_id = $1', [waifuId]);

    const updated = await pool.query('SELECT is_locked FROM waifus WHERE waifu_id = $1', [waifuId]);
    const status = updated.rows[0].is_locked ? 'locked' : 'unlocked';

    sendReply(msg.chat.id, msg.message_id, `✅ ${waifu.rows[0].name} is now ${status}!`);
});

bot.onText(/\/add_cash\s+(\d+)\s+(\d+)/, async (msg, match) => {
    const userId = msg.from.id;
    const targetUserId = parseInt(match[1]);
    const amount = BigInt(match[2]);

    if (!await hasRole(userId, 'dev') && !await hasRole(userId, 'sudo')) {
        return sendReply(msg.chat.id, msg.message_id, '❌ Developer or Sudo permission required!');
    }

    if (amount <= 0) {
        return sendReply(msg.chat.id, msg.message_id, '❌ Amount must be positive!');
    }

    const targetUser = await pool.query('SELECT * FROM users WHERE user_id = $1', [targetUserId]);
    if (targetUser.rows.length === 0) {
        return sendReply(msg.chat.id, msg.message_id, '❌ Target user not found!');
    }

    await pool.query('UPDATE users SET berries = berries + $1 WHERE user_id = $2', [amount.toString(), targetUserId]);
    await saveUserDataToFile(targetUserId);

    sendReply(msg.chat.id, msg.message_id, `✅ Added ${amount} 💸 ᴄᴀꜱʜ to ${targetUser.rows[0].first_name}!`);
});

bot.onText(/\/add_waifu\s+(\d+)\s+(\d+)/, async (msg, match) => {
    const userId = msg.from.id;
    const targetUserId = parseInt(match[1]);
    const waifuId = parseInt(match[2]);

    if (!await hasRole(userId, 'dev') && !await hasRole(userId, 'sudo')) {
        return sendReply(msg.chat.id, msg.message_id, '❌ Developer or Sudo permission required!');
    }

    const targetUser = await pool.query('SELECT * FROM users WHERE user_id = $1', [targetUserId]);
    if (targetUser.rows.length === 0) {
        return sendReply(msg.chat.id, msg.message_id, '❌ Target user not found!');
    }

    const waifu = await pool.query('SELECT * FROM waifus WHERE waifu_id = $1', [waifuId]);
    if (waifu.rows.length === 0) {
        return sendReply(msg.chat.id, msg.message_id, '❌ Waifu not found!');
    }

    await pool.query('INSERT INTO harem (user_id, waifu_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [targetUserId, waifuId]);
    await saveUserDataToFile(targetUserId);

    sendReply(msg.chat.id, msg.message_id, `✅ Gave ${waifu.rows[0].name} to ${targetUser.rows[0].first_name}!`);
});

// Bot Status Commands
bot.onText(/\/on/, async (msg) => {
    const userId = msg.from.id;

    if (!await hasRole(userId, 'dev')) {
        return sendReply(msg.chat.id, msg.message_id, '❌ Developer permission required!');
    }

    console.log(`🟢 Bot status requested by ${msg.from.first_name}`);
    sendReply(msg.chat.id, msg.message_id, `🟢 <b>Bot Status: ONLINE</b>\n\n✅ Bot is running and ready!\n\n📊 Commands: 40+\n🎮 Players: Active\n💾 Database: Connected`);
});

bot.onText(/\/off/, async (msg) => {
    const userId = msg.from.id;

    if (!await hasRole(userId, 'dev')) {
        return sendReply(msg.chat.id, msg.message_id, '❌ Developer permission required!');
    }

    console.log(`🔴 Bot shutdown requested by ${msg.from.first_name}`);
    sendReply(msg.chat.id, msg.message_id, `🔴 <b>Bot Shutting Down...</b>\n\n💾 Saving all data...\n📝 Users: Saved\n🎴 Waifus: Saved\n✅ Graceful shutdown initiated!`);

    // Save all data
    setTimeout(async () => {
        try {
            await saveWaifusData();
            await saveUsersData();
            await saveBotData();
            console.log('✅ All data saved before shutdown');
        } catch (e) {
            console.error('❌ Error saving data:', e);
        }

        // Exit gracefully
        console.log('🛑 Bot process exiting...');
        process.exit(0);
    }, 2000);
});

bot.onText(/\/status/, async (msg) => {
    const userId = msg.from.id;

    try {
        const userCount = await pool.query('SELECT COUNT(*) as count FROM users');
        const waifuCount = await pool.query('SELECT COUNT(*) as count FROM waifus');
        const haremCount = await pool.query('SELECT COUNT(*) as count FROM harem');

        const status = `🎮 <b>Bot Status Report</b>\n\n` +
            `✅ Status: <b>ONLINE & RUNNING</b>\n\n` +
            `📊 <b>Statistics:</b>\n` +
            `👥 Users: ${userCount.rows[0].count}\n` +
            `🎴 Waifus: ${waifuCount.rows[0].count}\n` +
            `💕 Harem Entries: ${haremCount.rows[0].count}\n\n` +
            `🕐 Uptime: Active\n` +
            `💾 Database: Connected\n` +
            `🟢 All systems: Operational`;

        sendReply(msg.chat.id, msg.message_id, status);
    } catch (error) {
        console.error('Status check error:', error);
        sendReply(msg.chat.id, msg.message_id, '❌ Error retrieving status!');
    }
});

// /restart command - sudo users can restart bot process
bot.onText(/\/restart/, async (msg) => {
    const userId = msg.from.id;

    if (!await hasRole(userId, 'sudo') && !await hasRole(userId, 'dev') && userId !== OWNER_ID) {
        return sendReply(msg.chat.id, msg.message_id, '❌ Sudo permission required!');
    }

    console.log(`🔄 Bot restart requested by ${msg.from.first_name} (${userId})`);
    sendReply(msg.chat.id, msg.message_id, `🔄 <b>RESTARTING BOT...</b>\n\n💾 Saving all data...\n✅ Data saved\n🔄 Restarting bot process...\n\n⏳ Bot will be back online in 5 seconds!`);

    // Save all data
    setTimeout(async () => {
        try {
            await saveWaifusData();
            await saveUsersData();
            await saveBotData();
            console.log('✅ All data saved before restart');
        } catch (e) {
            console.error('❌ Error saving data:', e);
        }

        // Restart the process
        console.log('🔄 Restarting bot process...');
        process.exit(0);
    }, 1000);
});

// /give_data @username command - sudo users can restore user data after /gban
bot.onText(/\/give_data\s+(.+)/, async (msg, match) => {
    const userId = msg.from.id;

    if (!await hasRole(userId, 'sudo') && !await hasRole(userId, 'dev') && userId !== OWNER_ID) {
        return sendReply(msg.chat.id, msg.message_id, '❌ Sudo permission required!');
    }

    const args = match[1].split(' ');
    const target = await getTargetUser(msg, args);

    if (!target.targetId) {
        return sendReply(msg.chat.id, msg.message_id, '❌ Reply to a user or provide username/ID!');
    }

    try {
        // Remove user from banned list
        await pool.query('DELETE FROM banned_users WHERE user_id = $1', [target.targetId]);

        // Restore basic user data
        const userResult = await pool.query('SELECT * FROM users WHERE user_id = $1', [target.targetId]);
        
        if (userResult.rows.length === 0) {
            // Create user if doesn't exist
            await pool.query(
                'INSERT INTO users (user_id, username, first_name, berries, daily_streak, weekly_streak) VALUES ($1, $2, $3, 0, 0, 0)',
                [target.targetId, target.targetName, target.targetName]
            );
        } else {
            // Restore berries and streaks (reset to 0 if needed)
            await pool.query(
                'UPDATE users SET berries = berries + 10000 WHERE user_id = $1',
                [target.targetId]
            );
        }

        // Restore some waifus (give 5 random common/rare waifus)
        const waifu1 = await pool.query('SELECT waifu_id FROM waifus WHERE rarity IN (1,2) ORDER BY RANDOM() LIMIT 5');
        for (const waifu of waifu1.rows) {
            await pool.query('INSERT INTO harem (user_id, waifu_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [target.targetId, waifu.waifu_id]);
        }

        // Save data
        await saveUserDataToFile(target.targetId);

        sendReply(msg.chat.id, msg.message_id, `✅ <b>Data Restored for ${target.targetName}!</b>\n\n🤝 User unbanned\n💸 10,000 ᴄᴀꜱʜ added\n🎴 5 waifus restored\n\n✨ User can now use bot again!`);
        console.log(`✅ Data restored for ${target.targetName} (${target.targetId})`);
    } catch (error) {
        console.error('Error restoring data:', error);
        sendReply(msg.chat.id, msg.message_id, '❌ Error restoring data. Try again!');
    }
});


// ==================== TREASURE COMMAND (20k cash required) ====================
bot.onText(/\/treasure/, async (msg) => {
    if (!await checkUserAccess(msg)) return;

    const userId = msg.from.id;
    const chatId = msg.chat.id;
    const TREASURE_COST = 20000;

    try {
        // Ensure treasure_state table exists
        await pool.query(`
            CREATE TABLE IF NOT EXISTS treasure_state (
                user_id BIGINT PRIMARY KEY,
                winning_position INT NOT NULL,
                gems_amount INT NOT NULL DEFAULT 1,
                created_at TIMESTAMP DEFAULT NOW()
            )
        `);

        const user = await ensureUser(userId, msg.from.username, msg.from.first_name);

        // Check if user has enough cash
        if (user.berries < TREASURE_COST) {
            return sendReply(chatId, msg.message_id, `❌ You need ${TREASURE_COST.toLocaleString()} 💸 ᴄᴀꜱʜ to play treasure hunt!\n\nYou have: ${user.berries.toLocaleString()} 💸`);
        }

        // Deduct cost
        await pool.query('UPDATE users SET berries = berries - $1 WHERE user_id = $2', [TREASURE_COST, userId]);
        await saveUserDataToFile(userId);

        // Generate random winning position (1-4)
        const winningPosition = Math.floor(Math.random() * 4) + 1;
        const gems = Math.floor(Math.random() * 3) + 1; // 1-3 gems

        // Store winning position for this user
        await pool.query(
            'INSERT INTO treasure_state (user_id, winning_position, gems_amount) VALUES ($1, $2, $3) ON CONFLICT (user_id) DO UPDATE SET winning_position = $2, gems_amount = $3',
            [userId, winningPosition, gems]
        );

        const keyboard = {
            inline_keyboard: [
                [
                    { text: '1️⃣', callback_data: `treasure_${userId}_1` },
                    { text: '2️⃣', callback_data: `treasure_${userId}_2` },
                    { text: '3️⃣', callback_data: `treasure_${userId}_3` },
                    { text: '4️⃣', callback_data: `treasure_${userId}_4` }
                ]
            ]
        };

        // Treasure hunt start image (excitement)
        const treasureMsg = `💎✨ <b>TREASURE HUNT!</b> ✨💎\n\nᴏᴍғᴏᴏ ᴛᴇʀɪ ᴋɪsᴍᴀᴛ 😍☠\n\n🎰 Cost: -${TREASURE_COST.toLocaleString()} 💸\n💰 Win up to 3 gems!\n\n🔮 Choose your lucky chest:`;

        await bot.sendPhoto(chatId, 'https://i.imgur.com/treasure_bg.jpg', {
            caption: treasureMsg,
            parse_mode: 'HTML',
            reply_markup: keyboard,
            reply_to_message_id: msg.message_id
        }).catch(() => {
            // Fallback if image fails
            sendReply(chatId, msg.message_id, treasureMsg, { reply_markup: keyboard });
        });
    } catch (error) {
        console.error('Error in /treasure command:', error);
        sendReply(chatId, msg.message_id, '❌ Error starting treasure hunt. Please try again!');
    }
});

// Treasure callback handler with win/loss images
bot.on('callback_query', async (query) => {
    if (!query.data.startsWith('treasure_')) return;

    const parts = query.data.split('_');
    if (parts.length !== 3) return;

    const treasureUserId = parseInt(parts[1]);
    const chosenPosition = parseInt(parts[2]);
    const clickerId = query.from.id;

    // Only the user who started the treasure can click
    if (clickerId !== treasureUserId) {
        return bot.answerCallbackQuery(query.id, { text: '❌ This treasure hunt is not for you!', show_alert: true });
    }

    try {
        // Get the winning position and gems
        const state = await pool.query('SELECT winning_position, gems_amount FROM treasure_state WHERE user_id = $1', [treasureUserId]);
        
        if (state.rows.length === 0) {
            return bot.answerCallbackQuery(query.id, { text: '❌ Treasure hunt expired!', show_alert: true });
        }

        const winningPosition = state.rows[0].winning_position;
        const gems = state.rows[0].gems_amount || 1;

        let resultText;
        let resultImage;
        
        if (chosenPosition === winningPosition) {
            // WINNER! Add gems to user
            await pool.query('UPDATE users SET gems = gems + $1 WHERE user_id = $2', [gems, treasureUserId]);
            await saveUserDataToFile(treasureUserId);
            
            resultText = `🎉✨ <b>JACKPOT!</b> ✨🎉\n\nᴏᴍғᴏᴏ ᴛᴇʀɪ ᴋɪsᴍᴀᴛ 😍☠\n\n💎 You won ${gems} gems!\n\n🏆 Chest ${winningPosition} was the winner!`;
            resultImage = 'https://i.imgur.com/treasure_win.jpg'; // Win background
        } else {
            // LOSER! No gems
            resultText = `😭😢 <b>BAD LUCK!</b> 😢😭\n\nʜᴀᴛ ᴛᴇʀɪ ᴋɪsᴍᴀᴛ ʜɪ ᴋʜᴀʀᴀʙ ʜᴀɪ 🤡🙂\n\n❌ You lost ${gems} gems chance!\n\n💔 The treasure was in chest ${winningPosition}!\n\nᴛʀʏ ᴀɢᴀɪɴ`;
            resultImage = 'https://i.imgur.com/treasure_lose.jpg'; // Sad crying background
        }

        // Clear the treasure state
        await pool.query('DELETE FROM treasure_state WHERE user_id = $1', [treasureUserId]);

        // Try to send image with caption
        try {
            await bot.sendPhoto(query.message.chat.id, resultImage, {
                caption: resultText,
                parse_mode: 'HTML'
            });
            // Delete original message
            await bot.deleteMessage(query.message.chat.id, query.message.message_id).catch(() => {});
        } catch (imgError) {
            // Fallback to text if image fails
            await bot.editMessageText(resultText, {
                chat_id: query.message.chat.id,
                message_id: query.message.message_id,
                parse_mode: 'HTML'
            });
        }

        bot.answerCallbackQuery(query.id);
    } catch (error) {
        console.error('Error in treasure callback:', error);
        bot.answerCallbackQuery(query.id, { text: '❌ Error processing treasure!', show_alert: true });
    }
});

// ==================== CONVERT COMMAND (1000 crimson = 1 gem) ====================
bot.onText(/\/convert(?:\s+(\d+))?/, async (msg, match) => {
    if (!await checkUserAccess(msg)) return;

    const userId = msg.from.id;
    const amount = parseInt(match[1]) || 1;
    const crimsonNeeded = amount * 1000;

    try {
        await ensureUser(userId, msg.from.username, msg.from.first_name);
        
        const user = await pool.query('SELECT crimson FROM users WHERE user_id = $1', [userId]);
        const currentCrimson = user.rows[0]?.crimson || 0;
        
        if (currentCrimson < crimsonNeeded) {
            return sendReply(msg.chat.id, msg.message_id, `❌ You need ${crimsonNeeded.toLocaleString()} 🩸 crimson to convert ${amount} 💎 gems!\n\nYou have: ${currentCrimson.toLocaleString()} 🩸 crimson`);
        }
        
        await pool.query('UPDATE users SET crimson = crimson - $1, gems = gems + $2 WHERE user_id = $3', [crimsonNeeded, amount, userId]);
        await saveUserDataToFile(userId);
        
        sendReply(msg.chat.id, msg.message_id, `✅ <b>Conversion Successful!</b>\n\n🩸 ${crimsonNeeded.toLocaleString()} crimson → 💎 ${amount} gems\n\n💡 Rate: 1000 crimson = 1 gem`);
    } catch (error) {
        console.error('Error in /convert command:', error);
        sendReply(msg.chat.id, msg.message_id, '❌ Error converting crimson. Please try again!');
    }
});

// ==================== GIVE GEMS COMMAND (Owner/Dev only) ====================
bot.onText(/\/give_gems(?:\s+(.+))?/, async (msg, match) => {
    const userId = msg.from.id;

    if (userId !== OWNER_ID && !await hasRole(userId, 'dev')) {
        return sendReply(msg.chat.id, msg.message_id, '❌ This command is only for owners/developers!');
    }

    const amountMatch = match[1]?.match(/(\d+)/);
    const amount = amountMatch ? parseInt(amountMatch[1]) : 0;
    const targetId = msg.reply_to_message?.from?.id;

    if (!targetId) {
        return sendReply(msg.chat.id, msg.message_id, '❌ Reply to a user to give them gems!\n\nUsage: Reply to user with /give_gems <amount>');
    }

    if (!amount || amount <= 0) {
        return sendReply(msg.chat.id, msg.message_id, '❌ Please specify a valid amount!\n\nUsage: /give_gems 100');
    }

    try {
        await ensureUser(targetId, msg.reply_to_message.from.username, msg.reply_to_message.from.first_name);
        await pool.query('UPDATE users SET gems = gems + $1 WHERE user_id = $2', [amount, targetId]);
        await saveUserDataToFile(targetId);
        
        sendReply(msg.chat.id, msg.message_id, `✅ Gave <b>${amount} 💎 gems</b> to ${msg.reply_to_message.from.first_name}!`);
    } catch (error) {
        console.error('Error in /give_gems command:', error);
        sendReply(msg.chat.id, msg.message_id, '❌ Error giving gems. Please try again!');
    }
});

// ==================== GIVE WAIFU COMMAND (Owner/Dev only) ====================
bot.onText(/\/give_waifu(?:\s+(\d+))?/, async (msg, match) => {
    const userId = msg.from.id;

    if (userId !== OWNER_ID && !await hasRole(userId, 'dev')) {
        return sendReply(msg.chat.id, msg.message_id, '❌ This command is only for owners/developers!');
    }

    const waifuId = match[1] ? parseInt(match[1]) : null;
    const targetId = msg.reply_to_message?.from?.id;

    if (!targetId) {
        return sendReply(msg.chat.id, msg.message_id, '❌ Reply to a user to give them a waifu!\n\nUsage: Reply to user with /give_waifu <waifu_id>');
    }

    if (!waifuId || waifuId <= 0) {
        return sendReply(msg.chat.id, msg.message_id, '❌ Please specify a valid waifu ID!\n\nUsage: /give_waifu 123');
    }

    try {
        const waifuCheck = await pool.query('SELECT * FROM waifus WHERE waifu_id = $1', [waifuId]);
        if (waifuCheck.rows.length === 0) {
            return sendReply(msg.chat.id, msg.message_id, `❌ Waifu with ID ${waifuId} not found!`);
        }

        const waifu = waifuCheck.rows[0];
        await ensureUser(targetId, msg.reply_to_message.from.username, msg.reply_to_message.from.first_name);
        await pool.query('INSERT INTO harem (user_id, waifu_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [targetId, waifuId]);
        await saveUserDataToFile(targetId);
        
        sendReply(msg.chat.id, msg.message_id, `✅ Gave waifu <b>${waifu.name}</b> (ID: ${waifuId}) to ${msg.reply_to_message.from.first_name}!`);
    } catch (error) {
        console.error('Error in /give_waifu command:', error);
        sendReply(msg.chat.id, msg.message_id, '❌ Error giving waifu. Please try again!');
    }
});

// ==================== REWARD CUSTOM COMMANDS (Owner Only) ====================
// Format: /addreward /trigger Give <amount> gems (1 hour)
// or: /addreward /trigger Give waifu id - <waifu_id> (10 seconds)
bot.onText(/\/addreward\s+\/(\w+)\s+[Gg]ive\s+(.+)/i, async (msg, match) => {
    const userId = msg.from.id;

    if (userId !== OWNER_ID && !await hasRole(userId, 'dev')) {
        return sendReply(msg.chat.id, msg.message_id, '❌ This command is only for the bot owner/developer!');
    }

    const trigger = match[1].toLowerCase();
    const rewardText = match[2].trim();
    
    console.log(`[DEBUG] /addreward: trigger="${trigger}", text="${rewardText}"`);

    const systemCommands = ['start', 'help', 'daily', 'weekly', 'bal', 'harem', 'goal', 'treasure', 'addcmd', 'delcmd', 'listcmds', 'addreward', 'delreward', 'convert', 'give_gems', 'give_waifu'];
    if (systemCommands.includes(trigger)) {
        return sendReply(msg.chat.id, msg.message_id, '❌ Cannot override system commands!');
    }

    // Parse time duration (10 seconds, 1 minute, 1 hour, 1 day, 1 year)
    const timeMatch = rewardText.match(/\((\d+)\s*(second|seconds|minute|minutes|hour|hours|day|days|year|years)\)/i);
    let expiryTime = null;
    let timeDisplay = '';
    
    if (timeMatch) {
        const amount = parseInt(timeMatch[1]);
        const unit = timeMatch[2].toLowerCase();
        
        let seconds = 0;
        if (unit.startsWith('second')) {
            seconds = amount;
            timeDisplay = `${amount} second${amount > 1 ? 's' : ''}`;
        } else if (unit.startsWith('minute')) {
            seconds = amount * 60;
            timeDisplay = `${amount} minute${amount > 1 ? 's' : ''}`;
        } else if (unit.startsWith('hour')) {
            seconds = amount * 3600;
            timeDisplay = `${amount} hour${amount > 1 ? 's' : ''}`;
        } else if (unit.startsWith('day')) {
            seconds = amount * 86400;
            timeDisplay = `${amount} day${amount > 1 ? 's' : ''}`;
        } else if (unit.startsWith('year')) {
            seconds = amount * 31536000;
            timeDisplay = `${amount} year${amount > 1 ? 's' : ''}`;
        }
        
        expiryTime = new Date(Date.now() + seconds * 1000);
    }

    try {
        // Ensure custom_commands table has expires_at column
        await pool.query(`
            CREATE TABLE IF NOT EXISTS custom_commands (
                command_trigger TEXT PRIMARY KEY,
                reward_type TEXT NOT NULL,
                reward_amount BIGINT,
                waifu_id INT,
                created_by BIGINT NOT NULL,
                expires_at TIMESTAMP,
                created_at TIMESTAMP DEFAULT NOW()
            )
        `);

        if (rewardText.toLowerCase().includes('waifu id')) {
            const waifuMatch = rewardText.match(/waifu\s*id\s*[-:]?\s*(\d+)/i);
            if (!waifuMatch) {
                return sendReply(msg.chat.id, msg.message_id, '❌ Invalid format!\n\nUsage: /addreward /diwali Give waifu id - 123 (1 hour)');
            }
            const waifuId = parseInt(waifuMatch[1]);
            
            const waifuCheck = await pool.query('SELECT * FROM waifus WHERE waifu_id = $1', [waifuId]);
            if (waifuCheck.rows.length === 0) {
                return sendReply(msg.chat.id, msg.message_id, `❌ Waifu with ID ${waifuId} not found!`);
            }
            
            await pool.query(
                'INSERT INTO custom_commands (command_trigger, reward_type, waifu_id, created_by, expires_at) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (command_trigger) DO UPDATE SET reward_type = $2, waifu_id = $3, reward_amount = NULL, expires_at = $5',
                [trigger, 'waifu', waifuId, userId, expiryTime]
            );
            
            let timeMsg = expiryTime ? `\n⏰ Expires in: ${timeDisplay}` : '\n⏰ Permanent (no expiry)';
            sendReply(msg.chat.id, msg.message_id, `✅ Reward command /${trigger} created!\n\n🎁 Gives waifu: ${waifuCheck.rows[0].name} (ID: ${waifuId})${timeMsg}`);
        } else {
            const amountMatch = rewardText.match(/(\d+)\s*gems?/i);
            if (!amountMatch) {
                return sendReply(msg.chat.id, msg.message_id, '❌ Invalid format!\n\nUsage: /addreward /eid Give 10 gems (1 hour)');
            }
            const amount = parseInt(amountMatch[1]);
            
            await pool.query(
                'INSERT INTO custom_commands (command_trigger, reward_type, reward_amount, created_by, expires_at) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (command_trigger) DO UPDATE SET reward_type = $2, reward_amount = $3, waifu_id = NULL, expires_at = $5',
                [trigger, 'gems', amount, userId, expiryTime]
            );
            
            let timeMsg = expiryTime ? `\n⏰ Expires in: ${timeDisplay}` : '\n⏰ Permanent (no expiry)';
            sendReply(msg.chat.id, msg.message_id, `✅ Reward command /${trigger} created!\n\n🎁 Gives ${amount} 💎 gems${timeMsg}`);
        }
    } catch (error) {
        console.error('Error adding reward command:', error);
        sendReply(msg.chat.id, msg.message_id, '❌ Error adding reward command. Please try again!');
    }
});

// Delete reward command (Owner only)
bot.onText(/\/delreward\s+\/(\w+)/i, async (msg, match) => {
    const userId = msg.from.id;

    if (userId !== OWNER_ID) {
        return sendReply(msg.chat.id, msg.message_id, '❌ This command is only for the bot owner!');
    }

    const trigger = match[1].toLowerCase();

    try {
        const result = await pool.query('DELETE FROM custom_commands WHERE command_trigger = $1 RETURNING *', [trigger]);
        
        if (result.rows.length === 0) {
            return sendReply(msg.chat.id, msg.message_id, `❌ Reward command /${trigger} not found!`);
        }

        sendReply(msg.chat.id, msg.message_id, `✅ Reward command /${trigger} deleted!`);
    } catch (error) {
        console.error('Error deleting reward command:', error);
        sendReply(msg.chat.id, msg.message_id, '❌ Error deleting reward command. Please try again!');
    }
});

// List reward commands (Owner only)
bot.onText(/\/listrewards/, async (msg) => {
    const userId = msg.from.id;

    if (userId !== OWNER_ID) {
        return sendReply(msg.chat.id, msg.message_id, '❌ This command is only for the bot owner!');
    }

    try {
        const commands = await pool.query('SELECT * FROM custom_commands ORDER BY command_trigger');
        
        if (commands.rows.length === 0) {
            return sendReply(msg.chat.id, msg.message_id, '📋 No reward commands created yet!\n\nUse: /addreward /<command> Give <amount> gems\nor: /addreward /<command> Give waifu id - <id>');
        }

        let text = '📋 <b>Reward Commands:</b>\n\n';
        commands.rows.forEach(cmd => {
            if (cmd.reward_type === 'gems') {
                text += `/${cmd.command_trigger} - 💎 ${cmd.reward_amount} gems\n`;
            } else if (cmd.reward_type === 'waifu') {
                text += `/${cmd.command_trigger} - 🎴 Waifu ID: ${cmd.waifu_id}\n`;
            }
        });

        sendReply(msg.chat.id, msg.message_id, text);
    } catch (error) {
        console.error('Error listing reward commands:', error);
        sendReply(msg.chat.id, msg.message_id, '❌ Error listing commands. Please try again!');
    }
});

// Handle reward custom commands
bot.on('message', async (msg) => {
    if (!msg.text || !msg.text.startsWith('/')) return;
    
    const cmd = msg.text.split(/\s+/)[0].substring(1).toLowerCase().split('@')[0];
    
    try {
        const customCmd = await pool.query('SELECT * FROM custom_commands WHERE command_trigger = $1', [cmd]);
        if (customCmd.rows.length === 0) return;
        
        const c = customCmd.rows[0];
        
        // Check if command has expired
        if (c.expires_at && new Date(c.expires_at) < new Date()) {
            await pool.query('DELETE FROM custom_commands WHERE command_trigger = $1', [cmd]);
            return sendReply(msg.chat.id, msg.message_id, '❌ This reward has expired!');
        }
        
        const userId = msg.from.id;
        await ensureUser(userId, msg.from.username, msg.from.first_name);
        
        if (c.reward_type === 'gems') {
            await pool.query('UPDATE users SET gems = gems + $1 WHERE user_id = $2', [c.reward_amount, userId]);
            await saveUserDataToFile(userId);
            sendReply(msg.chat.id, msg.message_id, `🎁 ${msg.from.first_name} received <b>${c.reward_amount} 💎 gems</b>!`);
        } else if (c.reward_type === 'waifu') {
            const waifuCheck = await pool.query('SELECT * FROM waifus WHERE waifu_id = $1', [c.waifu_id]);
            if (waifuCheck.rows.length === 0) {
                return sendReply(msg.chat.id, msg.message_id, '❌ Waifu not found!');
            }
            await pool.query('INSERT INTO harem (user_id, waifu_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [userId, c.waifu_id]);
            await saveUserDataToFile(userId);
            sendReply(msg.chat.id, msg.message_id, `🎁 ${msg.from.first_name} received waifu <b>${waifuCheck.rows[0].name}</b>!`);
        }
    } catch (error) {
        // Silently ignore errors for custom command lookup
    }
});

// ==================== DYNAMIC COMMAND SYSTEM (Owner Only) ====================
// Format: /<command> <response> <temporary|permanent>
// Supports multiline responses
bot.onText(/\/addcmd\s+\/(\w+)\s+([\s\S]+)$/i, async (msg, match) => {
    const userId = msg.from.id;

    // Owner only
    if (userId !== OWNER_ID) {
        return sendReply(msg.chat.id, msg.message_id, '❌ This command is only for the bot owner!');
    }

    const commandName = match[1].toLowerCase();
    const fullText = match[2].trim();
    
    // Extract permanent/temporary from end of text
    let isPermanent = false;
    let response = fullText;
    
    if (fullText.endsWith(' permanent')) {
        isPermanent = true;
        response = fullText.slice(0, -10).trim(); // Remove ' permanent'
    } else if (fullText.endsWith(' temporary')) {
        isPermanent = false;
        response = fullText.slice(0, -10).trim(); // Remove ' temporary'
    } else {
        return sendReply(msg.chat.id, msg.message_id, '❌ Please specify "permanent" or "temporary" at the end!\n\nExample:\n/addcmd /rules Your rules here permanent');
    }

    // Prevent overwriting system commands
    const systemCommands = ['start', 'help', 'daily', 'weekly', 'bal', 'harem', 'goal', 'treasure', 'addcmd', 'delcmd', 'listcmds'];
    if (systemCommands.includes(commandName)) {
        return sendReply(msg.chat.id, msg.message_id, '❌ Cannot override system commands!');
    }

    try {
        await pool.query(
            'INSERT INTO dynamic_commands (command_name, command_response, is_permanent, created_by) VALUES ($1, $2, $3, $4) ON CONFLICT (command_name) DO UPDATE SET command_response = $2, is_permanent = $3',
            [commandName, response, isPermanent, userId]
        );

        sendReply(msg.chat.id, msg.message_id, `✅ Command /${commandName} ${isPermanent ? 'permanently' : 'temporarily'} added!\n\nResponse:\n${response}`);
    } catch (error) {
        console.error('Error adding dynamic command:', error);
        sendReply(msg.chat.id, msg.message_id, '❌ Error adding command. Please try again!');
    }
});

// Delete dynamic command (Owner only)
bot.onText(/\/delcmd\s+\/(\w+)/, async (msg, match) => {
    const userId = msg.from.id;

    if (userId !== OWNER_ID) {
        return sendReply(msg.chat.id, msg.message_id, '❌ This command is only for the bot owner!');
    }

    const commandName = match[1].toLowerCase();

    try {
        const result = await pool.query('DELETE FROM dynamic_commands WHERE command_name = $1 RETURNING *', [commandName]);
        
        if (result.rows.length === 0) {
            return sendReply(msg.chat.id, msg.message_id, `❌ Command /${commandName} not found!`);
        }

        sendReply(msg.chat.id, msg.message_id, `✅ Command /${commandName} deleted!`);
    } catch (error) {
        console.error('Error deleting dynamic command:', error);
        sendReply(msg.chat.id, msg.message_id, '❌ Error deleting command. Please try again!');
    }
});

// List dynamic commands (Owner only)
bot.onText(/\/listcmds/, async (msg) => {
    const userId = msg.from.id;

    if (userId !== OWNER_ID) {
        return sendReply(msg.chat.id, msg.message_id, '❌ This command is only for the bot owner!');
    }

    try {
        const commands = await pool.query('SELECT command_name, is_permanent FROM dynamic_commands ORDER BY command_name');
        
        if (commands.rows.length === 0) {
            return sendReply(msg.chat.id, msg.message_id, '📋 No dynamic commands created yet!\n\nUse: /addcmd /<command> <response> <temporary|permanent>');
        }

        let text = '📋 <b>Dynamic Commands:</b>\n\n';
        commands.rows.forEach(cmd => {
            text += `/${cmd.command_name} - ${cmd.is_permanent ? '🔒 Permanent' : '⏱️ Temporary'}\n`;
        });

        sendReply(msg.chat.id, msg.message_id, text);
    } catch (error) {
        console.error('Error listing dynamic commands:', error);
        sendReply(msg.chat.id, msg.message_id, '❌ Error listing commands. Please try again!');
    }
});

// Handle dynamic commands
bot.on('message', async (msg) => {
    if (!msg.text || !msg.text.startsWith('/')) return;
    
    const command = msg.text.split(/\s+/)[0].substring(1).toLowerCase().split('@')[0];
    
    try {
        const result = await pool.query('SELECT command_response FROM dynamic_commands WHERE command_name = $1', [command]);
        
        if (result.rows.length > 0) {
            await sendReply(msg.chat.id, msg.message_id, result.rows[0].command_response);
        }
    } catch (error) {
        // Silently ignore errors for dynamic command lookup
    }
});

console.log('✅ Waifu Collection Bot started successfully!');
console.log(`Owner ID: ${OWNER_ID}`);
console.log('Waiting for messages...');