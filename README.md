# DEM lookup by coordinate using PMTiles

## Features

- provides a way to use a Geotiff Terrain model in a webapp using [Protomaps](https://protomaps.com/) encoding
- provide an example web app demonstrating terrain lookup and a leaflet map

## Demo

[Try it here](https://static.mah.priv.at/apps/DEM-lookup-PMtiles/)

## Map conversion

see the [conversion script](pmtiles/geotiff-dem-2-pmtiles.sh)

Usage:

`````
pmtiles/geotiff-dem-2-pmtiles.sh --help
Usage: pmtiles/geotiff-dem-2-pmtiles.sh [OPTIONS] file1.tif [file2.tif ...]

Convert GeoTIFF DEM files to terrain-rgb encoded PMTiles with WebP lossless compression.

OPTIONS:
    -t, --tile-size SIZE    Tile size in pixels (default: 256)
    -d, --target-dir DIR    Target directory for output PMTiles files
                           (default: current directory)
    -v, --verbose          Enable verbose output
    --no-cleanup           Keep intermediate files (for debugging)
    -h, --help             Show this help message

EXAMPLES:
    pmtiles/geotiff-dem-2-pmtiles.sh dem.tif
    pmtiles/geotiff-dem-2-pmtiles.sh --tile-size 512 --target-dir ./output *.tif
    pmtiles/geotiff-dem-2-pmtiles.sh -t 256 -d /path/to/output dem1.tif dem2.tif

REQUIREMENTS:
    - GDAL (gdalwarp, gdal_translate)
    - rasterio/rio-rgbify (rio rgbify)
    - rio-pmtiles (rio pmtiles)

The script performs the following steps for each input file:
1. Reproject to Web Mercator (EPSG:3857)
2. Convert to terrain-rgb encoding (base -10000, interval 0.1)
3. Generate PMTiles with WebP lossless compression
4. Clean up intermediate files (unless --no-cleanup is used)
`````

The script requires a working installation of GDAL and several Python packages:

`````shell
brew install gdal
pip install rasterio rio-rgbify rio-pmtiles
`````

## Usage in a Web app

see src/utils/DEMLookup.ts

## Geotiff DEM's

I used <https://sonny.4lima.de/> as source.

### Development

> Just run and visit <http://localhost:3000>

```bash
## install dependencies
npm install

## set up
npm run dev
```

### Build

```bash
## build
npm run build
```

## License

[MIT](http://opensource.org/licenses/MIT)
Copyright (c) 2025 Michael Haberler
