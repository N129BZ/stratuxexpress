import express from 'express';
import cors from 'cors';
import { atan, exp, pi, pow } from 'mathjs';
import fs from 'fs';
import { WebSocketServer } from 'ws';
import Database from 'better-sqlite3';
import http from 'http';
//////////////////////////////////////////////////////////////
// Download link for airport, runway, and frequency csv data:
//    https://davidmegginson.github.io/ourairports-data/
//////////////////////////////////////////////////////////////

const DIRNAME   = process.cwd();
const ROOT_PATH = `${DIRNAME}/dist`;
const DB_PATH   = `${ROOT_PATH}/data`;
const TILE_PATH = `${DIRNAME}/tiles`;

let histdb;
const apdb = new Database(`${DB_PATH}/airports.db`, {readonly: true});
const cachedb = new Database(`${DB_PATH}/mapstate.db`, {readonly: false});
const databaselist = new Map();
const databases    = new Map();
const metadatasets = new Map();

loadDatabases();
loadMetadatasets();

function loadDatabases() {
    try {
        let dbfiles = fs.readdirSync(TILE_PATH);
        dbfiles.forEach((dbname) => {
            if (dbname.endsWith(".db") || dbname.endsWith(".mbtiles")) {
                var key = dbname.toLowerCase().split(".")[0];
                var dbfile = `${TILE_PATH}/${dbname}`;
                databaselist.set(key, dbfile);
            }
        });

        databaselist.forEach((dbfile, key) => {
            try {
                var db = new Database(dbfile, {readonly: true});
                databases.set(key, db);
            }
            catch (error) {
                console.error(`Failed to load: ${key}: ${err}`);
            }
            
        });
    }
    catch(error) {
        console.error(error.message);
    }

    try {
        histdb = new Database(`${DB_PATH}/positionhistory.db`, {readonly: true});
    } catch (error) {
        console.log(`Failed to load historyDb: ${error}`);
    }
}

/**
 * Get Map object filled with metadata sets for all mbtiles databases
 */
function loadMetadatasets() {
    let sql = `SELECT name, value FROM metadata UNION SELECT 'minzoom', min(zoom_level) FROM tiles ` + 
              `WHERE NOT EXISTS (SELECT * FROM metadata WHERE name='minzoom') UNION SELECT 'maxzoom', max(zoom_level) FROM tiles ` +
              `WHERE NOT EXISTS (SELECT * FROM metadata WHERE name='maxzoom')`;
    
    databases.forEach((db, key) => {
        let item = {};
        item["bounds"] = "";
        item["attribution"] = "";
        let found = false;

        try {
            const rows = db.prepare(sql).all();
            rows.forEach((row) => {
                if (row.value != null) {
                    item[row.name] = row.value;
                }
                if (row.name === "maxzoom" && row.value != null) {
                    let maxZoomInt = parseInt(row.value); 
                    let minmaxSql = `SELECT min(tile_column) as xmin, min(tile_row) as ymin, ` + 
                                    `max(tile_column) as xmax, max(tile_row) as ymax ` +
                                    `FROM tiles WHERE zoom_level=${maxZoomInt}`;
                    try {
                        const minmaxRow = db.prepare(minmaxSql).get();
                        if (minmaxRow) {
                            let xmin = minmaxRow.xmin;
                            let ymin = minmaxRow.ymin; 
                            let xmax = minmaxRow.xmax; 
                            let ymax = minmaxRow.ymax;  
                            
                            let llmin = tileToDegree(maxZoomInt, xmin, ymin);
                            let llmax = tileToDegree(maxZoomInt, xmax+1, ymax+1);
                            
                            let retarray = `${llmin[0]}, ${llmin[1]}, ${llmax[0]}, ${llmax[1]}`;
                            item["bounds"] = retarray;
                            found = true;
                        }
                    } catch(error) {
                        console.error(error);
                    }
                }
            });
            metadatasets.set(key, item);
        } catch(error) {
            console.error(error);
        }
    });
}

/**
 * Start the express web server
 */
const app = express();
const httpServer = http.createServer(app);

app.use(express.urlencoded({ extended: true }));
app.use(express.json({ limit: '10mb' }));
app.use(cors());

