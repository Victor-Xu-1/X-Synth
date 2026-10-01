mkdir -p data

if [ ! -f data/bkms_metabolic.fp_counts.npy ]; then
    echo "data/bkms_metabolic.fp_counts.npy not found. Downloading.."
    wget -q --show-progress -O data/bkms_metabolic.fp_counts.npy \
      "https://www.dropbox.com/scl/fi/5z2ksehr6s2asnrauqryw/bkms_metabolic.fp_counts.npy?rlkey=ppq69bn2n09v5rqk8s5eubt83&dl=1"
    echo "data/bkms_metabolic.fp_counts.npy Downloaded."
fi

if [ ! -f data/bkms_metabolic.fp_packed.npy ]; then
    echo "data/bkms_metabolic.fp_packed.npy not found. Downloading.."
    wget -q --show-progress -O data/bkms_metabolic.fp_packed.npy \
      "https://www.dropbox.com/scl/fi/x261mxn2dfsv2hk23ivkb/bkms_metabolic.fp_packed.npy?rlkey=owqhbuhuzlewu5kk88u1atedl&dl=1"
    echo "data/bkms_metabolic.fp_packed.npy Downloaded."
fi

if [ ! -f data/bkms_metabolic.ids.txt ]; then
    echo "data/bkms_metabolic.ids.txt not found. Downloading.."
    wget -q --show-progress -O data/bkms_metabolic.ids.txt \
      "https://www.dropbox.com/scl/fi/7ci7gwtsfcmadr0ml6bv8/bkms_metabolic.ids.txt?rlkey=cg0oyzbtvmzfenol11zlynyvv&dl=1"
    echo "data/bkms_metabolic.ids.txt Downloaded."
fi

if [ ! -f data/USPTO_FULL.fp_counts.npy ]; then
    echo "data/USPTO_FULL.fp_counts.npy not found. Downloading.."
    wget -q --show-progress -O data/USPTO_FULL.fp_counts.npy \
      "https://www.dropbox.com/scl/fi/0n6vyw41mr0i6qcvpcyxd/USPTO_FULL.fp_counts.npy?rlkey=3ystsk5bp895a6b8u2en09wip&dl=1"
    echo "data/USPTO_FULL.fp_counts.npy Downloaded."
fi

if [ ! -f data/USPTO_FULL.fp_packed.npy ]; then
    echo "data/USPTO_FULL.fp_packed.npy not found. Downloading.."
    wget -q --show-progress -O data/USPTO_FULL.fp_packed.npy \
      "https://www.dropbox.com/scl/fi/jtoo77tx1ppha9ch9hkpz/USPTO_FULL.fp_packed.npy?rlkey=wn5owpcsxtqpx5rsx4krhxzjv&dl=1"
    echo "data/USPTO_FULL.fp_packed.npy Downloaded."
fi

if [ ! -f data/USPTO_FULL.ids.txt ]; then
    echo "data/USPTO_FULL.ids.txt not found. Downloading.."
    wget -q --show-progress -O data/USPTO_FULL.ids.txt \
      "https://www.dropbox.com/scl/fi/7e60bf8sydw4ml1et8dj2/USPTO_FULL.ids.txt?rlkey=ju7b3ucxw1cgp8ej27hmez7zd&dl=1"
    echo "data/USPTO_FULL.ids.txt Downloaded."
fi
