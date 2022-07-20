#! /bin/bash -ex
v=$(npm version --no-git-tag-version patch)
(cd plugin; npm version --no-git-tag-version $v)
vmm=${v%.*}
vmm=${vmm#v}
./bundle.sh $vmm
git commit -a -m "version $v"
git push
(cd plugin; npm publish)
npm publish
