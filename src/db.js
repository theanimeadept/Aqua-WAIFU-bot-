const mongoose = require('mongoose');
const fs = require('fs').promises;
const path = require('path');
const User = require('./models/User');
const Waifu = require('./models/Waifu');
const Harem = require('./models/Harem');

let isConnected = false;

async function connectDB() {
    if (isConnected) return;

    const dbUrl = process.env.MONGODB_URI || process.env.DATABASE_URL;
    if (!dbUrl) {
        console.warn('⚠️ MONGODB_URI not provided. Running in NO-DB MODE.');
        return;
    }

    try {
        await mongoose.connect(dbUrl, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
        });

        isConnected = true;
        console.log('✅ Connected to MongoDB Atlas');

        // Run data migration after connection
        await migrateData();
    } catch (error) {
        console.warn('⚠️ Failed to connect to MongoDB:', error.message);
        console.warn('Running in NO-DB MODE.');
    }
}

async function migrateData() {
    try {
        console.log('🔄 Checking for data migration...');

        // Check if data already exists
        const userCount = await User.countDocuments();
        if (userCount > 0) {
            console.log('✅ Data already migrated, skipping.');
            return;
        }

        console.log('📥 Migrating data from files...');

        // Migrate users
        const usersFile = path.join(__dirname, 'data_files', 'users_data.json');
        let haremEntries = [];
        try {
            const usersData = JSON.parse(await fs.readFile(usersFile, 'utf8'));
            if (usersData.users && Array.isArray(usersData.users)) {
                const users = usersData.users.map(user => {
                    // Extract harem
                    if (user.harem && Array.isArray(user.harem)) {
                        user.harem.forEach(waifuId => {
                            haremEntries.push({
                                user_id: user.user_id,
                                waifu_id: waifuId,
                                acquired_date: new Date(),
                                owned_since: new Date()
                            });
                        });
                    }
                    return {
                        user_id: user.user_id,
                        username: user.username,
                        first_name: user.first_name,
                        berries: user.berries || 0,
                        gems: user.gems || 0,
                        daily_streak: user.daily_streak || 0,
                        weekly_streak: user.weekly_streak || 0,
                        last_daily_claim: user.last_daily_claim,
                        last_weekly_claim: user.last_weekly_claim,
                        last_claim_date: user.last_claim_date,
                        favorite_waifu_id: user.favorite_waifu_id,
                        harem_filter_rarity: user.harem_filter_rarity,
                        created_at: user.created_at ? new Date(user.created_at) : new Date()
                    };
                });
                await User.insertMany(users, { ordered: false });
                console.log(`✅ Migrated ${users.length} users`);
            }
        } catch (error) {
            console.error('❌ Error migrating users:', error.message);
        }

        // Migrate waifus
        const waifusFile = path.join(__dirname, 'data_files', 'waifus_data.json');
        try {
            const waifusData = JSON.parse(await fs.readFile(waifusFile, 'utf8'));
            if (waifusData.waifus && Array.isArray(waifusData.waifus)) {
                const waifus = waifusData.waifus.map(waifu => ({
                    waifu_id: waifu.waifu_id,
                    name: waifu.name,
                    anime: waifu.anime,
                    rarity: waifu.rarity,
                    image_file_id: waifu.image_file_id,
                    price: waifu.price || 5000,
                    is_locked: waifu.is_locked || false,
                    uploaded_by: waifu.uploaded_by,
                    created_at: waifu.created_at ? new Date(waifu.created_at) : new Date()
                }));
                await Waifu.insertMany(waifus, { ordered: false });
                console.log(`✅ Migrated ${waifus.length} waifus`);
            }
        } catch (error) {
            console.error('❌ Error migrating waifus:', error.message);
        }

        // Migrate harem
        if (haremEntries.length > 0) {
            try {
                await Harem.insertMany(haremEntries, { ordered: false });
                console.log(`✅ Migrated ${haremEntries.length} harem entries`);
            } catch (error) {
                console.error('❌ Error migrating harem:', error.message);
            }
        }

        console.log('🎉 Data migration completed!');
    } catch (error) {
        console.error('❌ Data migration failed:', error.message);
    }
}

module.exports = { connectDB };