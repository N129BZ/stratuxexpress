import express from 'express';
import favicon from 'serve-favicon';
import cors from 'cors';
import { atan, exp, pi, pow } from 'mathjs';
import fs from 'fs';
import { WebSocketServer } from 'ws';
import Database from 'better-sqlite3';

//////////////////////////////////////////////////////////
// download link for airport, runway, and frequency data:
// https://davidmegginson.github.io/ourairports-data/
//////////////////////////////////////////////////////////

const DIRNAME   = process.cwd();
const ROOT_PATH = `${DIRNAME}/dist`;
const DB_PATH   = `${ROOT_PATH}/data`;
const TILE_PATH = `${ROOT_PATH}/tiles`;

let histdb;
const apdb = new Database(`${DIRNAME}/airports.db`, {readonly: true});
const databaselist = new Map();
const databases    = new Map();
const metadatasets = new Map();

// (function main() {
    
//     try {
//        let ws = new WebSocket("ws://127.0.0.1/weather");
//        ws.onmessage = (event) => {
//             let x;
//             let t;
//             let j = JSON.parse(event.data);
//             t = j.Type;
//             if (t === "METAR" || t === "SIGMET") {
//                 x = parseMetarData(j);
//             }
//             else if (t == "TAF") {
//                 x = parseTafData(j); 
//             }
//             else if (t == "PIREP") {
//                 x = parsePirepData(j); 
//             }
//             else if (t == "WINDS") {
//                 x = parseWindData(j); 
//             }
//             console.log(t, formatMessageDisplay(x));
//             // Append message to weather.log in the root directory
//             // fs.appendFile(`${DIRNAME}/stratuxweather.log`, event.data + '\n', (err) => {
//             //     if (err) {
//             //         console.error("Failed to write to weather.log:", err);
//             //     }
//             // });
//        };
//     }
//     catch (err) {
//         console.log(err);
//     }
// })();


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
        let dbfiles = fs.readdirSync(TILE_PATH);
        dbfiles.forEach((dbname) => {
            if (dbname.endsWith(".db") || dbname.endsWith(".mbtiles")) {
                const key = dbname.toLowerCase().split(".")[0];
                const dbfile = `${TILE_PATH}/${dbname}`;
                databaselist.set(key, dbfile);
            }
        });
    } 
    catch(error) {
        console.error(error.message);
    }

    databaselist.forEach((dbfile, key) => {
        try {
            const db = new Database(dbfile, {readonly: true});
            databases.set(key, db);
        } catch (error) {
            console.error(`Failed to load: ${key}: ${error}`);
        }
    });

    try {
        histdb = new Database(`${DB_PATH}/positionhistory.db`, {readonly: true});
    } catch (error) {
        console.log(`Failed to load historyDb: ${error}`);
    }
              `WHERE NOT EXISTS (SELECT * FROM metadata WHERE name='minzoom') UNION SELECT 'maxzoom', max(zoom_level) FROM tiles ` +
              `WHERE NOT EXISTS (SELECT * FROM metadata WHERE name='maxzoom')`;
    
    databases.forEach((db, key) => {
        let item = {};
        item["bounds"] = "";
        item["attribution"] = "";
        let found = false;
        try {
            const selall = db.prepare(sql);
            const metarows = selall.all();
            metarows.forEach((row) => {
                if (row.value != null && row.value != undefined) {
                    item[row.name] = row.value;
                    if (row.name === "maxzoom") { 
                        let maxZoomInt = parseInt(row.value);
                        sql = `SELECT min(tile_column) as xmin, min(tile_row) as ymin, ` + 
                                    `max(tile_column) as xmax, max(tile_row) as ymax ` +
                                `FROM tiles WHERE zoom_level=${maxZoomInt}`;
                        try {
                            const selminmax = db.prepare(sql);
                            const minmaxrow = selminmax.get();
                            if (minmaxrow != null && minmaxrow != undefined) {
                                let xmin = minmaxrow.xmin;
                                let ymin = minmaxrow.ymin; 
                                let xmax = minmaxrow.xmax; 
                                let ymax = minmaxrow.ymax;  
                                
                                let llmin = tileToDegree(maxZoomInt, xmin, ymin);
                                let llmax = tileToDegree(maxZoomInt, xmax+1, ymax+1);
                                
                                let retarray = `${llmin[0]}, ${llmin[1]}, ${llmax[0]}, ${llmax[1]}`;
                                item["bounds"] = retarray;
                                found = true;
                            }
                        }
                        catch(error) {
                            console.error(error);
                        }
                    }
                }
            });
            metadatasets.set(key, item);
        }
        catch(error) {
            console.error(error);
        }
    });
}

