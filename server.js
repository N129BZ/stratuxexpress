
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
//import { appsettings } from './appsettings.json' with { type: 'json' };
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import { XMLHttpRequest } from "xmlhttprequest";
import { XMLParser } from 'fast-xml-parser';
import fs from 'fs/promises';

//////////////////////////////////////////////////////////////
// Download link for airport, runway, and frequency csv data:
//    https://davidmegginson.github.io/ourairports-data/
//////////////////////////////////////////////////////////////

const settingsPath = new URL('./appsettings.json', import.meta.url);
const appsettings = JSON.parse(await fs.readFile(settingsPath, 'utf-8'));
const DIRNAME = import.meta.dirname;
const ROOT_PATH = `${DIRNAME}/dist`;
const DB_PATH = `${ROOT_PATH}/data`;
const TILE_PATH = `${DIRNAME}/tiles`;

const apdb = new DatabaseSync(`${DIRNAME}/airports.db`, { readOnly: true });
const mapstatedb = new DatabaseSync(`${DIRNAME}/mapstate.db`, { readOnly: false });
const connections = new Map();

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
    catch (err) {
        console.log("NO CHART DATABASES FOUND!!");
    }
}

const databases = new Map();
function loadDatabases() {
    try {
        databaselist.forEach((dbfile, key) => {
            console.log(dbfile);
            const db = new DatabaseSync(dbfile, { readOnly: true });
            databases.set(key, db);
        });
    }
    catch (err) {
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
                const llmax = tileToDegree(maxZoomInt, xmax + 1, ymax + 1);

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
const wss = new WebSocketServer({ port: appsettings.wsport });

(() => {
    try {
        wss.on('connection', async (ws) => {
            const id = Date.now();
            ws.tag = id;
            connections.set(ws, id);
            console.log(`Websocket connected, id: ${id}`);

            await sendWeatherData();

            ws.on('close', function () {
                connections.delete(ws);
                console.log(`Websocket closed, id: ${ws.tag}`);
            });

            ws.on('message', (data) => { });
        });
    }
    catch (err) {
        console.log(err);
    }
})();

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
        res.set('x-timestamp', Date.now()); http
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
    res.send(JSON.stringify(appsettings)).end();
});

app.get("/databaselist", (req, res) => {
    let obj = [];
    databaselist.forEach((value, key) => {
        obj.push(key);
    });
    res.json(obj).end();
});

app.get("/airport", (req, res) => {
    handleAirportRequest(req, res);
});

app.get("/airportlist", (req, res) => {
    handleAirportListRequest(req, res);
});

app.get("/getmapstate", async (req, res) => {
    try {
        const row = mapstatedb.prepare("SELECT state FROM mapstate WHERE id = 1").get();
        if (row && row.state) {
            let mapstate = { state: JSON.parse(row.state) }; //, timestamp: row.timestamp };
            res.status(200).json(mapstate);
        } else {
            res.json({});
        }
    } catch (err) {
        console.error("Failed to get mapstate:", err);
        res.status(204);
    }
});

app.post("/savemapstate", (req, res) => {
    const newState = req.body;
    const ts = newState["timestamp"];
    try {
        // Update the state and timestamp fields in the mapstate table where id = 1
        const stmt = mapstatedb.prepare("UPDATE mapstate SET state = ? WHERE id = 1");
        stmt.run(JSON.stringify(newState));
        res.status(204).end();
        console.log("Mapstate updated successfully");
    }
    catch (err) {
        console.error("Failed to update mapstate:", err);
        res.status(204).end();
    }
});

