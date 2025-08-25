import { weatherAcronymKeymap, skyAndConditionsKeymap } from './keymaps.js';
import airportsData from './airports.json' assert { type: "json" };

// Build a fast ICAO lookup map for airports
const airportIndex = {};
for (const airport of airportsData.airports) {
    if (airport.ident) {
        airportIndex[airport.ident] = airport;
    }
}

// Helper to attach airport info to parsed output
function attachAirportInfo(station) {
    const airport = airportIndex[station];
    if (!airport) return null;

    // If isoregion begins with "US", rename "country" to "state"
    const isUS = airport.isoregion && airport.isoregion.startsWith('US');
    return {
        ident: airport.ident,
        name: airport.name,
        type: airport.type,
        elev: airport.elev,
        lon: airport.lon,
        lat: airport.lat,
        isoregion: airport.isoregion,
        [isUS ? 'state' : 'country']: airport.country
    };
}

export function parseMetarData(metarJson) {
    if (!metarJson || !metarJson.Data) return null;
    let data = metarJson.Data.replace(/\n/g, ' ').replace(/=+$/, '').trim();

    const reportTypeMatch = data.match(/^(AUTO|COR)?/);
    const windMatch = data.match(/(\d{3})(\d{2,3})(KT)/);
    const visibilityMatch = data.match(/(\d{1,2})\s?(SM)/);
    const skyMatch = data.match(/\b(CL[RU]?|FEW\d{3}|SCT\d{3}|BKN\d{3}|OVC\d{3})\b/);
    const tempDewMatch = data.match(/(\d{2})\/(\d{2})/);
    const altimeterMatch = data.match(/A(\d{4})/);
    const remarksMatch = data.match(/RMK\s+(.+)$/);

    let wind = null;
    if (windMatch) {
        wind = `${windMatch[1]}° ${windMatch[2]} ${windMatch[3]}`;
    }

    let visibility = null;
    if (visibilityMatch) {
        visibility = `${visibilityMatch[1]} ${visibilityMatch[2]}`;
    }

    let sky = null;
    let skyParsed = null;
    if (skyMatch && skyMatch[1]) {
        sky = skyMatch[1];
        const skyLayerMatch = sky.match(/([A-Z]+)(\d{3})/);
        if (skyLayerMatch) {
            skyParsed = {
                type: skyLayerMatch[1],
                altitude: skyLayerMatch[2],
                description: skyAndConditionsKeymap[skyLayerMatch[1]] || skyLayerMatch[1]
            };
            sky = `${skyParsed.type} ${skyParsed.altitude}`;
        }
    }

    let remarks = remarksMatch ? remarksMatch[1].trim() : null;

    let altimeter = null;
    const airportInfo = attachAirportInfo(metarJson.Location);
    if (altimeterMatch && altimeterMatch[1]) {
        const value = (parseInt(altimeterMatch[1], 10) / 100).toFixed(2);
        const descriptor = (airportInfo && airportInfo.isoregion && airportInfo.isoregion.startsWith('US'))
            ? 'inHg'
            : 'kPa';
        altimeter = `${value} ${descriptor}`;
    }

    return {
        type: metarJson.Type || 'METAR',
        station: metarJson.Location,
        time: metarJson.Time,
        reportType: reportTypeMatch ? reportTypeMatch[1] : null,
        wind,
        visibility,
        sky,
        temperature: tempDewMatch ? tempDewMatch[1] : null,
        dewpoint: tempDewMatch ? tempDewMatch[2] : null,
        altimeter,
        remarks,
        airport: airportInfo,
        raw: data
    };
}

export function parseTafData(tafJson) {
    if (!tafJson || !tafJson.Data) return null;
    let data = tafJson.Data.replace(/\n/g, ' ').replace(/=+$/, '').trim();

    const periodMatch = data.match(/(\d{4}\/\d{4})/);
    const changeIndicators = [...data.matchAll(/(FM\d{6}|PROB\d{2}|TEMPO|BECMG)/g)].map(m => m[1]);
    const windMatches = [...data.matchAll(/(\d{3})(\d{2,3})(KT)/g)];
    const wind = windMatches.map(match => `${match[1]} ${match[2]} ${match[3]}`);
    const visibilityMatches = [...data.matchAll(/(\d{1,2})\s?(SM|P6SM)/g)];
    const visibility = visibilityMatches.map(match => `${match[1]} ${match[2]}`);
    const skyMatches = [...data.matchAll(/(FEW\d{3}|SCT\d{3}|BKN\d{3}|OVC\d{3}|BKN\d{3}CB)/g)];
    const sky = skyMatches.map(code => code[0]);

    const wxMatches = [...data.matchAll(/\b([A-Z]{2,6})\b/g)].map(m => m[1])
        .filter(code => weatherAcronymKeymap[code]);
    const wxDescriptions = wxMatches.map(code => weatherAcronymKeymap[code]);

    const airportInfo = attachAirportInfo(tafJson.Location);

    return {
        type: tafJson.Type || 'TAF',
        station: tafJson.Location,
        time: tafJson.Time,
        period: periodMatch ? periodMatch[1] : null,
        changeIndicators,
        wind,
        visibility,
        sky,
        weather: wxMatches,
        weatherDescription: wxDescriptions,
        airport: airportInfo,
        raw: data
    };
}

