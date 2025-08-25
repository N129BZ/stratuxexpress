/**
 * Returns a formatted string for display based on the parsed message type.
 * Supports METAR, TAF, PIREP, WINDS.
 */
export function formatMessageDisplay(parsedMessage) {
    if (!parsedMessage || !parsedMessage.station) return 'No data available.';

    switch (parsedMessage.type || parsedMessage.Type) {
        case 'METAR':
            return `${parsedMessage.station}${parsedMessage.airport && parsedMessage.airport.name ? ' - ' + parsedMessage.airport.name : ''}\n` +
                   `Time: ${parsedMessage.time}\n` +
                   `Wind: ${parsedMessage.wind}\n` +
                   `Visibility: ${parsedMessage.visibility}\n` +
                   `Sky: ${parsedMessage.sky}\n` +
                   `Temperature/Dewpoint: ${parsedMessage.temperature}/${parsedMessage.dewpoint}\n` +
                   `Altimeter: ${parsedMessage.altimeter}\n` +
                   (parsedMessage.remarks ? `Remarks: ${parsedMessage.remarks}\n` : '');

        case 'TAF':
            return `${parsedMessage.station}${parsedMessage.airport && parsedMessage.airport.name ? ' - ' + parsedMessage.airport.name : ''}\n` +
                   `Time: ${parsedMessage.time}\n` +
                   `Period: ${parsedMessage.period}\n` +
                   `Wind: ${parsedMessage.wind.join(', ')}\n` +
                   `Visibility: ${parsedMessage.visibility.join(', ')}\n` +
                   `Sky: ${parsedMessage.sky.join(', ')}\n` +
                   (parsedMessage.weather && parsedMessage.weather.length ? `Weather: ${parsedMessage.weather.join(', ')}\n` : '');

        case 'PIREP':
            return `${parsedMessage.station}\n` +
                   `Time: ${parsedMessage.time}\n` +
                   `Location: ${parsedMessage.location}\n` +
                   `Flight Level: ${parsedMessage.flightLevel}\n` +
                   `Aircraft: ${parsedMessage.aircraft}\n` +
                   `Sky: ${parsedMessage.sky}\n` +
                   (parsedMessage.remarks ? `Remarks: ${parsedMessage.remarks}\n` : '');

        case 'WINDS':
            return `${parsedMessage.station}${parsedMessage.stationName ? ' - ' + parsedMessage.stationName : ''}\n` +
                   `Time: ${parsedMessage.time}\n` +
                   parsedMessage.winds.map(w =>
                       `Level: ${w.level}, Dir: ${w.direction}, Speed: ${w.speed}, Temp: ${w.temperature}`
                   ).join('\n');

        default:
            return 'Unknown message type or format.';
    }
}