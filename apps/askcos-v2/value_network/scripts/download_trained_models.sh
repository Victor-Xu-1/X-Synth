mkdir -p mars

if [ ! -f mars/USPTO_FULL.mar ]; then
    echo "mars/USPTO_FULL.mar not found. Downloading.."
    wget -q --show-progress -O mars/USPTO_FULL.mar \
      "https://www.dropbox.com/scl/fi/c7y43r5rxw4soc0u1huj6/USPTO_FULL.mar?rlkey=wy8fc4b30jgbhy1fkilnobyu3&st=babgtptq&dl=1"
    echo "mars/USPTO_FULL.mar Downloaded."
fi