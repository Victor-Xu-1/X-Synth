mkdir -p mars

if [ ! -f mars/pistachio_23Q3.mar ]; then
    echo "mars/pistachio_23Q3.mar not found. Downloading.."
    wget -q --show-progress -O mars/pistachio_23Q3.mar \
      "https://www.dropbox.com/scl/fi/bira0a84twzczwx5drraz/pistachio_23Q3_new.mar?rlkey=efgtnqeeyy6nv5jn2w3fbx7ji&dl=1"
    echo "mars/pistachio_23Q3.mar Downloaded."
fi

if [ ! -f mars/USPTO_FULL.mar ]; then
    echo "mars/USPTO_FULL.mar not found. Downloading.."
    wget -q --show-progress -O mars/USPTO_FULL.mar \
      "https://www.dropbox.com/scl/fi/zmh16tyuq8759vh4puyy2/USPTO_FULL_new.mar?rlkey=pqfoet5n3a8peb504401jxn87&dl=1"
    echo "mars/USPTO_FULL.mar Downloaded."
fi

if [ -n "${DROPBOX_LINK_PASSWORD}" ]; then
    if [ ! -f mars/cas.mar ]; then
        echo "mars/cas.mar not found. Downloading.."
        curl -X POST https://content.dropboxapi.com/2/sharing/get_shared_link_file \
          --header "Authorization: Bearer ${DROPBOX_ACCESS_TOKEN}" \
          --header "Dropbox-API-Arg: {\"path\":\"/cas.mar\",\"url\":\"https://www.dropbox.com/scl/fi/n9yd4tzcfycxgaw0hqate/cas_new.mar?rlkey=2fxmdv3pivpmfevbcozai22q1&dl=0\", \"link_password\":\"${DROPBOX_LINK_PASSWORD}\"}" \
          -o ./mars/cas.mar
        echo "mars/cas.mar Downloaded."
    fi
fi
