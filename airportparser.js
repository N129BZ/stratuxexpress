import fs from 'fs';
import csv from 'csv-parser';
import Database from 'better-sqlite3';

// Configuration
const DB_FILE = './airports/airports.db';
const AIRPORTS_CSV = './airports/airports.csv';
const FREQUENCIES_CSV = './airports/airport-frequencies.csv';
const RUNWAYS_CSV = './airports/runways.csv';

// Ensure the directory exists before establishing connection
const dir = './airports';
if (!fs.existsSync(dir)){
    fs.mkdirSync(dir, { recursive: true });
}

// delete the existing database file if it exists to ensure a fresh start
if (fs.existsSync(DB_FILE)) {
    fs.unlinkSync(DB_FILE);
}

// Initialize Database connection (Keep it open for both tables)
const db = new Database(DB_FILE);

// Helper function to stream a CSV into a specific SQLite table inside a transaction
const streamCsvToTable = (filePath, insertStmt) => {
    return new Promise((resolve, reject) => {
        const insertTransaction = db.transaction((rows) => {
            for (const row of rows) insertStmt.run(row);
        });

        let batch = [];
        const BATCH_SIZE = 1000;

        fs.createReadStream(filePath)
            .pipe(csv())
            .on('data', (row) => {
                batch.push(row);
                if (batch.length >= BATCH_SIZE) {
                    insertTransaction(batch);
                    batch = [];
                }
            })
            .on('end', () => {
                if (batch.length > 0) insertTransaction(batch);
                resolve();
            })
            .on('error', (err) => reject(err));
    });
};

async function createAirportsDatabase() { 
    const createMainSchema = () => {
        db.exec(`
            CREATE TABLE IF NOT EXISTS airports (
                id TEXT, ident TEXT PRIMARY KEY, type TEXT, name TEXT, latitude_deg REAL, longitude_deg REAL,
                elevation_ft INTEGER, continent TEXT, iso_country TEXT, iso_region TEXT, municipality TEXT,
                scheduled_service TEXT, icao_code TEXT, iata_code TEXT, gps_code TEXT, local_code TEXT,
                home_link TEXT, wikipedia_link TEXT, keywords TEXT
            );

            CREATE TABLE IF NOT EXISTS frequencies (
                id TEXT PRIMARY KEY, airport_ref TEXT, airport_ident TEXT, type TEXT, description TEXT,
                frequency_mhz REAL,
                FOREIGN KEY(airport_ident) REFERENCES airports(ident)
            );

            CREATE INDEX IF NOT EXISTS idx_frequencies_ident ON frequencies(airport_ident);
        `);
    };

    const buildDatabase = async () => {
        try {
            console.log('Optimizing SQLite storage configuration...');
            db.pragma('journal_mode = WAL');
            db.pragma('synchronous = NORMAL');

            console.log('Creating database schema and relationships...');
            createMainSchema();

            const insertAirport = db.prepare(`
                INSERT OR REPLACE INTO airports VALUES (
                    $id, $ident, $type, $name, CAST($latitude_deg AS REAL), CAST($longitude_deg AS REAL),
                    CAST($elevation_ft AS INTEGER), $continent, $iso_country, $iso_region, $municipality,
                    $scheduled_service, $icao_code, $iata_code, $gps_code, $local_code, $home_link, $wikipedia_link, $keywords
                )
            `);

            const insertFrequency = db.prepare(`
                INSERT OR REPLACE INTO frequencies VALUES (
                    $id, $airport_ref, $airport_ident, $type, $description, CAST($frequency_mhz AS REAL)
                )
            `);

            console.log('Streaming airports into database...');
            await streamCsvToTable(AIRPORTS_CSV, insertAirport);

            console.log('Streaming frequencies into database...');
            await streamCsvToTable(FREQUENCIES_CSV, insertFrequency);

            console.log(`Success! Main database elements populated.`);
        } catch (error) {
            console.error('Fatal database migration error:', error);
            throw error;
        }
    };

    await buildDatabase(); // Fixed: Added await here
}

