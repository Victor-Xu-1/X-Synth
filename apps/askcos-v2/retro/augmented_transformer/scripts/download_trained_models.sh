mkdir -p mars

if [ ! -f mars/pistachio_23Q3.mar ]; then
    echo "mars/pistachio_23Q3.mar not found. Downloading.."
    wget -q --show-progress -O mars/pistachio_23Q3.mar \
      "https://www.dropbox.com/scl/fi/rpentybuiufilh6oylllr/pistachio_23Q3.mar?rlkey=xfntihguo9i9ij5munx9c6hem&dl=1"
    echo "mars/pistachio_23Q3.mar Downloaded."
fi

if [ ! -f mars/USPTO_FULL.mar ]; then
    echo "mars/USPTO_FULL.mar not found. Downloading.."
    wget -q --show-progress -O mars/USPTO_FULL.mar \
      "https://www.dropbox.com/scl/fi/m36a9k2wpqxv37agujx0j/USPTO_FULL.mar?rlkey=6k8ulce7dcjkw8nn9y07mr7ag&dl=1"
    echo "mars/USPTO_FULL.mar Downloaded."
fi

if [ -n "${DROPBOX_LINK_PASSWORD}" ]; then
    if [ ! -f mars/cas.mar ]; then
        echo "mars/cas.mar not found. Downloading.."
        curl -X POST https://content.dropboxapi.com/2/sharing/get_shared_link_file \
          --header "Authorization: Bearer ${DROPBOX_ACCESS_TOKEN}" \
          --header "Dropbox-API-Arg: {\"path\":\"/cas.mar\",\"url\":\"https://www.dropbox.com/scl/fi/xq0uo51pdsm7jm70qyrbn/cas.mar?rlkey=wc1wo83skvbcfj12t3fgg1kje&dl=0\", \"link_password\":\"${DROPBOX_LINK_PASSWORD}\"}" \
          -o ./mars/cas.mar
        echo "mars/cas.mar Downloaded."
    fi
fi