function loadMetadatasets() {

}
/**
 * Start the express web server
 */
let app = express();
try {
    app.use(express.urlencoded({ extended: true }));
    app.use(express.json({}));
    app.use(cors());
    app.use(favicon(`${ROOT_PATH}/images/favicon.png`));
    app.listen(8500, '0.0.0.0'); 

    console.log(`Server listening on port 8500`);

    let appOptions = {
        maxAge: 900000,
        dotfiles: 'ignore',
        etag: false,
        extensions: ['html'],
        index: false,
        redirect: false,
        setHeaders: function (res, path, stat) {
            res.set('x-timestamp', Date.now());
            res.setHeader("Access-Control-Allow-Origin", "*");
            res.setHeader('Access-Control-Allow-Methods', '*');
            res.setHeader("Access-Control-Allow-Headers", "*");                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             
        }
    };

    app.use(express.static(ROOT_PATH, appOptions));
    
    app.get('/', (req, res) => {
        res.sendFile(`${ROOT_PATH}/index.html`);
    });
    
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

    app.get("/airport/:id", (req, res) => {
        let id = req.params.id;
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

    app.get("/tiles/:zyx(*)", async(req, res) => {
        let parts = req.url.split("/");
        let db = databases.get(parts[2]);
        await handleTile(req, res, db);
    });

    app.get("/gethistory", (req,res) => {
        getPositionHistory(res);
    });

    app.post("/savehistory", (req, res) => {
        savePositionHistory(req.body);
        res.writeHead(200);
        res.end();
    });
}
catch(error) {
    console.error(error);
}

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

/**
 * Parse the z,x,y integers, validate, and pass along to loadTile
 * @param {request} http request 
 * @param {response} http response 
 * @param {db} database 
 * @returns the results of calling loadTile
 */
async function handleTile(request, response, db) {
    let x = 0;
    let y = 0;
    let z = 0;
    let idx = -1;

    let parts = request.params.zxy.split("/"); 
	if (parts.length < 5) {
		return
	}

	try {
        idx = parts.length - 1;
        let yparts = parts[idx].split(".");
        y = parseInt(yparts[0])

    } 
    catch(err) {
        res.writeHead(500, "Failed to parse y");
        response.end();
        return;
    }
    
    idx--
    x = parseInt(parts[idx]);
    idx-- 
    z = parseInt(parts[idx]);
    idx--
    await loadTile(z, x, y, response, db); 
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
async function loadTile(z, x, y, response, db) {
    let sql = `SELECT tile_data FROM tiles WHERE zoom_level=${z} AND tile_column=${x} AND tile_row=${y}`;
    db.get(sql, (err, row) => {
        if (!err) {
            if (row == undefined) {
                response.writeHead(200);
                response.end();
            }
            else {
                if (row.tile_data != undefined) {
                    let png = row.tile_data;
                    response.writeHead(200);
                    response.write(png);
                    response.end();
                }
            }
        }
        else {
            console.log(err);
            response.writeHead(500, err.message);
            response.end();
        } 
    });
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

function sendJsonData(filename, textData) {
    try {
        fs.appendFileSync(filename, textData + '\n', 'utf8');
        console.log(`Appended data to ${filename}`);
    } catch (err) {
        console.error(`Failed to append data to ${filename}:`, err);
    }
}

// Async sleep function
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Usage in an async function
async function example() {
    console.log('Start');
    await sleep(1000); // sleep for 1 second
    console.log('End');
}

/**
 * This function is guaranteed to run first when imported or required.
 * Place any initialization logic here.
 */
let wxdata = {};
let widx = -1;
let wswxsocket = {};

(function startupInit() {

    const wss = new WebSocketServer({ port: 8550 });

    wss.on('connection', (ws) => {
        console.log('Client connected.');
        wswxsocket = ws;
        if (readJson()) {
            if (wxdata.weather && Array.isArray(wxdata.weather)) {
                setInterval(sendWeatherReport, 1000); // 1000 ms = 1 second
            }
        }

        ws.on('close', () => {
            console.log('Client disconnected.');
        });

    });
})();

function readJson() {
    let fname = `${DIRNAME}/stratuxweather.json`;
    let data = fs.readFileSync(fname, { encoding: 'utf-8' }); 
    try {
        wxdata = JSON.parse(data);
        console.log("Success reading weather log");
        return true;
    } catch (parseErr) {
        console.error('Error parsing JSON:', parseErr);
    }
    return false;
}

function sendWeatherReport() {
    widx ++;
    let rpt = wxdata.weather[widx];
    wswxsocket.send(JSON.stringify(rpt));
    if (widx === wxdata.weather.length - 1) {
        widx = -1;
    }
}