mkdir -p mars

if [ ! -f mars/pistachio_23Q3.mar ]; then
    echo "mars/pistachio_23Q3.mar not found. Downloading.."
    wget -q --show-progress -O mars/pistachio_23Q3.mar \
      "https://www.dropbox.com/scl/fi/4pobp2rwk0crocb10ka35/pistachio_23Q3.mar?rlkey=jc83r3hkjxu1gmv72hhg6c847&dl=1"
    echo "mars/pistachio_23Q3.mar Downloaded."
fi

if [ ! -f mars/USPTO_STEREO.mar ]; then
    echo "mars/USPTO_STEREO.mar not found. Downloading.."
    wget -q --show-progress -O mars/USPTO_STEREO.mar \
      "https://www.dropbox.com/scl/fi/v6a8624478ei4ujmvg61z/USPTO_STEREO.mar?rlkey=vl4hwzus6bcu54bmxmp1aoo22&dl=1"
    echo "mars/USPTO_STEREO.mar Downloaded."
fi

if [ -n "${DROPBOX_LINK_PASSWORD}" ]; then
    if [ ! -f mars/cas.mar ]; then
        echo "mars/cas.mar not found. Downloading.."
        curl -X POST https://content.dropboxapi.com/2/sharing/get_shared_link_file \
          --header "Authorization: Bearer ${DROPBOX_ACCESS_TOKEN}" \
          --header "Dropbox-API-Arg: {\"path\":\"/cas.mar\",\"url\":\"https://www.dropbox.com/scl/fi/st47mooiv304g7vvpfrao/cas.mar?rlkey=5tpt6z2zh4cq5rv14pbm3ed8r&dl=0\", \"link_password\":\"${DROPBOX_LINK_PASSWORD}\"}" \
          -o ./mars/cas.mar
        echo "mars/cas.mar Downloaded."
    fi
fi
