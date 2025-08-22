'use strict'

import express from 'express';
import favicon from 'serve-favicon';
import cors from 'cors';
import Database from 'better-sqlite3';
import {atan, exp, pi, pow } from 'mathjs'
import fs from 'fs';

// const express = require('express');
// const favicon = require('serve-favicon');
// const cors = require('cors');
// const sqlite3 = require('sqlite3');
// const Math = require("math");
// const fs = require("fs");
// const WebSocket = require('ws');
// const { execSync, exec } = require('child_process');

const DIRNAME   = process.cwd();
const ROOT_PATH = `${DIRNAME}/dist`;
const DB_PATH   = `${ROOT_PATH}/data`;
const TILE_PATH = `${ROOT_PATH}/tiles`;

let histdb;
const databaselist = new Map();
const databases    = new Map();
const metadatasets = new Map();

let airports = {};
loadAirportList();
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
    }
    catch (error) {
        console.log(`Failed to load: ${settings.historyDb}: ${err}`);
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

function loadAirportList() {
    let apdata = fs.readFileSync(`${DB_PATH}/airports.json`);
    airports = JSON.parse(apdata);
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
    
    app.get("/getsettings", (req, res) => {
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

    app.get("/tiles/*", async(req, res) => {
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
catch (err) {
    console.log(err);
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

    let parts = request.url.split("/"); 
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

