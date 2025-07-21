import { PMTiles, TileType } from 'pmtiles';

export interface DEMInfo {
  bounds: [number, number, number, number]; // [minLon, minLat, maxLon, maxLat]
  minZoom: number;
  maxZoom: number;
  tileType: TileType;
  metersPerPixel: number;
  encoding: string;
  attribution?: string;
  tileSize: number; // Tile size in pixels (e.g., 256, 512)
}

export interface ElevationResult {
  elevation: number; // elevation in meters
  metersPerPixel: number;
  rgbValues: [number, number, number];
  tileCoords: [number, number, number]; // [x, y, z]
}

export interface TileCache {
  [key: string]: ArrayBuffer;
}

export interface BoundingBox {
  north: number;
  south: number;
  east: number;
  west: number;
}

export class DEMLookup {
  private pmtiles: PMTiles;
  private cache: TileCache = {};
  private maxCacheSize: number = 100;
  private debug: boolean = false;
  private demInfo?: DEMInfo;
  private webpSupported: boolean = false;

  constructor(
    url: string,
    options: {
      maxCacheSize?: number;
      debug?: boolean;
    } = {},
  ) {
    this.maxCacheSize = options.maxCacheSize || 100;
    this.debug = options.debug || false;

    if (this.debug) {
      console.log(`DEMLookup initialized with URL: ${url}`);
    }

    this.pmtiles = new PMTiles(url);
    this.checkWebPSupport();
    this.initializeDEMInfo();
  }

  private async checkWebPSupport(): Promise<void> {
    return new Promise((resolve) => {
      const webP = new Image();
      webP.onload = webP.onerror = () => {
        this.webpSupported = webP.height === 2;
        if (this.debug) {
          console.log(`WebP support: ${this.webpSupported ? 'Yes' : 'No'}`);
        }
        resolve();
      };
      webP.src =
        'data:image/webp;base64,UklGRjoAAABXRUJQVlA4IC4AAACyAgCdASoCAAIALmk0mk0iIiIiIgBoSygABc6WWgAA/veff/0PP8bA//LwYAAA';
    });
  }

  private async initializeDEMInfo(): Promise<void> {
    try {
      if (this.debug) {
        console.log('PMTiles initialized:', this.pmtiles);
      }

      const header = await this.pmtiles.getHeader();
      const metadata = await this.pmtiles.getMetadata();

      if (this.debug) {
        console.log('Metadata:', metadata);
      }

      // Check for tile size in metadata first, then fall back to autodetection
      let tileSize: number;
      const metadataTileSize = (metadata as any)?.tileSize;

      if (metadataTileSize && typeof metadataTileSize === 'number' && metadataTileSize > 0) {
        tileSize = metadataTileSize;
        if (this.debug) {
          console.log(`Using tile size from metadata: ${tileSize}px`);
        }
      } else {
        if (this.debug) {
          console.log('No tile size in metadata, detecting from sample tile...');
        }
        tileSize = await this.detectTileSize(header);
      }

      this.demInfo = {
        bounds: [header.minLon, header.minLat, header.maxLon, header.maxLat],
        minZoom: header.minZoom,
        maxZoom: header.maxZoom,
        tileType: header.tileType,
        tileSize: tileSize,
        metersPerPixel: this.calculateMetersPerPixel(header.maxZoom, tileSize),
        encoding: header.tileType === TileType.Png ? 'PNG' : 'WebP',
        attribution: (metadata as any)?.attribution,
      };
    } catch (error) {
      console.error('Failed to initialize DEM info:', error);
      throw error;
    }
  }

  private async detectTileSize(header: any): Promise<number> {
    try {
      // Try to fetch a tile from the middle zoom level to detect its size
      const testZoom = Math.floor((header.minZoom + header.maxZoom) / 2);
      const centerX = Math.floor(Math.pow(2, testZoom) / 2);
      const centerY = Math.floor(Math.pow(2, testZoom) / 2);

      const tileResult = await this.pmtiles.getZxy(testZoom, centerX, centerY);
      if (tileResult?.data) {
        const blob = new Blob([tileResult.data]);
        const imageBitmap = await createImageBitmap(blob);
        const size = imageBitmap.width; // Assuming square tiles
        imageBitmap.close();

        if (this.debug) {
          console.log(`Detected tile size: ${size}x${size} pixels`);
        }

        return size;
      }
    } catch (error) {
      if (this.debug) {
        console.warn('Could not detect tile size, using default 256:', error);
      }
    }

    // Default to 256 if detection fails
    return 256;
  }

