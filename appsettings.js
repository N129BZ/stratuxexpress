export const appsettings = {
    wxupdateintervalmsec:  480000,
    keepaliveintervalmsec:  30000,
    httpport:  8500,
    wsport:  8550,
    startupzoom:  9,
    useOSMonlinemap:  true,
    debug:  false,
    externalcharts:  "/home/bro/Sources/chartmaker/public/charts/08-07-2025",
    uselocaltime:  true,
    distanceunit:  "sm",
    maxmetarcount:  800,
    animatedwxurl:  "https://mesonet.agron.iastate.edu/cgi-bin/wms/nexrad/n0r-t.cgi",
    addswxurl:  "https://aviationweather.gov/api/data/###?&format=xml&hours=1.5",
    addscurrentwxurl:  "https://aviationweather.gov/data/cache/###.cache.csv.gz",
    showattribution:  true,
    lockownshiptocenter:  true,
    usemetricunits:  false,
    distanceunits:  {
        kilometers:  "km",
        nauticalmiles:  "nm",
        statutemiles:  "sm"
    }
};