let appOptions = {
    maxAge: 900000,
    dotfiles: 'ignore',
    etag: false,
    extensions: ['html'],
    index: false,
    redirect: false,
    setHeaders: function (res, path, stat) {
        res.set('x-timestamp', Date.now());http
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader('Access-Control-Allow-Methods', '*');
        res.setHeader("Access-Control-Allow-Headers", "*");
    }
};

app.use(express.static(ROOT_PATH, appOptions));

app.get('/', (req, res) => {
    res.sendFile(`${ROOT_PATH}/map.html`);
});

//app.get('/favicon.ico', (req, res) => res.status(204).end());

app.get("/settings", (req, res) => {
    let rawdata = fs.readFileSync(`${DB_PATH}/settings.json`);
    res.json(JSON.parse(rawdata));
    res.end();
});

app.get("/databaselist", (req, res) => {
    let obj = [];
    databaselist.forEach((value, key) => {
        obj.push(key);
    });
    res.json(obj); 
    res.end();
});

app.get("/airport", (req, res) => {
    let id = req.query.id;
    let obj = handleAirportRequest(id);
    if (!obj) {
        res.json({});
    } 
    else {
        res.json(obj);
    }
});

app.get("/airportlist", (req, res) => {
    res.json(airports);
    res.end();
});

app.get("/getmapstate", async(req, res) => {
    try {
        const row = cachedb.prepare("SELECT state FROM mapstate WHERE id = 1").get();
        if (row && row.state) {
            // Parse the stored JSON string before sending
            res.json(JSON.parse(row.state));
        } else {
            res.json({});
        }
    } catch (err) {
        console.error("Failed to get mapstate:", err);
        res.status(500).json({ error: err.message });
    }
});

