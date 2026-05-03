
import express from 'express';
import http from 'http';
import cors from 'cors';
import { atan, exp, pi, pow } from 'mathjs';
import { readdirSync, statSync, createReadStream, createWriteStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { Transform, Readable } from 'node:stream';
import { writeFile, rename } from 'node:fs/promises';
import { WebSocketServer } from 'ws';
import { DatabaseSync } from 'node:sqlite';
import { appsettings } from './appsettings.js';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import { XMLHttpRequest } from "xmlhttprequest";
import { XMLParser } from 'fast-xml-parser';

//////////////////////////////////////////////////////////////
// Download link for airport, runway, and frequency csv data:
//    https://davidmegginson.github.io/ourairports-data/
//////////////////////////////////////////////////////////////

const DIRNAME   = import.meta.dirname;
const ROOT_PATH = `${DIRNAME}/dist`;
const DB_PATH   = `${ROOT_PATH}/data`;
const TILE_PATH = `${DIRNAME}/tiles`;

const apdb = new DatabaseSync(`${DIRNAME}/airports.db`, {readOnly:true});
const mapstatedb = new DatabaseSync(`${DIRNAME}/mapstate.db`, {readOnly:false});

const databaselist = new Map();
function loadDatabaseList() {
    try {
        const dbfiles = readdirSync(TILE_PATH);
        dbfiles.forEach((dbname) => {
            if (dbname.endsWith(".db") || dbname.endsWith(".mbtiles")) {
                var key = dbname.toLowerCase().split(".")[0];
                var dbfile = `${TILE_PATH}/${dbname}`;
                databaselist.set(key, dbfile);
            }
        });
    }
    catch(err) {
        console.log("NO CHART DATABASES FOUND!!");
    }
}

const databases = new Map();
function loadDatabases() {
    try {
        databaselist.forEach((dbfile, key) => {
            console.log(dbfile);
            const db = new DatabaseSync(dbfile, { readOnly:true });
            databases.set(key, db);
        });
    }
    catch(err) {
        console.log(err);
    }
}

/**
 * Get Map object filled with metadata sets for all mbtiles databases
 */
const metadatasets = new Map();
function loadMetadatasets() {
    const sql = `SELECT name, value FROM metadata UNION SELECT 'minzoom', min(zoom_level) FROM tiles ` + 
              `WHERE NOT EXISTS (SELECT * FROM metadata WHERE name='minzoom') UNION SELECT 'maxzoom', max(zoom_level) FROM tiles ` +
              `WHERE NOT EXISTS (SELECT * FROM metadata WHERE name='maxzoom')`;
    
    databases.forEach((db, key) => {
        let item = {};
        item["bounds"] = "";
        item["attribution"] = "";
        let found = false;
        
        const query = db.prepare(sql);
        for (const row of query.iterate()) {
            if (row.value != null) {
                item[row.name] = row.value;
            }
            if (row.name === "maxzoom" && row.value != null) { 
                const maxZoomInt = parseInt(row.value); 
                const sql2 = `SELECT min(tile_column) as xmin, min(tile_row) as ymin, ` + 
                             `max(tile_column) as xmax, max(tile_row) as ymax ` +
                             `FROM tiles WHERE zoom_level=?`;
                const metadata = db.prepare(sql2).get()
                const xmin = metadata.xmin;
                const ymin = metadata.ymin; 
                const xmax = metadata.xmax; 
                const ymax = metadata.ymax;  
                
                const llmin = tileToDegree(maxZoomInt, xmin, ymin);
                const llmax = tileToDegree(maxZoomInt, xmax+1, ymax+1);
                
                const retarray = `${llmin[0]}, ${llmin[1]}, ${llmax[0]}, ${llmax[1]}`;
                item["bounds"] = retarray;
                found = true;
            }
        }
        if (found) {
            metadatasets.set(key, item);
        }
    });
}
loadDatabaseList();
loadDatabases();
loadMetadatasets();

/**
 * Start the express web server
 */
const app = express();
const httpServer = http.createServer(app);
const ws = new WebSocketServer({port:appsettings.wsport});
var wswxsocket = {};

ws.on('connection', (ws) => {
    console.log("Client connected");
    wswxsocket = ws;
    parseCsv("metars");

    ws.on('message', (data) => {
        console.log(data);
    })
});

app.use(express.urlencoded({ extended: true }));
app.use(express.json({ limit: '10mb' }));
app.use(cors());

const appOptions = {
    maxAge: 900000,
    dotfiles: 'ignore',
    etag: false,
    extensions: ['html'],
    index: false,
    redirect: false,
    setHeaders: function (res, path, stat) {
        res.set('x-timestamp', Date.now());http
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        res.setHeader('Surrogate-Control', 'no-store');
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader('Access-Control-Allow-Methods', '*');
        res.setHeader("Access-Control-Allow-Headers", "*");
    }
};

app.use(express.static(ROOT_PATH, appOptions));

app.get('/', (req, res) => {
        res.sendFile(`${ROOT_PATH}/map.html`);
});

app.get("/appsettings", (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.send(JSON.stringify(appsettings));
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
    handleAirportRequest(req, res);
});

app.get("/airportlist", (req, res) => {
    Promise.resolve(handleAirportListRequest(req, res));
});

app.get("/getmapstate", async(req, res) => {
    try {
        const row = mapstatedb.prepare("SELECT state, timestamp FROM mapstate WHERE id = 1").get();
        if (row && row.state) {
            let mapstate = { state: JSON.parse(row.state), timestamp: row.timestamp };
            res.json(mapstate);
        } else {
            res.json({});
        }
    } catch (err) {
        console.error("Failed to get mapstate:", err);
        res.status(500).json({ error: err.message });
    }
});

app.post("/savemapstate", (req, res) => {
    const newState = req.body;
    const ts = newState["timestamp"];
    try {
        // Update the state and timestamp fields in the mapstate table where id = 1
        const stmt = mapstatedb.prepare("UPDATE mapstate SET state = ?, timestamp = ? WHERE id = 1");
        stmt.run(JSON.stringify(newState), ts);
        res.json({ success: true });
        console.log("Mapstate and timestamp updated successfully");
    } catch (err) {
        console.error("Failed to update mapstate:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

app.get("/metadataset", (req, res) => {
    const dbKey = req.query.db;
    if (!dbKey) {
        res.status(400).json({ error: "Missing 'db' query parameter" });
        return;
    }
    const metadata = metadatasets.get(dbKey);
    if (!metadata) {
        res.status(404).json({ error: `No metadata found for db '${dbKey}'` });
        return;
    }
    res.json({ key: dbKey, value: metadata });
    res.end();
});    

app.get("/tiles/tilesets", (req, res) => {
    const result = {};
    metadatasets.forEach((item, key) => {
        result[key] = item;
    });
    res.json(result);
});  

app.get("/tiles/*", (req, res) => {
    // Remove query string and split path
    const path = req.path; // e.g. "/tiles/chicago/5/8/11.png"
    const parts = path.split("/"); // ["", "tiles", "chicago", "5", "8", "11.png"]

    if (parts.length < 6) {
        res.status(400).send("Invalid tile URL");
        return;
    }

    const dbname = parts[2];
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
    savePositionHistory(req, res);
    res.writeHead(200);
    res.end();
});

const handleAirportListRequest = async (req, res) => {
    const { 
        closed: getclosed, 
        heliports: getheliports, 
        minLat: minLatStr, 
        maxLat: maxLatStr, 
        minLon: minLonStr, 
        maxLon: maxLonStr 
    } = req.query;

    console.log(req.query);

    // Set default headers
    res.setHeader('Content-Type', 'application/json');

    // Helper to parse booleans
    const includeClosedAirports = getclosed === 'true';
    const includeHeliports = getheliports === 'true';

    // Check if all geographic bounds are present
    if (!minLatStr || !maxLatStr || !minLonStr || !maxLonStr) {
        return res.status(200).send(JSON.stringify([]));
    }

    // Parse coordinates to floats
    const minLat = parseFloat(minLatStr);
    const maxLat = parseFloat(maxLatStr);
    const minLon = parseFloat(minLonStr);
    const maxLon = parseFloat(maxLonStr);

    if ([minLat, maxLat, minLon, maxLon].some(isNaN)) {
        return res.status(200).send(JSON.stringify([]));
    }

    try {
        var query = `SELECT ident, name, type, longitude_deg, latitude_deg, elevation_ft ` + 
                    `FROM airports ` + 
                    `WHERE latitude_deg BETWEEN ${minLat} AND ${maxLat} ` + 
                    `AND longitude_deg BETWEEN ${minLon} AND ${maxLon} `;

        if (!includeHeliports) {
            query += `AND type NOT LIKE '%heliport%' AND UPPER(name) NOT LIKE '%HELIPORT%' `;
        }

        if (!includeClosedAirports) {
            query += `AND type NOT LIKE '%closed%' AND UPPER(name) NOT LIKE '%CLOSED%' `;
        }

        query += `ORDER BY name LIMIT 200;`;
        
        const q = apdb.prepare(query)
        const rows = q.all();
        
        res.status(200).send(JSON.stringify(rows));
    } 
    catch (err) {
        // Fallback for DB connection or query errors
        console.log(err);
        res.status(200).send(JSON.stringify([]));
    }
};

httpServer.listen(8500, '0.0.0.0', () => {
    console.log('Server listening on port 8500');
});

function handleAirportRequest(req, res) {
    const id = req.query.id;
    const sql = 
    `SELECT airports.ident,airports.name,airports.type,airports.longitude_deg AS lon,` +
           `airports.latitude_deg AS lat,airports.elevation_ft AS elevation,airports.wikipedia_link, ` +
           `(SELECT json_group_array(json_object('frequency',frequency_mhz,'description',description)) ` +
     	        `FROM frequencies WHERE frequencies.airport_ident = airports.ident) AS frequencies, ` +
    	   `(SELECT json_group_array(json_object('length',length_ft,'width',width_ft,` + 
                   `'surface',surface,'le_ident',le_ident,'he_ident',he_ident)) ` +
                `FROM runways WHERE runways.airport_ident = airports.ident) AS runways ` +
    `FROM airports WHERE airports.ident = '${id}'`;
    try {
        console.log(sql);    
        const obj = apdb.prepare(sql).get();
        if (obj) {
            obj.frequencies = obj.frequencies ? JSON.parse(obj.frequencies) : [];
            obj.runways = obj.runways ? JSON.parse(obj.runways) : [];
            res.status(200).json(obj);
        }
        else {
            res.status(200).json({});
        }
    }
    catch(err) {
        console.log("Error in handleAirportRequest", err);
        res.status(200).json({});
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
        const dbname = request.params.dbname;
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
 * @param {Database} sqlite database
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
            //response.writeHead(404);
            response.end();
        } else {
            response.writeHead(200);
            response.write(row.tile_data);
            response.end();
        }
    }
    catch (err) {
        //console.error("Error in loadTile", err);
        response.writeHead(500);
        response.end();
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

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/* This function is guaranteed to run first when imported or required.
 * Place any initialization logic here.
 */
let wxdata = {};
let widx = -1;
async function parseCsv(source) {
    console.log("In parseCSV()!!");
    const delayStream = new Transform({
        objectMode:true,
        async transform(row, encoding, callback) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            this.push(row);
            callback();
        }
    });

    const parser = createReadStream(`${DIRNAME}/weather/${source}.cache.csv`)
    .pipe(csv())
    .pipe(delayStream)
    .on('data', (data) => {
        const message = {
                Type: data.metar_type,
                Location: data.station_id,
                Time: data.observation_time,
                Data: data.raw_text,
                LocaltimeReceived: new Date()
            };
        wswxsocket.send(JSON.stringify(message));
        console.log(message);
        sleep(600);
    })
    .on('end', () => {
        console.log("Done parsing CSV file");
    });
    return true;
}

/**
 * Download ADDS weather service files
 */
const xmlParseOptions = {
    ignoreAttributes : false,
    attributeNamePrefix : "",
    allowBooleanAttributes: true,
    ignoreDeclaration: true,
    isArray: (name, jpath, isLeafNode, isAttribute) => { 
        if( alwaysArray.indexOf(jpath) !== -1) return true;
    }
};
const xmlparser = new XMLParser(xmlParseOptions);

async function downloadAndExtractXML() {
    const sources = ["metars", "tafs", "aircraftreports"];

    for (const source of sources) {
        const url = appsettings.addscurrentwxurl.replace("###", source);
        const outputTmp = `${DIRNAME}/weather/${source}.json.tmp`;
        const outputFile = outputTmp.replace(".tmp", "");

        if (shouldDownload(outputFile)) {
            try {
                const response = await fetch(url);
                if (!response.ok) throw new Error(`Failed to fetch: ${response.statusText}`);

                // --- MOVE STREAM DEFINITION INSIDE THE LOOP ---
                let xmlData = ""; 
                const xmlParserStream = new Transform({
                    transform(chunk, encoding, callback) {
                        xmlData += chunk.toString();
                        callback();
                    },
                    flush(callback) {
                        try {
                            const jsonObj = xmlparser.parse(xmlData);
                            this.push(JSON.stringify(jsonObj, null, 2));
                            callback();
                        } catch (err) {
                            callback(err);
                        }
                    }
                });
                // ----------------------------------------------

                const readableStream = Readable.fromWeb(response.body);
                const decompressionStream = createGunzip();
                const fileStream = createWriteStream(outputTmp);

                console.log(`Downloading and extracting ${source}...`);
                
                await pipeline(
                    readableStream,
                    decompressionStream,
                    xmlParserStream,
                    fileStream
                );

                console.log(`File saved as: ${source}.json.tmp, renaming as ${source}.json`);
                rename(outputTmp, outputFile);
            } catch (err) {
                console.error(`Error processing ${source}:`, err.message);
            }
        } 
    }
}

function shouldDownload(outputPath) { 
    var answer = false;
    try {
        const thresholdMs = appsettings.wxupdateintervalmsec;
        
        // Get file stats
        const stats = statSync(outputPath);
        const fileAgeMs = Date.now() - stats.mtime.getTime();
        if (fileAgeMs > thresholdMs) {
            console.log(`File is ${Math.round(fileAgeMs / 60000)} minutes old. Updating...`);
            answer = true;
        } 
        else {
            console.log(`File is fresh (${Math.round(fileAgeMs / 60000)} mins old). Skipping download.`);
        }
    }
    catch (err) {
        if (err.code === 'ENOENT') {
            console.log('File does not exist. Downloading now...');
            answer = true;
        } 
        else {
            throw err;
        }
    }

    return answer;
}

async function runDownloads() {
    downloadAndExtractXML();
    setTimeout(() => {
        downloadAndExtractXML();
    }, appsettings.wxupdateintervalmsec);
}

downloadAndExtractXML();