  private calculateMetersPerPixel(zoom: number, tileSize: number = 256): number {
    // Earth's circumference at equator in meters / tiles at zoom level / pixels per tile
    const earthCircumference = 40075016.686;
    const tilesAtZoom = Math.pow(2, zoom);
    return earthCircumference / (tilesAtZoom * tileSize);
  }

  async getElevation(lat: number, lon: number): Promise<ElevationResult | null> {
    if (!this.demInfo) {
      await this.initializeDEMInfo();
    }

    const zoom = this.demInfo!.maxZoom;
    const tileCoords = this.latLonToTile(lat, lon, zoom);
    const [x, y, z] = tileCoords;

    if (this.debug) {
      console.log(`Getting elevation for lat: ${lat}, lon: ${lon}, zoom: ${zoom}, tile: ${x}/${y}/${z}`);
    }

    const tileKey = `${z}/${x}/${y}`;
    let tileData = this.cache[tileKey];

    if (!tileData) {
      if (this.debug) {
        console.log(`Cache miss for tile: ${tileKey}, fetching...`);
      }
      const fetchedTileData = await this.fetchTile(x, y, z);
      if (!fetchedTileData) {
        return null;
      }
      tileData = fetchedTileData;
      this.addToCache(tileKey, tileData);
    } else if (this.debug) {
      console.log(`Cache hit for tile: ${tileKey}`);
    }

    // Calculate pixel coordinates within the tile
    const pixelCoords = this.latLonToPixel(lat, lon, zoom);
    const tileSize = this.demInfo!.tileSize;
    const tilePixelX = pixelCoords.x % tileSize;
    const tilePixelY = pixelCoords.y % tileSize;

    if (this.debug) {
      console.log(
        `Extracting elevation at pixel (${tilePixelX}, ${tilePixelY}) from tile data (${tileData.byteLength} bytes)`,
      );
    }

    const elevation = await this.extractElevationFromTile(tileData, tilePixelX, tilePixelY);

    if (elevation === null) {
      return null;
    }

    return {
      elevation: elevation.elevation,
      metersPerPixel: this.demInfo!.metersPerPixel,
      rgbValues: elevation.rgbValues,
      tileCoords: [x, y, z],
    };
  }

  private async fetchTile(x: number, y: number, z: number): Promise<ArrayBuffer | null> {
    try {
      const tileResult = await this.pmtiles.getZxy(z, x, y);
      return tileResult?.data || null;
    } catch (error) {
      if (this.debug) {
        console.error(`Failed to fetch tile ${z}/${x}/${y}:`, error);
      }
      return null;
    }
  }

  private async extractElevationFromTile(
    tileData: ArrayBuffer,
    pixelX: number,
    pixelY: number,
  ): Promise<{ elevation: number; rgbValues: [number, number, number] } | null> {
    try {
      const blob = new Blob([tileData]);
      const imageFormat = this.demInfo?.encoding === 'PNG' ? 'image/png' : 'image/webp';

      if (this.debug) {
        console.log(`Decoding ${this.demInfo?.encoding} tile`);
      }

      const imageBitmap = await createImageBitmap(blob);

      // Create canvas to extract pixel data
      const canvas = document.createElement('canvas');
      canvas.width = imageBitmap.width;
      canvas.height = imageBitmap.height;
      const ctx = canvas.getContext('2d')!;

      ctx.drawImage(imageBitmap, 0, 0);

      if (this.debug) {
        console.log(
          `Image decoded: ${imageBitmap.width}x${imageBitmap.height}, ${canvas.width * canvas.height * 4} bytes`,
        );
      }

      // Ensure pixel coordinates are within bounds
      const clampedX = Math.max(0, Math.min(pixelX, canvas.width - 1));
      const clampedY = Math.max(0, Math.min(pixelY, canvas.height - 1));

      const imageData = ctx.getImageData(clampedX, clampedY, 1, 1);
      const [r, g, b] = imageData.data;

      // Mapbox RGB encoding: elevation = -10000 + ((R * 256 * 256 + G * 256 + B) * 0.1)
      const elevation = -10000 + (r * 256 * 256 + g * 256 + b) * 0.1;

      if (this.debug) {
        console.log(`RGB values: (${r}, ${g}, ${b}) -> elevation: ${elevation.toFixed(1)}m`);
      }

      imageBitmap.close();

      return {
        elevation,
        rgbValues: [r, g, b],
      };
    } catch (error) {
      if (this.debug) {
        console.error('Failed to extract elevation from tile:', error);
      }
      return null;
    }
  }

