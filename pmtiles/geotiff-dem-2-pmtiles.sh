
#!/bin/bash

# GeoTIFF to PMTiles converter for DEM data
# Converts GeoTIFF DEM files to terrain-rgb encoded PMTiles with WebP compression

set -e  # Exit on any error

# Default values
TILE_SIZE=512
TARGET_DIR=""
CLEANUP=true
VERBOSE=false

# Function to display help
show_help() {
    cat << EOF
Usage: $0 [OPTIONS] file1.tif [file2.tif ...]

Convert GeoTIFF DEM files to terrain-rgb encoded PMTiles with WebP lossless compression.

OPTIONS:
    -t, --tile-size SIZE    Tile size in pixels (default: 256)
    -d, --target-dir DIR    Target directory for output PMTiles files
                           (default: current directory)
    -v, --verbose          Enable verbose output
    --no-cleanup           Keep intermediate files (for debugging)
    -h, --help             Show this help message

EXAMPLES:
    $0 dem.tif
    $0 --tile-size 512 --target-dir ./output *.tif
    $0 -t 256 -d /path/to/output dem1.tif dem2.tif

REQUIREMENTS:
    - GDAL (gdalwarp, gdal_translate)
    - rasterio/rio-rgbify (rio rgbify)
    - rio-pmtiles (rio pmtiles)

The script performs the following steps for each input file:
1. Reproject to Web Mercator (EPSG:3857)
2. Convert to terrain-rgb encoding (base -10000, interval 0.1)
3. Generate PMTiles with WebP lossless compression
4. Clean up intermediate files (unless --no-cleanup is used)

EOF
}

# Function for verbose logging
log() {
    if [ "$VERBOSE" = true ]; then
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >&2
    fi
}

# Function for error logging
error() {
    echo "ERROR: $1" >&2
    exit 1
}

# Function to check if command exists
check_command() {
    if ! command -v "$1" >/dev/null 2>&1; then
        error "Required command '$1' not found. Please install it and try again."
    fi
}

# Function to cleanup temporary files
cleanup_temp_files() {
    local temp_files=("$@")
    if [ "$CLEANUP" = true ]; then
        log "Cleaning up temporary files..."
        for file in "${temp_files[@]}"; do
            if [ -f "$file" ]; then
                rm -f "$file"
                log "Removed: $file"
            fi
        done
    else
        log "Keeping temporary files: ${temp_files[*]}"
    fi
}

# Function to get base filename without extension
get_basename() {
    local filepath="$1"
    local filename=$(basename "$filepath")
    echo "${filename%.*}"
}

# Function to process a single TIF file
process_tif() {
    local input_file="$1"
    local base_name
    local temp_webmercator
    local temp_terrain_rgb
    local output_file
    local temp_files=()

    if [ ! -f "$input_file" ]; then
        error "Input file does not exist: $input_file"
    fi

    base_name=$(get_basename "$input_file")

    # Create temporary files in /tmp with unique names
    temp_webmercator=$(mktemp "/tmp/${base_name}_webmercator_XXXXXX.tif")
    temp_terrain_rgb=$(mktemp "/tmp/${base_name}_terrain_rgb_XXXXXX.tif")
    temp_files=("$temp_webmercator" "$temp_terrain_rgb")

    # Determine output file path
    if [ -n "$TARGET_DIR" ]; then
        mkdir -p "$TARGET_DIR"
        output_file="${TARGET_DIR}/${base_name}.pmtiles"
    else
        output_file="${base_name}.pmtiles"
    fi

    echo "Processing: $input_file -> $output_file"

    # Step 1: Reproject to Web Mercator
    log "Step 1: Reprojecting to Web Mercator..."
    gdalwarp -t_srs EPSG:3857 \
        -dstnodata 0 \
        -r lanczos \
        -co BIGTIFF=IF_NEEDED \
        -q \
        "$input_file" "$temp_webmercator"

    if [ ! -f "$temp_webmercator" ]; then
        cleanup_temp_files "${temp_files[@]}"
        error "Failed to create reprojected file for $input_file"
    fi

    # Step 2: Convert to terrain-rgb
    log "Step 2: Converting to terrain-rgb encoding..."
    rio rgbify --base-val -10000 --interval 0.1 "$temp_webmercator" "$temp_terrain_rgb"

    if [ ! -f "$temp_terrain_rgb" ]; then
        cleanup_temp_files "${temp_files[@]}"
        error "Failed to create terrain-rgb file for $input_file"
    fi

    # Step 3: Convert to PMTiles with WebP compression
    log "Step 3: Creating PMTiles with tile size $TILE_SIZE..."
    rio pmtiles \
        --zoom-levels 13..13 \
        --exclude-empty-tiles \
        --tile-size "$TILE_SIZE" \
        --format WEBP \
        --co LOSSLESS=TRUE \
        "$temp_terrain_rgb" "$output_file"

    if [ ! -f "$output_file" ]; then
        cleanup_temp_files "${temp_files[@]}"
        error "Failed to create PMTiles file: $output_file"
    fi

    # Cleanup temporary files
    cleanup_temp_files "${temp_files[@]}"

    echo "Successfully created: $output_file"
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -t|--tile-size)
            TILE_SIZE="$2"
            if ! [[ "$TILE_SIZE" =~ ^[0-9]+$ ]] || [ "$TILE_SIZE" -lt 64 ] || [ "$TILE_SIZE" -gt 2048 ]; then
                error "Tile size must be a number between 64 and 2048"
            fi
            shift 2
            ;;
        -d|--target-dir)
            TARGET_DIR="$2"
            shift 2
            ;;
        -v|--verbose)
            VERBOSE=true
            shift
            ;;
        --no-cleanup)
            CLEANUP=false
            shift
            ;;
        -h|--help)
            show_help
            exit 0
            ;;
        -*)
            error "Unknown option: $1. Use --help for usage information."
            ;;
        *)
            break
            ;;
    esac
done

# Check if at least one input file is provided
if [ $# -eq 0 ]; then
    error "No input files specified. Use --help for usage information."
fi

# Check for required commands
log "Checking for required commands..."
check_command gdalwarp
check_command gdal_translate
check_command rio

# Verify rio has required plugins
if ! rio rgbify --help >/dev/null 2>&1; then
    error "rio-rgbify plugin not found. Install with: pip install rio-rgbify"
fi

if ! rio pmtiles --help >/dev/null 2>&1; then
    error "rio-pmtiles plugin not found. Install with: pip install rio-pmtiles"
fi

# Process each input file
log "Starting processing with tile size: $TILE_SIZE"
if [ -n "$TARGET_DIR" ]; then
    log "Output directory: $TARGET_DIR"
else
    log "Output directory: current directory"
fi

PROCESSED=0
FAILED=0

for input_file in "$@"; do
    if process_tif "$input_file"; then
        ((PROCESSED++))
    else
        ((FAILED++))
        echo "Failed to process: $input_file"
    fi
done

echo ""
echo "Processing complete:"
echo "  Successfully processed: $PROCESSED files"
echo "  Failed: $FAILED files"

if [ $FAILED -gt 0 ]; then
    exit 1
fi