export function parseTafAmdData(tafJson) {
    if (!tafJson || !tafJson.Data) return null;
    let data = tafJson.Data.replace(/\n/g, ' ').replace(/=+$/, '').trim();

    const periodMatch = data.match(/(\d{4}\/\d{4})/);
    const changeIndicators = [...data.matchAll(/(FM\d{6}|PROB\d{2}|TEMPO|BECMG)/g)].map(m => m[1]);
    const windMatches = [...data.matchAll(/(\d{3})(\d{2,3})(KT)/g)];
    const wind = windMatches.map(match => `${match[1]} ${match[2]} ${match[3]}`);
    const visibilityMatches = [...data.matchAll(/(\d{1,2})\s?(SM|P6SM)/g)];
    const visibility = visibilityMatches.map(match => `${match[1]} ${match[2]}`);
    const skyMatches = [...data.matchAll(/(FEW\d{3}|SCT\d{3}|BKN\d{3}|OVC\d{3}|BKN\d{3}CB)/g)];
    const sky = skyMatches.map(code => code[0]);

    const wxMatches = [...data.matchAll(/\b([A-Z]{2,6})\b/g)].map(m => m[1])
        .filter(code => weatherAcronymKeymap[code]);
    const wxDescriptions = wxMatches.map(code => weatherAcronymKeymap[code]);

    const airportInfo = attachAirportInfo(tafJson.Location);

    return {
        type: tafJson.Type || 'TAF.AMD',
        station: tafJson.Location,
        time: tafJson.Time,
        period: periodMatch ? periodMatch[1] : null,
        changeIndicators,
        wind,
        visibility,
        sky,
        weather: wxMatches,
        weatherDescription: wxDescriptions,
        airport: airportInfo,
        raw: data
    };
}

export function parsePirepData(pirepJson) {
    if (!pirepJson || !pirepJson.Data) return null;
    let data = pirepJson.Data.replace(/\n/g, ' ').replace(/=+$/, '').trim();

    const locationMatch = data.match(/\/OV\s*([A-Z0-9]+)/i);
    const timeMatch = data.match(/\/TM\s*(\d{4})/i);
    const flightLevelMatch = data.match(/\/FL\s*(\d{3,4})/i);
    const aircraftMatch = data.match(/\/TP\s*([A-Z0-9\-]+)/i);
    const skyMatch = data.match(/\/SK\s*([A-Z0-9]+)/i);
    const remarksMatch = data.match(/\/RM\s*(.+)$/i);

    let sky = skyMatch ? skyMatch[1] : null;
    if (sky) {
        const match = sky.match(/([A-Z]+)(\d{3})?/);
        if (match) {
            sky = match[2] ? `${match[1]} ${match[2]}` : match[1];
        }
    }

    return {
        type: pirepJson.Type || 'PIREP',
        station: pirepJson.Location,
        time: pirepJson.Time,
        location: locationMatch ? locationMatch[1] : null,
        pirepTime: timeMatch ? timeMatch[1] : null,
        flightLevel: flightLevelMatch ? flightLevelMatch[1] : null,
        aircraft: aircraftMatch ? aircraftMatch[1] : null,
        sky,
        remarks: remarksMatch ? remarksMatch[1].trim() : null,
        raw: data
    };
}

export function parseWindData(windJson) {
    if (!windJson || !windJson.Data) return null;
    let data = windJson.Data.replace(/\n/g, ' ').replace(/=+$/, '').trim();

    const headerMatch = data.match(/FT\s+([\d\s]+)/);
    const levels = headerMatch
        ? headerMatch[1].trim().split(/\s+/)
        : [];

    const windTempGroups = [];
    const groupRegex = /(\d{2})(\d{2})([+-]\d{2})/g;
    let groupMatch;
    let groupDataLine = data.replace(/FT\s+[\d\s]+/, '').trim();
    while ((groupMatch = groupRegex.exec(groupDataLine)) !== null) {
        windTempGroups.push({
            direction: groupMatch[1],
            speed: groupMatch[2],
            temperature: groupMatch[3]
        });
    }

    const winds = levels.map((level, i) => ({
        level,
        direction: windTempGroups[i] ? windTempGroups[i].direction : null,
        speed: windTempGroups[i] ? windTempGroups[i].speed : null,
        temperature: windTempGroups[i] ? windTempGroups[i].temperature : null
    })).filter(w =>
        w.direction !== null || w.speed !== null || w.temperature !== null
    );

    const airportInfo = attachAirportInfo(windJson.Location);

    return {
        type: windJson.Type || 'WINDS',
        station: windJson.Location,
        stationName: airportInfo ? airportInfo.name : null,
        time: windJson.Time,
        winds,
        raw: data
    };
}