async function createRunwaysTable() {
    const createRunwaySchema = () => {
        db.exec(`
            CREATE TABLE IF NOT EXISTS runways (
                id TEXT PRIMARY KEY, 
                airport_ref TEXT, 
                airport_ident TEXT, 
                length_ft INTEGER, 
                width_ft INTEGER,
                surface_raw TEXT,         
                surface_material TEXT,    
                surface_condition TEXT,   
                lighted INTEGER, 
                closed INTEGER, 
                le_ident TEXT, 
                le_latitude_deg REAL,
                le_longitude_deg REAL, 
                le_elevation_ft INTEGER, 
                le_heading_degT REAL, 
                le_displaced_threshold_ft INTEGER,
                he_ident TEXT, 
                he_latitude_deg REAL, 
                he_longitude_deg REAL, 
                he_elevation_ft INTEGER,
                he_heading_degT REAL, 
                he_displaced_threshold_ft INTEGER
            );
            CREATE INDEX IF NOT EXISTS idx_runways_ident ON runways(airport_ident);
        `);
    };

    const streamRunways = () => {
        return new Promise((resolve, reject) => {
            createRunwaySchema();

            // Fixed: Changed $he_longitude_deg_2 to $he_longitude_deg to match columns
            const insertRunway = db.prepare(`
                INSERT OR REPLACE INTO runways VALUES (
                    $id, $airport_ref, $airport_ident, CAST($length_ft AS INTEGER), CAST($width_ft AS INTEGER),
                    $surface_raw, UPPER($surface_material), $surface_condition, -- Enforces UPPERCASE here
                    CAST($lighted AS INTEGER), CAST($closed AS INTEGER), $le_ident, CAST($le_latitude_deg AS REAL),
                    CAST($le_longitude_deg AS REAL), CAST($le_elevation_ft AS INTEGER), CAST($le_heading_degT AS REAL), CAST($le_displaced_threshold_ft AS INTEGER),
                    $he_ident, CAST($he_latitude_deg AS REAL), CAST($he_longitude_deg AS REAL), CAST($he_elevation_ft AS INTEGER),
                    CAST($he_heading_degT AS REAL), CAST($he_displaced_threshold_ft AS INTEGER)
                )
            `);
            
            const translateMaterial = (rawMatString) => {
                if (!rawMatString) return null;
                
                return rawMatString
                .toUpperCase()
                .split('-')
                .map(code => materialMap[code] || code) // Falls back to the uppercase raw token if missing
                .join(' / ');
            };

            const conditionMap = {
                'E': 'EXCELLENT',
                'G': 'GOOD',
                'F': 'FAIR',
                'P': 'POOR',
                'U': 'UNKNOWN',
                'X': 'UNUSABLE'
            };

            const materialMap = {
                'ASP': 'ASPHALT',
                'ASPH': 'ASPHALT',
                'CON': 'CONCRETE',
                'CONC': 'CONCRETE',
                'ASPH/CONC': 'ASPH/CONC',
                'ASPH/ CONC': 'ASPH/CONC',
                'PEM': 'CHIP/ASPH/CONC',
                'GVL': 'GRAVEL',
                'GRVL': 'GRAVEL',
                'GRS': 'GRASS',
                'TURF': 'GRASS',
                'Turf': 'GRASS', // Added to handle case variations
                'TRTD': 'TREATED',
                'BIT':  'BITUMINOUS',
                'MAC':  'ASPHALT',
                'DIRT': 'DIRT',
                'SAND': 'SAND',
                'WAT':  'WATER',
                'ICE':  'ICE',
                'SNOW': 'SNOW',
                'CORR': 'CORRUGATED',
                'STEEL': 'STEEL',
                'PLST': 'PLASTIC',
                'BRICK': 'BRICK',
                'WOOD': 'WOOD',
                'MAT':  'MATS',
                'UNKN': 'UNKNOWN',
                'UNK':  'UNKNOWN',
                'BITUM': 'ASPHALT',
                'BITUMINOUS': 'ASPHALT',
                'CHIP': 'CHIP SEAL',

            };
            const insertTransaction = db.transaction((rows) => {
                for (const row of rows) {
                    const rawSurface = (row.surface || '').trim();
                    
                    row.surface_raw = rawSurface || null;
                    row.surface_material = null;
                    row.surface_condition = null;

                    if (!rawSurface) {
                        // If the row is completely empty, insert as null and skip parsing
                        insertRunway.run(row);
                        continue;
                    }

                    if (rawSurface.includes('-')) {
                        const parts = rawSurface.split('-').map(p => p.trim().toUpperCase());
                        const lastPart = parts.pop(); 

                        if (lastPart && lastPart.length === 1 && conditionMap[lastPart]) {
                            // Condition matches! Translate or fallback the remaining material parts
                            row.surface_material = translateMaterial(parts.join('-')); 
                            row.surface_condition = conditionMap[lastPart];
                        } else {
                            // No condition matched. Put the last segment back and process the entire chain
                            parts.push(lastPart);
                            row.surface_material = translateMaterial(parts.join('-'));
                            row.surface_condition = null;
                        }
                        } else {
                        // No hyphens present. Direct evaluation with fallback
                        row.surface_material = translateMaterial(rawSurface);
                    }
                    insertRunway.run(row);
                }
            });

            let batch = [];
            fs.createReadStream(RUNWAYS_CSV)
                .pipe(csv())
                .on('data', (row) => {
                    batch.push(row);
                    if (batch.length >= 1000) {
                        insertTransaction(batch);
                        batch = [];
                    }
                })
                .on('end', () => {
                    if (batch.length > 0) insertTransaction(batch);
                    console.log('Runways database table populated and normalized successfully.');
                    resolve();
                })
                .on('error', (err) => reject(err));
        });
    };

    await streamRunways();
}

// Orderly Execution Pipeline
try {
    await createAirportsDatabase();
    await createRunwaysTable();
    console.log(`All migration pipelines finished. Final database saved at: ${DB_FILE}`);
} catch (err) {
    console.error("Migration pipeline failed:", err);
} finally {
    db.close(); // Closed at the very end of processing
}
