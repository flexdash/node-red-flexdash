#! /usr/bin/bash -ex
# bundle FlexDash itself into this directory prior to publishing to npm so the final package can
# extract both the FlexDash source as well as a built version.
# Actions:
# 1. delete any existing flexdash subdir
# 2. download and extract a prebuilt bundle into flexdash subdir
# 3. download a source tgz
VERSION=$1

rm -r ./flexdash/* || true
curl -L https://s3.amazonaws.com/s3.voneicken.com/flexdash/flexdash-$VERSION.tgz | \
    tar zxf - -C flexdash
curl -L -o flexdash-src.tgz \
    https://s3.amazonaws.com/s3.voneicken.com/flexdash/flexdash-$VERSION-src.tgz