app.get("/metadataset", (req, res) => {
    const dbKey = req.query.db;
    if (!dbKey) {
        res.status(400).json({ error: "Missing 'db' query parameter" }).end();
        return;
    }
    const metadata = metadatasets.get(dbKey);
    if (!metadata) {
        res.status(404).json({ error: `No metadata found for db '${dbKey}'` }).end();
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
    res.json(result).end();
});

app.get("/tiles/*", (req, res) => {
    // Remove query string and split path
    const path = req.path; // e.g. "/tiles/chicago/5/8/11.png"
    const parts = path.split("/"); // ["", "tiles", "chicago", "5", "8", "11.png"]

    if (parts.length < 6) {
        res.status(400).send("Invalid tile URL").end();
        return;
    }

    const dbname = parts[2];
    const z = parseInt(parts[3]);
    const x = parseInt(parts[4]);
    const yRaw = parts[5];
    const y = parseInt(yRaw.split(".")[0]);
    const db = databases.get(dbname);

    if (!db) {
        res.status(404).send("Database not found").end();
        return;
    }
    loadTile(z, x, y, res, db);
});

app.get("/gethistory", (req, res) => {
    getPositionHistory(res);
});

app.post("/savehistory", (req, res) => {
    savePositionHistory(req, res);
    res.writeHead(200).end();
});

app.post("/setdefaultposition", (req, res) => {

}); 

function handleAirportListRequest(req, res) {
    const {
        minLat: minLatStr,
        maxLat: maxLatStr,
        minLon: minLonStr,
        maxLon: maxLonStr
    } = req.query;

    console.log(req.query);

    // Set default headers
    res.setHeader('Content-Type', 'application/json');

    // Check if all geographic bounds are present
    if (!minLatStr || !maxLatStr || !minLonStr || !maxLonStr) {
        res.status(200).send(JSON.stringify([])).end();
        return;
    }

    // Parse coordinates to floats
    const minLat = parseFloat(minLatStr);
    const maxLat = parseFloat(maxLatStr);
    const minLon = parseFloat(minLonStr);
    const maxLon = parseFloat(maxLonStr);

    if ([minLat, maxLat, minLon, maxLon].some(isNaN)) {
        res.status(200).json({}).end();
        return;
    }

    try {
        let sql =
            `SELECT airports.ident,airports.name,airports.type,airports.longitude_deg AS lon,` +
            `airports.latitude_deg AS lat,airports.elevation_ft AS elevation,airports.wikipedia_link, ` +
            `(SELECT json_group_array(json_object('frequency',frequency_mhz,'description',description)) ` +
            `FROM frequencies WHERE frequencies.airport_ident = airports.ident) AS frequencies, ` +
            `(SELECT json_group_array(json_object('length',length_ft,'width',width_ft,` +
            `'surface',surface,'le_ident',le_ident,'he_ident',he_ident)) ` +
            `FROM runways WHERE runways.airport_ident = airports.ident) AS runways ` +
            `FROM airports WHERE airports.latitude_deg BETWEEN ${minLat} AND ${maxLat} ` +
            `AND airports.longitude_deg BETWEEN ${minLon} AND ${maxLon} `;

        if (!appsettings.getHeliports) {
            sql += `AND type NOT LIKE '%heliport%' AND UPPER(name) NOT LIKE '%HELIPORT%' `;
        }

        if (!appsettings.getClosedAirports) {
            sql += `AND type NOT LIKE '%closed%' AND UPPER(name) NOT LIKE '%CLOSED%'; `;
        }

        console.log(sql);
        try {
            const rows = apdb.prepare(sql).all();
            // Convert the SQLite JSON strings into native JS Arrays for all returned airports
            const mappedRows = rows.map(airport => ({
                ...airport,
                frequencies: airport.frequencies ? JSON.parse(airport.frequencies) : [],
                runways: airport.runways ? JSON.parse(airport.runways) : []
            }));

            if (rows) {
                console.log(mappedRows);
                res.status(200).json(mappedRows).end();
            }
            else {
                res.status(200).json({}).end();
            }
        }
        catch (err) {
            console.log("Error in handleAirportRequest", err);
            res.status(200).json({}).end();
        }
    }
    catch (err) {
        console.log("Error in handleAirportListRequest", err);
        res.status(200).json({}).end();
    }
};

httpServer.listen(8500, '0.0.0.0', () => {
    console.log('Server listening on port 8500');
});

async function handleAirportRequest(req, res) {
    const id = req.query.id;
    res.setHeader('Content-Type', 'application/json');
    let sql =
        `SELECT airports.ident,airports.name,airports.type,airports.longitude_deg AS lon,` +
        `airports.latitude_deg AS lat,airports.elevation_ft AS elevation,airports.wikipedia_link, ` +
        `(SELECT json_group_array(json_object('frequency',frequency_mhz,'description',description)) ` +
        `FROM frequencies WHERE frequencies.airport_ident = airports.ident) AS frequencies, ` +
        `(SELECT json_group_array(json_object('length',length_ft,'width',width_ft,` +
        `'surface',surface,'le_ident',le_ident,'he_ident',he_ident)) ` +
        `FROM runways WHERE runways.airport_ident = airports.ident) AS runways ` +
        `FROM airports WHERE airports.ident = '${id}';`;

    try {
        console.log(sql);
        const obj = apdb.prepare(sql).get();
        if (obj) {
            res.status(200).json(obj).end();
        }
        else {
            res.status(200).json({}).end();
        }
    }
    catch (err) {
        console.log("Error in handleAirportRequest", err);
        res.status(200).json({}).end();
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
        response.status(500).send("Failed to parse tile parameters").end();
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
    let n = pi - 2.0 * pi * y / pow(2, z);
    let lat = 180.0 / pi * atan(0.5 * (exp(n) - exp(-n)));
    let lon = x / pow(2, z) * 360.0 - 180.0;
    return [lon, lat]
}

/* This function is guaranteed to run first when imported or required.
 * Place any initialization logic here.
 */
let wxdata = {};
let widx = -1;

// Helper function for sleeping
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function sendWeatherData() {
    console.log('In sendWeatherData()!!');

    const sources = ["metars", "tafs", "aircraftreports"];

    for (const source of sources) {
        const filePath = `${DIRNAME}/weather/${source}.json`;
        const jsonData = await getJsonDataFromFile(filePath);
        const responseData = jsonData.response.data;
        await sendMessageToClients(JSON.stringify(responseData));
    }
}

/**
 * Iterate through any/all connected clients and send data
 * @param {string} stringified json message 
 */
async function sendMessageToClients(jsonmessage) {
    [...connections.keys()].forEach((client) => {
        client.send(jsonmessage);
    });
}

/**
 * Reads a local weather JSON file and extracts the raw text strings.
 * @param {string} filePath - Path to your local .json file
 * @returns {Promise<Array<string>>}
 */
async function getJsonDataFromFile(filePath) {
    try {
        const fileContent = await fs.readFile(filePath, 'utf8');
        const jsonResponse = JSON.parse(fileContent);
        return jsonResponse;

    } catch (error) {
        console.error(`Error reading file at ${filePath}:`, error);
        return {};
    }
}


/**
 * Download ADDS weather service files
 */
const alwaysArray = [
    'response.data.METAR', // Example matching your METAR array path
    'response.data.TAF',
    'respomse.data.AviationReport'
];
const xmlParseOptions = {
    ignoreAttributes: false,
    attributeNamePrefix: "",
    allowBooleanAttributes: true,
    ignoreDeclaration: true,
    isArray: (name, jpath, isLeafNode, isAttribute) => {
        if (alwaysArray.indexOf(jpath) !== -1) {
            return true;
        }
        return false;
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
                if (connections.length > 0) {
                    sendWeatherData();
                }
            } catch (err) {
                console.error(`Error processing ${source}:`, err.message);
            }
        }
    }
}