app.post("/savemapstate", (req, res) => {
    const newState = JSON.stringify(req.body);
    try {
        // Update the state field in the mapstate table where id = 1
        const stmt = cachedb.prepare("UPDATE mapstate SET state = ? WHERE id = 1");
        stmt.run(newState);
        res.json({ success: true });
        console.log("Mapstate updated successfully");
    } catch (err) {
        console.error("Failed to update mapstate:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

app.get("/metadatasets", (req, res) => {
    let dbs = [];
    console.log("metadatasets count = ", metadatasets.size);
    metadatasets.forEach((item, key) => {
        let lineitem = {};
        lineitem["key"] = key;
        lineitem["value"] = item;
        dbs.push(lineitem);
    });
    res.json(dbs); 
    res.end();
});    

app.get("/tiles/*", (req, res) => {
    // Remove query string and split path
    const path = req.path; // e.g. "/tiles/chicago/5/8/11.png"
    const parts = path.split("/"); // ["", "tiles", "chicago", "5", "8", "11.png"]

    if (parts.length < 6) {
        res.status(400).send("Invalid tile URL");
        return;
    }

    const dbname = parts[2].toLowerCase();
    const z = parseInt(parts[3]);
    const x = parseInt(parts[4]);
    const yRaw = parts[5];
    const y = parseInt(yRaw.split(".")[0]);
    const db = databases.get(dbname);

    if (!db) {
        res.status(404).send("Database not found");
        return;
    }
    loadTile(z, x, y, res, db);
});

app.get("/gethistory", (req,res) => {
    getPositionHistory(res);
});

app.post("/savehistory", (req, res) => {
    savePositionHistory(req.body);
    res.writeHead(200);
    res.end();
});

let wxinterval = null;
const wss = new WebSocketServer({ server: httpServer });
wss.on('connection', (ws, request) => {
    if (request.url === '/weather') {
        console.log('WebSocket /weather connection established');
        let widx = -1;
        const wxdata = readJson();
        if (wxdata && wxdata.weather && Array.isArray(wxdata.weather)) {
            wxinterval = setInterval(() => {
                widx++;
                let rpt = wxdata.weather[widx];
                ws.send(JSON.stringify(rpt));
                if (widx === wxdata.weather.length - 1) {
                    widx = -1;
                }
            }, 1000);
            
        }
    }
    else if (request.url === '/traffic') {
        console.log("traffic websocket connected");
    }
    else if (request.url === '/situation') {
        console.log("situation websocket connected");
    }

    ws.on('close', () => {
        clearInterval(wxinterval);
        console.log('Client disconnected.');
    });
});

httpServer.listen(8500, '0.0.0.0', () => {
    console.log('Server listening on port 8500');
});

function handleAirportRequest(id) {
    const sql = `
        SELECT
        airports.ident,
        airports.name,
        airports.type,
        airports.longitude_deg AS lon,
        airports.latitude_deg AS lat,
        airports.elevation_ft AS elevation,
        (
            SELECT json_group_array(
                json_object(
                    'frequency', frequency_mhz,
                    'description', description
                )
            )
            FROM frequencies
            WHERE frequencies.airport_ident = airports.ident
        ) AS frequencies,
        (
            SELECT json_group_array(
                json_object(
                    'length', length_ft,
                    'width', width_ft,
                    'surface', surface,
                    'le_ident', le_ident,
                    'he_ident', he_ident
                )
            )
            FROM runways
            WHERE runways.airport_ident = airports.ident
        ) AS runways,
        airports.wikipedia_link
        FROM airports
        WHERE airports.ident = ?;
    `;
    try {
        let obj = apdb.prepare(sql).get(id);
        if (obj) {
            obj.frequencies = obj.frequencies ? JSON.parse(obj.frequencies) : [];
            obj.runways = obj.runways ? JSON.parse(obj.runways) : [];
            return obj;
        }
        else {
            return {};
        }
    }
    catch(err) {
        console.log("Error in handleAirportRequest", err);
    }
}

/**
 * Parse the z,x,y integers, validate, and pass along to loadTile
 * @param {request} http request 
 * @param {response} http response 
 * @param {db} database 
 * @returns the results of calling loadTile
 */
function handleTile(request, response) {
    try {
        const dbname = request.params.dbname.toLowerCase();
        const z = parseInt(request.params.z);
        const x = parseInt(request.params.x);
        // Handle y with possible extension (e.g., "11.png")
        let yRaw = request.params.y;
        let y = parseInt(yRaw.split(".")[0]);
        const db = databases.get(dbname);
        if (!db) {
            response.status(404).send("Database not found");
            return;
        }
        loadTile(z, x, y, response, db);
    } catch (err) {
        response.status(500).send("Failed to parse tile parameters");
    }
}

/**
 * Get all tiles from the passed database that match the supplied 
 * z,x,y indices and then send them back to the requesting client   
 * @param {integer} z 
 * @param {integer} x 
 * @param {integer} y 
 * @param {http response} http response object 
 * @param {database} sqlite database
 */
function loadTile(z, x, y, response, db) {
    if (isNaN(z) || isNaN(x) || isNaN(y)) {
        response.writeHead(400);
        response.end("Invalid tile coordinates");
        return;
    }
    try {
        // Use a prepared statement for safety and correctness
        const stmt = db.prepare(
            "SELECT tile_data FROM tiles WHERE zoom_level = ? AND tile_column = ? AND tile_row = ?"
        );
        const row = stmt.get(z, x, y); // Pass parameters directly

        if (!row || !row.tile_data) {
            response.writeHead(404);
            response.end();
        } else {
            response.writeHead(200);
            response.write(row.tile_data);
            response.end();
        }
    }
    catch (err) {
        // console.error("Error in loadTile", err);
        // response.writeHead(500);
        // response.end();
    }
}

/**
 * Get the longitude and latitude for a given pixel position on the map
 * @param {integer} z - the zoom level 
 * @param {integer} x - the horizontal index
 * @param {integer} y - the vertical index
 * @returns 2 element array - [longitude, latitude]
 */
function tileToDegree(z, x, y) {
    y = (1 << z) - y - 1
    let n = pi - 2.0*pi*y/pow(2, z);
    let lat = 180.0 / pi * atan(0.5*(exp(n)-exp(-n)));
    let lon = x/pow(2, z)*360.0 - 180.0;
    return [lon, lat]
}

function readJson() {
    let fname = `${DIRNAME}/stratuxweather.json`;
    let data = fs.readFileSync(fname, { encoding: 'utf-8' }); 
    try {
        let wxdata = JSON.parse(data);
        console.log("Success reading weather log");
        return wxdata;
    } catch (parseErr) {
        console.error('Error parsing JSON:', parseErr);
        return null;
    }
    return null;
}