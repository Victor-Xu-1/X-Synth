if [ ! -d models ]; then
    echo "models not found. Downloading.."
    wget -q --show-progress -O models.tar.gz "https://www.dropbox.com/scl/fi/zvdjz7hguahn84weva6au/models.tar.gz?rlkey=qwoe71klo9p6f5ign1aswxjah&dl=1"
    echo "models.tar.gz Downloaded.  Unzipping.."
    tar -xvf models.tar.gz
    chmod -R 775 models/
    rm models.tar.gz
fi