  private latLonToTile(lat: number, lon: number, zoom: number): [number, number, number] {
    const latRad = (lat * Math.PI) / 180;
    const x = Math.floor(((lon + 180) / 360) * Math.pow(2, zoom));
    const y = Math.floor(((1 - Math.asinh(Math.tan(latRad)) / Math.PI) / 2) * Math.pow(2, zoom));
    return [x, y, zoom];
  }

  private latLonToPixel(lat: number, lon: number, zoom: number): { x: number; y: number } {
    const latRad = (lat * Math.PI) / 180;
    const tileSize = this.demInfo?.tileSize || 256;
    const mapSize = tileSize * Math.pow(2, zoom);
    const x = ((lon + 180) / 360) * mapSize;
    const y = ((1 - Math.asinh(Math.tan(latRad)) / Math.PI) / 2) * mapSize;
    return { x: Math.floor(x), y: Math.floor(y) };
  }

  private addToCache(key: string, data: ArrayBuffer): void {
    // Simple LRU cache implementation
    if (Object.keys(this.cache).length >= this.maxCacheSize) {
      const firstKey = Object.keys(this.cache)[0];
      delete this.cache[firstKey];
    }
    this.cache[key] = data;
  }

  async getDEMInfo(): Promise<DEMInfo | null> {
    if (!this.demInfo) {
      await this.initializeDEMInfo();
    }
    return this.demInfo || null;
  }

  async preCacheTile(x: number, y: number, z: number): Promise<boolean> {
    const tileKey = `${z}/${x}/${y}`;
    if (this.cache[tileKey]) {
      return true; // Already cached
    }

    const tileData = await this.fetchTile(x, y, z);
    if (tileData) {
      this.addToCache(tileKey, tileData);
      return true;
    }
    return false;
  }

  async preCacheBoundingBox(
    bbox: BoundingBox,
    zoom?: number,
  ): Promise<{ total: number; cached: number; progress: (current: number, total: number) => void }> {
    const targetZoom = zoom || this.demInfo?.maxZoom || 10;

    // Calculate tile bounds for the bounding box
    const [minX, maxY] = this.latLonToTile(bbox.north, bbox.west, targetZoom);
    const [maxX, minY] = this.latLonToTile(bbox.south, bbox.east, targetZoom);

    const tiles: Array<[number, number, number]> = [];
    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) {
        tiles.push([x, y, targetZoom]);
      }
    }

    let cached = 0;
    const total = tiles.length;

    const result = {
      total,
      cached: 0,
      progress: (current: number, total: number) => {},
    };

    for (let i = 0; i < tiles.length; i++) {
      const [x, y, z] = tiles[i];
      const success = await this.preCacheTile(x, y, z);
      if (success) {
        cached++;
      }
      result.cached = cached;
      result.progress(i + 1, total);
    }

    return result;
  }

  clearCache(): void {
    this.cache = {};
    if (this.debug) {
      console.log('Cache cleared');
    }
  }

  getCacheSize(): number {
    return Object.keys(this.cache).length;
  }

  getCacheInfo(): { size: number; maxSize: number; keys: string[] } {
    return {
      size: Object.keys(this.cache).length,
      maxSize: this.maxCacheSize,
      keys: Object.keys(this.cache),
    };
  }

  getTileSizeInKm(zoom?: number): number {
    const targetZoom = zoom || this.demInfo?.maxZoom || 10;
    const tileSize = this.demInfo?.tileSize || 256;
    const metersPerPixel = this.calculateMetersPerPixel(targetZoom, tileSize);
    const tileSizeInMeters = metersPerPixel * tileSize;
    return tileSizeInMeters / 1000; // Convert to kilometers
  }
}
