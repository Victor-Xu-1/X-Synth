mkdir -p mars

if [ ! -f mars/pistachio_23Q3.mar ]; then
    echo "mars/pistachio_23Q3.mar not found. Downloading.."
    wget -q --show-progress -O mars/pistachio_23Q3.mar \
      "https://www.dropbox.com/scl/fi/w5ubm7x1egxvg9eaijyhf/pistachio_23Q3.mar?rlkey=3zn242w8ciilos39nxpx0w5lx&dl=1"
    echo "mars/pistachio_23Q3.mar Downloaded."
fi

if [ ! -f mars/USPTO_STEREO.mar ]; then
    echo "mars/USPTO_STEREO.mar not found. Downloading.."
    wget -q --show-progress -O mars/USPTO_STEREO.mar \
      "https://www.dropbox.com/scl/fi/9x2d8n0ioi9exqf2xi6sl/USPTO_STEREO.mar?rlkey=wwpy6ivuuzdx8aztjpdqcuj6x&dl=1"
    echo "mars/USPTO_STEREO.mar Downloaded."
fi

if [ -n "${DROPBOX_LINK_PASSWORD}" ]; then
    if [ ! -f mars/cas.mar ]; then
        echo "mars/cas.mar not found. Downloading.."
        curl -X POST https://content.dropboxapi.com/2/sharing/get_shared_link_file \
          --header "Authorization: Bearer ${DROPBOX_ACCESS_TOKEN}" \
          --header "Dropbox-API-Arg: {\"path\":\"/cas.mar\",\"url\":\"https://www.dropbox.com/scl/fi/i7fg9nwl5pmdk87gbwm5p/cas.mar?rlkey=cmq23793vj4k4j2nuln8h4pl1&dl=0\", \"link_password\":\"${DROPBOX_LINK_PASSWORD}\"}" \
          -o ./mars/cas.mar
        echo "mars/cas.mar Downloaded."
    fi
fi
