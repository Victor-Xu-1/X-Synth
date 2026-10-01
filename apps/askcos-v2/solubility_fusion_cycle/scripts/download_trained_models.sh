mkdir -p trained_models

if [ ! -d trained_models/dHfus ]; then
    echo "trained_models/dHfus not found. Downloading.."
    wget -q --show-progress -O trained_models/dHfus.tar.gz \
      "https://www.dropbox.com/scl/fi/zxok4skre9of8zjx2x59o/dHfus.tar.gz?rlkey=59glnd03sdlzo0zg43p0e3cg9&st=gydht569&dl=1"
    echo "trained_models/dHfus.tar.gz Downloaded. Unzipping.."
    tar xvzf trained_models/dHfus.tar.gz -C trained_models/
    rm trained_models/dHfus.tar.gz
fi

if [ ! -d trained_models/gamma ]; then
    echo "trained_models/gamma not found. Downloading.."
    wget -q --show-progress -O trained_models/gamma.tar.gz \
      "https://www.dropbox.com/scl/fi/5yo9e1nhh9iuz81cc6xa8/gamma.tar.gz?rlkey=2b77ktbdh2xyis8bl54kali6d&st=n4hqfas2&dl=1"
    echo "trained_models/gamma.tar.gz Downloaded. Unzipping.."
    tar xvzf trained_models/gamma.tar.gz -C trained_models/
    rm trained_models/gamma.tar.gz
fi

if [ ! -d trained_models/MP ]; then
    echo "trained_models/MP not found. Downloading.."
    wget -q --show-progress -O trained_models/MP.tar.gz \
      "https://www.dropbox.com/scl/fi/21lkouy2p094zmtmczbgp/MP.tar.gz?rlkey=3s526imjzqhzcscu2nrsscat7&st=nx0l302v&dl=1"
    echo "trained_models/MP.tar.gz Downloaded. Unzipping.."
    tar xvzf trained_models/MP.tar.gz -C trained_models/
    rm trained_models/MP.tar.gz
fi