async function downloadAndExtractCSV() {
    const sources = ["metars", "tafs", "aircraftreports"];

    for (const source of sources) {
        const url = appsettings.addscurrentwxurlcsv.replace("###", source);
        const outputTmp = `${DIRNAME}/weather/${source}.csv.tmp`;
        const outputFile = outputTmp.replace(".tmp", "");

        if (shouldDownload(outputFile)) {
            try {
                const response = await fetch(url);
                if (!response.ok) throw new Error(`Failed to fetch: ${response.statusText}`);


                // --- MOVE STREAM DEFINITION INSIDE THE LOOP ---
                let csvData = "";
                const csvParserStream = new Transform({
                    transform(chunk, encoding, callback) {
                        csvData += chunk.toString();
                        callback();
                    },
                    flush(callback) {
                        try {
                            console.log(csvData);
                            this.push(csvData);
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
                    csvParserStream,
                    fileStream
                );

                console.log(`File saved as: ${source}.json.tmp, renaming as ${source}.json`);
                rename(outputTmp, outputFile);
                //parseCsv(outputFile, source);
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

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function runDownloads() {
    while (true) {
        try {
            await downloadAndExtractXML();
            if (connections.length > 0) {
                await sendWeatherData();
            }
        } catch (error) {
            console.error("Error in download cycle:", error);
        }

        // Wait cleanly for the specified interval before looping again
        await delay(appsettings.wxupdateintervalmsec);
    }
}

runDownloads();

process.on('exit', () => {
    connections.clear();
    console.log("Connections array cleared.")
});